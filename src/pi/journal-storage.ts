import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import type { Seq, Storage, StorageWrite } from "@earendil-works/pi-durable";
import { Journal, readSession, type JournalOptions } from "../journal.js";
import { ApiError } from "../shared/protocol.js";
import type { SessionBinding } from "../shared/protocol.js";

const FORMAT_VERSION = 1;
const ADAPTER_REVISION = "nekomimi-durable-journal-1";
interface Batch {
  formatVersion: typeof FORMAT_VERSION;
  adapterRevision: typeof ADAPTER_REVISION;
  frameworkSeq: Seq;
  writes: readonly StorageWrite[];
}
export interface CommitMapping {
  readonly frameworkSeq: Seq;
  readonly journalSeq: number;
}
export interface JournalStorageHandle {
  readonly storage: Storage;
  readonly journal: Journal;
  /** A detached view of the confirmed commit mapping. */
  mappings(): readonly CommitMapping[];
}
function isFormat(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.formatVersion === FORMAT_VERSION && record.adapterRevision === ADAPTER_REVISION;
}
function batch(value: unknown, previousSeq: number): Batch {
  if (!isFormat(value)) throw new Error("Unsupported Durable Journal format");
  const record = value as Batch;
  if (!Number.isSafeInteger(record.frameworkSeq) || record.frameworkSeq <= previousSeq || !Array.isArray(record.writes))
    throw new Error("Invalid Durable Journal commit");
  return record;
}
function checkFormat(events: Awaited<ReturnType<typeof readSession>>["events"]): void {
  if (!events.length) return;
  if (events[0]?.type !== "durable.session" || !isFormat(events[0].payload))
    throw new ApiError(422, "incompatible_format", "Unsupported session format; 请选择独立的新Durable目录，原文件不会迁移或覆盖");
  let previousSeq = 0;
  for (const event of events) {
    if (event.type !== "durable.commit") continue;
    previousSeq = batch(event.payload, previousSeq).frameworkSeq;
  }
}
/** Match JSON persistence without silently converting non-JSON values or invoking user serialization. */
function validateJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object") throw new Error("Durable writes must be JSON values");
  if (seen.has(value)) throw new Error("Cyclic Durable writes");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error("Durable writes must be plain JSON objects");
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) continue;
    if (!Object.hasOwn(descriptor, "value")) throw new Error("Durable writes cannot contain accessors");
    // Optional record fields are omitted by JSON stores, but arrays must not contain gaps.
    if (descriptor.value === undefined && !Array.isArray(value)) continue;
    validateJson(descriptor.value, seen);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length)
    throw new Error("Durable writes cannot contain sparse arrays");
  seen.delete(value);
}
const readMethods = [
  "mintId", "conversation", "scanConversations", "entry", "findLatestHeadMarker", "scanEntries",
  "task", "scanTasks", "submission", "scanSubmissions", "submissionByRequest", "findDocument",
  "document", "scanDocuments",
] as const satisfies readonly (keyof Storage)[];

/** Validate format and ownership of events whose reliable chain was already checked by the reader. */
export function inspectJournalEventsFormat(events: Awaited<ReturnType<typeof readSession>>["events"], expectedWorkspace?: string): void {
  checkFormat(events);
  if (expectedWorkspace !== undefined) {
    const identity = events.find(event => event.type === "session.created")?.payload ?? events[0]?.payload;
    const value = identity as { workspace?: unknown; ownerWorkspace?: unknown; binding?: { ownerWorkspace?: unknown } } | undefined;
    const workspace = value?.binding?.ownerWorkspace ?? value?.ownerWorkspace ?? value?.workspace;
    if (workspace !== undefined && workspace !== expectedWorkspace)
      throw new ApiError(403, "workspace", "会话不属于当前工作区");
  }
}

