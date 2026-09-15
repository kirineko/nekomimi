import { ConfigStore } from "../config/store.js";
import { workspacePaths } from "../storage/paths.js";
import { migrate } from "../storage/migrate.js";
import { nameSession } from "../session/title.js";
import { mkdir, realpath, readdir, rename, rm } from "node:fs/promises";
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
  home?: string;
  legacyHome?: string;
  naming?: boolean;
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
  config!: ConfigStore;
  paths!: Awaited<ReturnType<typeof workspacePaths>>;
  private gate = Promise.resolve();
  naming?: {
    sessionId: string;
    runId: string;
    abort: AbortController;
    done: Promise<void>;
  };
  private readers = new Map<string, number>();
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.gate.then(action);
    this.gate = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async settings() {
    const s = await this.config.snapshot();
    return {
      ...s,
      apiKey: this.options.apiKey ?? s.apiKey,
      model: this.options.model ?? s.model,
      baseUrl: this.options.baseUrl ?? s.baseUrl,
    };
  }
  async migration(execute = false) {
    return this.exclusive(async () => {
      this.check();
      if (this.active || this.naming)
        throw new ApiError(409, "busy", "请先停止活动任务");
      return migrate(this.paths, execute, this.options.legacyHome);
    });
  }
  async downloadLease(sessionId: string) {
    return this.exclusive(async () => {
      this.check();
      if (
        this.active?.sessionId === sessionId ||
        this.naming?.sessionId === sessionId
      )
        throw new ApiError(409, "busy", "请等待运行停止");
      await this.entry(sessionId);
      this.readers.set(sessionId, (this.readers.get(sessionId) ?? 0) + 1);
      return () => {
        this.readers.set(sessionId, (this.readers.get(sessionId) ?? 1) - 1);
      };
    });
  }
  async remove(sessionId: string) {
    return this.exclusive(async () => {
      this.check();
      if (!validId(sessionId))
        throw new ApiError(404, "not_found", "会话不存在");
      if (
        this.active?.sessionId === sessionId ||
        this.naming?.sessionId === sessionId ||
        this.readers.get(sessionId)
      )
        throw new ApiError(
          409,
          "busy",
          "会话正在运行或下载，请先停止并稍后重试",
        );
      const target = join(this.paths.deleting, sessionId);
      let entry: Entry;
      try {
        entry = await this.entry(sessionId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          await rm(target, { recursive: true, force: true });
          return { status: "deleted" };
        }
        throw e;
      }
      const release = await lockfile.lock(entry.directory, { retries: 0 });
      try {
        await rename(entry.directory, target);
        this.entries.delete(sessionId);
        await rm(target, { recursive: true, force: true });
      } finally {
        await release();
      }
      return { status: "deleted" };
    });
  }
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
    const paths = await workspacePaths(options.workspace, options.home);
    const { workspace, sessions: root } = paths;
    const service = new Sessions(workspace, root, options);
    service.paths = paths;
    service.config = new ConfigStore(paths.home);
    service.release = await lockfile.lock(root, {
      stale: options.lockStaleMs ?? 10000,
      retries: 0,
      onCompromised: (e) => {
        service.leaseError = e;
        service.active?.abort.abort(e);
      },
    });
    for (const name of await readdir(paths.deleting))
      if (validId(name))
        await rm(join(paths.deleting, name), { recursive: true, force: true });
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
    return {
      ...entry.projection.info(
        sessionId,
        entry.reader.events,
        this.active?.sessionId === sessionId ? this.active : undefined,
      ),
      naming: this.naming?.sessionId === sessionId,
    };
  }
  async create(title: string) {
    return this.exclusive(() => this.createInner(title));
  }
  private async createInner(title: string) {
    this.check();
    const settings = await this.settings();
    const sessionId = id();
    const directory = join(this.root, sessionId);
    const j = await Journal.open(directory);
    try {
      await j.append("session.created", {
        workspace: this.workspace,
        model: settings.model,
        baseUrl: settings.baseUrl.replace(/\/$/, ""),
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
    return this.exclusive(() => this.submitInner(sessionId, command));
  }
  private async submitInner(
    sessionId: string,
    command: Submit,
  ): Promise<Receipt> {
    this.check();
    if (this.naming) {
      this.naming.abort.abort(new Error("新任务优先"));
      await this.naming.done;
    }
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
    const settings = await this.settings();
    if (!settings.apiKey)
      throw new ApiError(422, "missing_key", "请在设置中保存 API key");
    if (this.readers.get(sessionId))
      throw new ApiError(409, "busy", "会话正在下载");
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
      apiKey: settings.apiKey,
      model: settings.model,
      baseUrl: settings.baseUrl,
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
      .then(async (result) => {
        if (
          result.status === "completed" &&
          !this.closing &&
          this.options.naming !== false
        ) {
          const naming = {
            sessionId,
            runId: id(),
            abort: new AbortController(),
            done: Promise.resolve(),
          };
          this.naming = naming;
          naming.done = nameSession(
            entry.directory,
            { ...this.options.runtime, ...settings, apiKey: settings.apiKey! },
            naming.abort.signal,
          )
            .catch(() => {})
            .finally(() => {
              if (this.naming === naming) this.naming = undefined;
            });
        }
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
    if (this.naming?.sessionId === sessionId) {
      this.naming.abort.abort(new Error("用户取消命名"));
      return { status: "cancelling" };
    }
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
    this.naming?.abort.abort(new Error("服务正在停止"));
    await this.naming?.done;
    await this.release();
  }
}
