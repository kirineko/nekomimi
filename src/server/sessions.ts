import { mkdir, realpath, readdir } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import {
  Journal,
  hash,
  id,
  artifactRefs,
  type JournalEvent,
} from "../journal.js";
import { run, type RunOptions } from "../runtime.js";
import {
  ApiError,
  validId,
  type Receipt,
  type Submit,
} from "../shared/protocol.js";
import { JournalReader } from "./journal-reader.js";
import { SessionProjection } from "../projection/session.js";
export interface Entry {
  directory: string;
  reader: JournalReader;
  projection: SessionProjection;
  tail: Promise<unknown>;
}
export interface ServiceOptions {
  workspace: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  runtime?: Partial<
    Pick<
      RunOptions,
      | "fetch"
      | "maxOutputTokens"
      | "maxTurns"
      | "timeoutMs"
      | "tools"
      | "journalOptions"
    >
  >;
  lockStaleMs?: number;
}
interface Active {
  sessionId: string;
  runId: string;
  commandId: string;
  payloadHash: string;
  abort: AbortController;
  cancelling: boolean;
  accepted: Promise<Receipt>;
  done: Promise<unknown>;
}
export class Sessions {
  readonly entries = new Map<string, Entry>();
  active?: Active;
  private closing = false;
  private leaseError?: Error;
  private release!: () => Promise<void>;
  private constructor(
    readonly workspace: string,
    readonly root: string,
    readonly options: ServiceOptions,
  ) {}
  static async open(options: ServiceOptions) {
    const workspace = await realpath(options.workspace);
    const parent = join(workspace, ".harness");
    const root = join(parent, "sessions");
    try {
      if ((await realpath(parent)) !== parent)
        throw new Error("Session directory symlink rejected");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await realpath(root)) !== root)
      throw new Error("Session directory symlink rejected");
    const service = new Sessions(workspace, root, options);
    service.release = await lockfile.lock(root, {
      stale: options.lockStaleMs ?? 10000,
      retries: 0,
      onCompromised: (e) => {
        service.leaseError = e;
        service.active?.abort.abort(e);
      },
    });
    return service;
  }
  check() {
    if (this.leaseError)
      throw new ApiError(503, "lease_lost", "服务写入租约已失效");
    if (this.closing) throw new ApiError(503, "closing", "服务正在停止");
  }
  async entry(sessionId: string): Promise<Entry> {
    if (!validId(sessionId)) throw new ApiError(404, "not_found", "会话不存在");
    const directory = join(this.root, sessionId);
    try {
      if ((await realpath(directory)) !== directory) throw new Error("symlink");
    } catch {
      throw new ApiError(404, "not_found", "会话不存在");
    }
    let entry = this.entries.get(sessionId);
    if (!entry) {
      if (this.entries.size >= 32) {
        const oldest = [...this.entries.keys()].find(
          (key) => key !== this.active?.sessionId,
        );
        if (oldest) this.entries.delete(oldest);
      }
      entry = {
        directory,
        reader: new JournalReader(directory),
        projection: new SessionProjection(directory),
        tail: Promise.resolve(),
      };
      this.entries.set(sessionId, entry);
    }
    const current = entry;
    const update = current.tail.then(async () => {
      await current.reader.refresh();
      const meta = current.reader.events.find(
        (e) => e.type === "session.created",
      )?.payload as { workspace?: string } | undefined;
      if (meta?.workspace !== this.workspace)
        throw new ApiError(403, "workspace", "会话不属于当前工作区");
      await current.projection.update(current.reader.events);
    });
    current.tail = update.catch(() => {});
    await update;
    return current;
  }
  info(sessionId: string, entry: Entry) {
    return entry.projection.info(
      sessionId,
      entry.reader.events,
      this.active?.sessionId === sessionId ? this.active : undefined,
    );
  }
  async create(title: string) {
    this.check();
    const sessionId = id();
    const directory = join(this.root, sessionId);
    const j = await Journal.open(directory);
    try {
      await j.append("session.created", {
        workspace: this.workspace,
        model: this.options.model ?? "deepseek-flash",
        baseUrl: (this.options.baseUrl ?? "https://api.deepseek.com").replace(
          /\/$/,
          "",
        ),
      });
      await j.append("web.session", {
        title: title.trim().slice(0, 100) || "新会话",
      });
    } finally {
      await j.close();
    }
    return this.info(sessionId, await this.entry(sessionId));
  }
  async list(offset: number, limit: number) {
    const ids = (await readdir(this.root)).filter(validId).sort();
    const results = [];
    // Scan metadata without loading full attachments for every inactive session on every list.
    for (const sessionId of ids.slice(offset, offset + limit)) {
      try {
        const entry = await this.entry(sessionId);
        results.push(this.info(sessionId, entry));
      } catch {
        /* Unmanaged/corrupt entries are not exposed as readable sessions. */
      }
    }
    return {
      sessions: results,
      next: offset + limit < ids.length ? offset + limit : undefined,
    };
  }
  async submit(sessionId: string, command: Submit): Promise<Receipt> {
    this.check();
    const payloadHash = hash(JSON.stringify({ prompt: command.prompt }));
    const entry = await this.entry(sessionId);
    const prior = entry.reader.events.find(
      (e) =>
        e.type === "command.accepted" &&
        (e.payload as any).commandId === command.commandId,
    );
    if (prior) {
      if ((prior.payload as any).payloadHash !== payloadHash)
        throw new ApiError(409, "command_conflict", "同一命令 ID 的内容不同");
      const terminal = entry.reader.events.find(
        (e) => e.type === "run.finished" && e.runId === prior.runId,
      );
      return {
        version: 1,
        commandId: command.commandId,
        runId: prior.runId!,
        status: terminal
          ? (terminal.payload as any).status
          : this.active?.runId === prior.runId
            ? "running"
            : "interrupted",
      };
    }
    if (this.active) {
      if (
        this.active.sessionId === sessionId &&
        this.active.commandId === command.commandId &&
        this.active.payloadHash === payloadHash
      )
        return this.active.accepted;
      throw new ApiError(409, "busy", "工作区已有任务运行，请等待完成或取消");
    }
    if (!this.options.apiKey)
      throw new ApiError(422, "missing_key", "服务端未配置 DEEPSEEK_API_KEY");
    let accept!: (r: Receipt) => void;
    let reject!: (e: unknown) => void;
    const accepted = new Promise<Receipt>((resolve, fail) => {
      accept = resolve;
      reject = fail;
    });
    const active: Active = {
      sessionId,
      runId: id(),
      commandId: command.commandId,
      payloadHash,
      abort: new AbortController(),
      cancelling: false,
      accepted,
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = run({
      ...this.options.runtime,
      workspace: this.workspace,
      session: entry.directory,
      apiKey: this.options.apiKey,
      model: this.options.model,
      baseUrl: this.options.baseUrl,
      prompt: command.prompt,
      signal: active.abort.signal,
      command: {
        id: command.commandId,
        payloadHash,
        runId: active.runId,
        onAccepted: (runId) =>
          accept({
            version: 1,
            commandId: command.commandId,
            runId,
            status: "running",
          }),
      },
    })
      .catch((error) => {
        reject(error);
      })
      .finally(() => {
        if (this.active === active) this.active = undefined;
      });
    return accepted;
  }
  async cancel(sessionId: string, runId: string) {
    this.check();
    await this.entry(sessionId);
    if (this.active?.sessionId === sessionId && this.active.runId === runId) {
      this.active.cancelling = true;
      this.active.abort.abort(new Error("用户取消"));
      return { status: "cancelling" };
    }
    return { status: "not_running" };
  }
  async close() {
    this.closing = true;
    this.active?.abort.abort(new Error("服务正在停止"));
    await this.active?.done;
    await this.release();
  }
}
