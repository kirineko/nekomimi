import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  truncate,
  readdir,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { StreamRedactor } from "./redaction.js";

export const hash = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const id = (): string => randomUUID();
export interface Artifact {
  kind: "artifact";
  sha256: string;
  bytes: number;
  redacted?: boolean;
}
export interface Links {
  runId?: string;
  modelCallId?: string;
  attemptId?: string;
  toolCallId?: string;
}
export interface JournalEvent extends Links {
  schemaVersion: 1;
  eventId: string;
  sessionId: string;
  seq: number;
  timestamp: string;
  type: string;
  payload: unknown;
  previousHash: string;
  hash: string;
}
export interface SessionSnapshot {
  directory: string;
  events: JournalEvent[];
  durableSeq: number;
  pending: { type: string; id: string; state: string }[];
  tornBytes: number;
  tentativeEvents: number;
}
export interface JournalOptions {
  secrets?: string[];
  flushMs?: number;
  flushBytes?: number;
  lockStaleMs?: number;
  /** Fault/latency injection at the storage boundary, also useful for alternate disks. */
  beforeIO?: (operation: string) => Promise<void>;
}
export function artifactRefs(value: unknown): Artifact[] {
  if (!value || typeof value !== "object") return [];
  if ("kind" in value && value.kind === "artifact") return [value as Artifact];
  return Object.values(value).flatMap(artifactRefs);
}
export async function readArtifact(
  directory: string,
  ref: Artifact,
): Promise<Buffer> {
  if (
    !/^[a-f0-9]{64}$/.test(ref.sha256) ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 0
  )
    throw new Error("Invalid artifact reference");
  const file = join(directory, "artifacts", ref.sha256);
  const resolved = await realpath(file);
  if (resolved !== file)
    throw new Error(`Artifact symlink rejected: ${ref.sha256}`);
  const data = await readFile(file);
  if (hash(data) !== ref.sha256 || data.length !== ref.bytes)
    throw new Error(`Artifact integrity mismatch: ${ref.sha256}`);
  return data;
}
export async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return; // Windows directory handles cannot be fsynced through Node.
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function atomicFile(
  file: string,
  data: string | Uint8Array,
): Promise<void> {
  const temp = `${file}.${id()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  await syncDirectory(join(file, ".."));
}
function pendingOperations(events: JournalEvent[]): SessionSnapshot["pending"] {
  const pending = new Map<
    string,
    { type: string; id: string; state: string }
  >();
  for (const event of events) {
    const key = event.toolCallId ?? event.attemptId ?? event.runId;
    if (!key) continue;
    if (["tool.intent", "attempt.started", "run.started"].includes(event.type))
      pending.set(key, {
        type: event.type,
        id: key,
        state: event.type === "tool.intent" ? "unknown" : "interrupted",
      });
    if (
      [
        "tool.result",
        "tool.failed",
        "attempt.finished",
        "run.finished",
      ].includes(event.type)
    )
      pending.delete(key);
  }
  return [...pending.values()];
}
export async function readSession(directory: string): Promise<SessionSnapshot> {
  directory = await realpath(directory);
  let data: Buffer;
  try {
    data = await readFile(join(directory, "journal.jsonl"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    data = Buffer.alloc(0);
  }
  const boundary = data.lastIndexOf(10) + 1;
  const lines = boundary
    ? data.subarray(0, boundary).toString("utf8").split("\n").slice(0, -1)
    : [];
  const events: JournalEvent[] = [];
  let previousHash = "";
  for (const line of lines) {
    let event: JournalEvent;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Corrupt journal at record ${events.length + 1}`);
    }
    const { hash: digest, ...body } = event;
    if (
      event.schemaVersion !== 1 ||
      event.seq !== events.length + 1 ||
      event.previousHash !== previousHash ||
      hash(JSON.stringify(body)) !== digest ||
      (events[0] && event.sessionId !== events[0].sessionId)
    ) {
      throw new Error(`Invalid journal chain at record ${events.length + 1}`);
    }
    events.push(event);
    previousHash = digest;
  }
  let durableSeq = 0;
  try {
    const mark = JSON.parse(
      await readFile(join(directory, "durable.json"), "utf8"),
    ) as { seq: number; hash: string };
    if (
      !Number.isSafeInteger(mark.seq) ||
      mark.seq < 0 ||
      mark.seq > events.length ||
      (mark.seq > 0 && events[mark.seq - 1]?.hash !== mark.hash)
    )
      throw new Error("Invalid durable watermark");
    durableSeq = mark.seq;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const verified = new Set<string>();
  for (const event of events.slice(0, durableSeq))
    for (const ref of artifactRefs(event.payload)) {
      if (!verified.has(ref.sha256)) {
        await readArtifact(directory, ref);
        verified.add(ref.sha256);
      }
    }
  return {
    directory,
    events,
    durableSeq,
    pending: pendingOperations(events.slice(0, durableSeq)),
    tornBytes: data.length - boundary,
    tentativeEvents: events.length - durableSeq,
  };
}