/** Check a session before factories or writers, including every reliable artifact through readSession. */
export async function inspectJournalFormat(directory: string, expectedWorkspace?: string): Promise<void> {
  let exists = false;
  try { await lstat(join(directory, "journal.jsonl")); exists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (exists) {
    const events = (await readSession(directory)).events;
    inspectJournalEventsFormat(events, expectedWorkspace);
  }
}

/** Durable has one physical authority: the product Journal, with a disposable MemoryStorage projection. */
export async function openJournalStorage(
  directory: string,
  context: Context,
  options: JournalOptions = {},
  identity?: { readonly workspace: string; readonly binding?: SessionBinding },
): Promise<JournalStorageHandle> {
  // Refuse older formats before acquiring a writer or repairing their files.
  await inspectJournalFormat(directory);
  const journal = await Journal.open(directory, { ...options, ...(identity?.binding ? { sessionId: identity.binding.sessionId } : {}) });
  const memory = new MemoryStorage();
  const mappings: CommitMapping[] = [];
  let failed: unknown;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  try {
    checkFormat(journal.events.filter(event => event.seq <= journal.durableSeq));
    if (!journal.events.length) await journal.append("durable.session", {
      formatVersion: FORMAT_VERSION, adapterRevision: ADAPTER_REVISION,
      ...(identity ? { workspace: identity.workspace } : {}),
      ...(identity?.binding ? { binding: identity.binding } : {}),
    });
    for (const event of journal.events) {
      if (event.seq > journal.durableSeq || event.type !== "durable.commit") continue;
      const committed = batch(event.payload, mappings.at(-1)?.frameworkSeq ?? 0);
      memory.prepareCommit(committed.writes, committed.frameworkSeq).apply();
      mappings.push({ frameworkSeq: committed.frameworkSeq, journalSeq: event.seq });
    }
  } catch (error) {
    // Don't promote a recovered invalid projection to an operational runtime.
    journal.fail(error);
    await memory.close(context);
    await journal.close();
    throw error;
  }
  function check(): void {
    if (failed || journal.failure.signal.aborted)
      throw new Error("Durable Journal storage poisoned", { cause: failed ?? journal.failure.signal.reason });
    journal.check();
  }
  const reads = Object.fromEntries(readMethods.map(name => [name, async (...args: unknown[]) => {
    if (closing) throw new Error("Durable Journal storage closed");
    check();
    return Reflect.apply(memory[name], memory, args);
  }])) as Pick<Storage, typeof readMethods[number]>;
  const storage: Storage = {
    ...reads,
    async commit(writes, _commitContext) {
      if (closing) throw new Error("Durable Journal storage closed");
      // Own input before queue admission; do not let later caller mutations alter a batch.
      let detached: readonly StorageWrite[];
      try {
        validateJson(writes);
        detached = JSON.parse(JSON.stringify(writes)) as StorageWrite[];
      } catch (error) {
        failed = error;
        journal.fail(error);
        throw error;
      }
      const commit = tail.then(async () => {
        check();
        try {
          const prepared = memory.prepareCommit(detached);
          const payload: Batch = { formatVersion: FORMAT_VERSION, adapterRevision: ADAPTER_REVISION,
            frameworkSeq: prepared.seq, writes: prepared.writes };
          const encoded = JSON.stringify(payload);
          if (journal.clean(encoded) !== encoded)
            throw new Error("Credential-bearing Durable batch rejected");
          const event = await journal.append("durable.commit", payload);
          const seq = prepared.apply();
          mappings.push({ frameworkSeq: seq, journalSeq: event.seq });
          return seq;
        } catch (error) {
          failed = error;
          journal.fail(error);
          throw error;
        }
      });
      tail = commit.catch(() => {});
      return commit;
    },
    close(closeContext) {
      if (!closePromise) {
        closing = true;
        closePromise = (async () => {
          // Drain already admitted commits; reject subsequent admission and reads.
          await tail;
          try { await memory.close(closeContext); }
          finally { await journal.close(); }
        })();
      }
      return closePromise;
    },
  };
  return { storage, journal, mappings: () => mappings.map(mapping => ({ ...mapping })) };
}