export class Journal {
  readonly failure = new AbortController();
  readonly events: JournalEvent[];
  readonly sessionId: string;
  durableSeq: number;
  private tail: Promise<unknown> = Promise.resolve();
  private fault?: Error;
  private timer: NodeJS.Timeout;
  private pendingBytes = 0;
  private closed = false;
  private constructor(
    readonly directory: string,
    private handle: Awaited<ReturnType<typeof open>>,
    private release: () => Promise<void>,
    snapshot: SessionSnapshot,
    private options: JournalOptions,
  ) {
    this.events = snapshot.events.slice(0, snapshot.durableSeq);
    this.sessionId = this.events[0]?.sessionId ?? id();
    this.durableSeq = snapshot.durableSeq;
    this.timer = setInterval(() => {
      if (this.pendingBytes) void this.flush().catch(() => {});
    }, options.flushMs ?? 100);
    this.timer.unref();
  }
  static async open(
    directory: string,
    options: JournalOptions = {},
  ): Promise<Journal> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    directory = await realpath(directory);
    let compromised: Error | undefined;
    let instance: Journal | undefined;
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(directory, {
        stale: options.lockStaleMs ?? 10000,
        retries: 0,
        onCompromised: (e) => {
          compromised = e;
          instance?.fail(e);
        },
      });
    } catch {
      throw new Error(
        "Session is busy; after a crashed process allow the writer lease to expire (10 seconds).",
      );
    }
    try {
      await mkdir(join(directory, "artifacts"), {
        recursive: true,
        mode: 0o700,
      });
      const snapshot = await readSession(directory);
      let quarantined: Buffer | undefined;
      if (snapshot.tornBytes || snapshot.tentativeEvents) {
        const raw = await readFile(join(directory, "journal.jsonl"));
        const kept = snapshot.events
          .slice(0, snapshot.durableSeq)
          .map((e) => JSON.stringify(e) + "\n")
          .join("");
        quarantined = raw.subarray(Buffer.byteLength(kept));
        // Preserve all discarded bytes before changing the active journal.
        await atomicFile(
          join(directory, `recovery-${id()}.jsonl`),
          quarantined,
        );
        await truncate(
          join(directory, "journal.jsonl"),
          Buffer.byteLength(kept),
        );
      }
      const handle = await open(join(directory, "journal.jsonl"), "a", 0o600);
      instance = new Journal(directory, handle, release, snapshot, options);
      if (compromised) instance.fail(compromised);
      if (quarantined)
        await instance.append("journal.recovered", {
          artifact: await instance.artifact(quarantined),
          tornBytes: snapshot.tornBytes,
          tentativeEvents: snapshot.tentativeEvents,
        });
      return instance;
    } catch (e) {
      if (instance) {
        instance.fail(e);
        await instance.close();
      } else await release();
      throw e;
    }
  }
  check(): void {
    if (this.fault) throw this.fault;
    if (this.closed) throw new Error("Journal is closed");
  }
  fail(error: unknown): void {
    this.fault ??= error instanceof Error ? error : new Error(String(error));
    this.failure.abort(this.fault);
  }
  clean(value: string): string {
    for (const secret of this.options.secrets ?? [])
      if (secret) value = value.split(secret).join("[REDACTED]");
    return value;
  }
  streamRedactor(): StreamRedactor {
    return new StreamRedactor(this.options.secrets ?? []);
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {
      this.check();
      try {
        return await operation();
      } catch (e) {
        this.fail(e);
        throw e;
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  private async sync(): Promise<void> {
    await this.options.beforeIO?.("sync");
    await this.handle.sync();
    const last = this.events.at(-1);
    await atomicFile(
      join(this.directory, "durable.json"),
      JSON.stringify({ seq: last?.seq ?? 0, hash: last?.hash ?? "" }),
    );
    this.durableSeq = last?.seq ?? 0;
    this.pendingBytes = 0;
  }
  append(
    type: string,
    payload: unknown,
    links: Links = {},
    durable = true,
  ): Promise<JournalEvent> {
    return this.enqueue(async () => {
      const body = {
        schemaVersion: 1 as const,
        eventId: id(),
        sessionId: this.sessionId,
        seq: this.events.length + 1,
        timestamp: new Date().toISOString(),
        ...links,
        type,
        payload: JSON.parse(this.clean(JSON.stringify(payload ?? null))),
        previousHash: this.events.at(-1)?.hash ?? "",
      };
      const event = { ...body, hash: hash(JSON.stringify(body)) };
      const line = JSON.stringify(event) + "\n";
      await this.options.beforeIO?.("append");
      await this.handle.writeFile(line);
      this.events.push(event);
      this.pendingBytes += Buffer.byteLength(line);
      if (durable || this.pendingBytes >= (this.options.flushBytes ?? 65536))
        await this.sync();
      return event;
    });
  }
  async artifact(data: string | Uint8Array): Promise<Artifact> {
    this.check();
    try {
      const original =
        typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
      // Only replace literal secret bytes; preserve arbitrary binary artifacts otherwise.
      let bytes = original;
      for (const secret of this.options.secrets ?? []) {
        if (secret && bytes.includes(Buffer.from(secret)))
          bytes = Buffer.from(
            bytes.toString("utf8").split(secret).join("[REDACTED]"),
          );
      }
      const sha256 = hash(bytes);
      const file = join(this.directory, "artifacts", sha256);
      await this.options.beforeIO?.("artifact");
      try {
        await stat(file);
        await readArtifact(this.directory, {
          kind: "artifact",
          sha256,
          bytes: bytes.length,
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        await atomicFile(file, bytes);
      }
      return {
        kind: "artifact",
        sha256,
        bytes: bytes.length,
        ...(bytes.equals(original) ? {} : { redacted: true }),
      };
    } catch (e) {
      this.fail(e);
      throw e;
    }
  }
  flush(): Promise<void> {
    return this.enqueue(() => this.sync());
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    try {
      await this.tail;
      if (!this.fault) await this.flush();
    } finally {
      this.closed = true;
      await this.handle.close();
      await this.release();
    }
  }
}
