import { CustomizationHost, validateExtension } from "../customization/host.js";
import { Candidates } from "../customization/candidates.js";
import { packageAction } from "../customization/package-management.js";
import { ProviderProfiles, type ProviderProfile } from "../customization/provider-profiles.js";
import { branchHistory } from "../customization/history-branch.js";
import { checkTypes } from "../customization/validation.js";
import { Interactions } from "../customization/interactions.js";
import type { Json } from "../customization/types.js";
import { nodeSyntax } from "../presentation/syntax/node.js";
import { diagnostic, readDiagnostics, saveDiagnostic } from "../diagnostics.js";
import type { Diagnostic } from "../shared/protocol.js";
import { ConfigStore } from "../config/store.js";
import { workspacePaths } from "../storage/paths.js";
import { migrate } from "../storage/migrate.js";
import { nameSession } from "../session/title.js";
import { mkdir, realpath, readdir, rename, rm, open } from "node:fs/promises";
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
  diagnostics: Diagnostic[];
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
      | "toolOptions"
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
  private workflowTask?: { id: string; done: Promise<unknown>; error?: string };
  config!: ConfigStore;
  customization!: CustomizationHost;
  readonly interactions = new Interactions();
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
        nodeSyntax.clearScope(entry.directory);
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
    service.customization = new CustomizationHost(workspace, paths.home);
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
  private async sessionDirectory(sessionId: string): Promise<string> {
    if (!validId(sessionId)) throw new ApiError(404, "not_found", "会话不存在");
    const directory = join(this.root, sessionId);
    try {
      if ((await realpath(directory)) !== directory) throw new Error("symlink");
    } catch {
      throw new ApiError(404, "not_found", "会话不存在");
    }
    return directory;
  }
  async diagnostics(sessionId: string): Promise<Diagnostic[]> {
    const directory = await this.sessionDirectory(sessionId);
    // Verify identity from the first journal record, without reading the watermark
    // or requiring the rest of a damaged journal to be readable.
    const file = await open(join(directory, "journal.jsonl"), "r");
    let first: JournalEvent;
    try {
      if ((await realpath(join(directory, "journal.jsonl"))) !== join(directory, "journal.jsonl"))
        throw new ApiError(403, "workspace", "会话身份无法验证");
      const buffer = Buffer.alloc(65536);
      let size = 0;
      while (size < buffer.length && buffer.subarray(0, size).indexOf(10) < 0) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      const end = buffer.subarray(0, size).indexOf(10);
      if (end < 0) throw new ApiError(403, "workspace", "会话身份无法验证");
      first = JSON.parse(buffer.subarray(0, end).toString("utf8"));
    } finally { await file.close(); }
    const { hash: digest, ...body } = first;
    if (first.type !== "session.created" || first.seq !== 1 || first.schemaVersion !== 1 ||
        first.previousHash !== "" || hash(JSON.stringify(body)) !== digest ||
        (first.payload as {workspace?: string})?.workspace !== this.workspace)
      throw new ApiError(403, "workspace", "会话不属于当前工作区");
    const saved = await readDiagnostics(directory);
    const merged = new Map(saved.map(value => [value.id, value]));
    for (const value of this.entries.get(sessionId)?.diagnostics ?? []) merged.set(value.id, value);
    return [...merged.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  async entry(sessionId: string): Promise<Entry> {
    const directory = await this.sessionDirectory(sessionId);
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
        diagnostics: [],
      };
      const initialized = entry;
      initialized.tail = readDiagnostics(directory).then(values => { initialized.diagnostics = values; });
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
      diagnostic: entry.diagnostics.at(-1),
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
    if (this.workflowTask || this.customization.workflows.busy) throw new ApiError(409, 'busy', '工作区已有工作流步骤运行');
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
    if (!settings.apiKey && !(await new ProviderProfiles(this.paths.home).resolve("main")))
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
    const receiveDiagnostic = (value: Diagnostic) => {
      if (!entry.diagnostics.some(item => item.id === value.id)) entry.diagnostics.push(value);
    };
    const reportBackground = async (error: unknown, runId: string, operation: string) => {
      if (entry.diagnostics.some(value => value.runId === runId)) return;
      const value = diagnostic(error, { sessionId, runId, seq: entry.reader.cursor.seq, durableSeq: entry.reader.cursor.seq }, operation);
      receiveDiagnostic(value);
      await saveDiagnostic(entry.directory, value);
    };
    active.done = run({
      ...this.options.runtime,
      workspace: this.workspace,
      home: this.paths.home,
      customization: this.customization,
      interactions: this.interactions,
      journalOptions: { ...this.options.runtime?.journalOptions, onDiagnostic: receiveDiagnostic },
      session: entry.directory,
      apiKey: settings.apiKey ?? "",
      model: settings.model,
      baseUrl: settings.baseUrl,
      search: settings.search,
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
            { ...this.options.runtime, ...settings, apiKey: settings.apiKey ?? "" },
            naming.abort.signal,
            { onDiagnostic: receiveDiagnostic, diagnosticRunId: naming.runId },
            this.customization,
          )
            .catch(async error => { if (!naming.abort.signal.aborted) await reportBackground(error, naming.runId, "background.naming"); })
            .finally(() => {
              if (this.naming === naming) this.naming = undefined;
            });
        }
      })
      .catch(async (error) => {
        reject(error);
        if (!active.abort.signal.aborted) await reportBackground(error, active.runId, "background.run");
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
  async customizationAction(value: Record<string, unknown>) {
    return this.exclusive(async () => {
      this.check();
      if (value.action === 'user-writes' && typeof value.enabled === 'boolean' && typeof value.revision === 'number') { await this.customization.catalog.allowUserWrites(value.enabled,value.revision); return { status: 'saved' }; }
      if (value.action === 'candidate-panel-preview') return this.customization.panels.previewCandidate(String(value.id),String(value.contentHash),typeof value.panelId === 'string'?value.panelId:undefined,(value.props ?? {}) as Json,value.authorize===true);
      if (value.action === 'panel-mount') return this.customization.panels.mount(String(value.resourceId), String(value.panelId), String(value.revision), (value.props ?? {}) as Json, typeof value.workflowId === 'string' ? value.workflowId : undefined, value.preview === true, typeof value.theme === 'string' ? value.theme : undefined);
      if (value.action === 'panel-action') {
        try {return await this.customization.panels.action(String(value.instanceId), Number(value.sequence), String(value.method), (value.value ?? null) as Json);}
        catch(error) {
          if(/Workflow (revision conflict|answer identity conflict|interaction is not waiting)/.test(String(error))) throw new ApiError(409,'panel_conflict','工作流回答冲突，请刷新权威状态');
          if(/Panel (authorization revoked|revision no longer active|instance expired|action not authorized)/.test(String(error))) throw new ApiError(403,'panel_permission','面板授权、版本或交互已失效');
          throw error;
        }
      }
      if (value.action === 'panel-unmount') return this.customization.panels.unmount(String(value.instanceId));
      if (value.action === 'reload') return this.customization.requestReload();
      if (typeof value.action === 'string' && value.action.startsWith('workflow-')) {
        const flows = this.customization.workflows, workflowId = String(value.id ?? '');
        if (value.action === 'workflow-recover') return flows.recoverWorkflow(workflowId);
        if (value.action === 'workflow-inspect') return flows.inspect(workflowId);
        if (value.action === 'workflow-evidence') return flows.evidence(workflowId, Number(value.offset ?? 0));
        if (value.action === 'workflow-artifact') return flows.artifact(workflowId, String(value.hash ?? ''));
        if (value.action === 'workflow-cancel') return flows.cancel(workflowId, Number(value.revision));
        if (this.active || this.naming || this.workflowTask) throw new ApiError(409, 'busy', '请等待当前任务完成或取消');
        flows.configure({ ...this.options.runtime, ...await this.settings(), apiKey: (await this.settings()).apiKey ?? '' });
        const start = (workflowId: string, revision: number) => {
          const task = { id: workflowId, done: Promise.resolve() as Promise<unknown>, error: undefined as string | undefined };
          this.workflowTask = task;
          task.done = flows.advance(workflowId, { expectedRevision: revision }).catch(error => { task.error = String(error); }).finally(() => { if (this.workflowTask === task) this.workflowTask = undefined; });
          return { id: workflowId, status: 'running' };
        };
        if (value.action === 'workflow-start') {
          const activation = await this.customization.acquire();
          let created;
          try { created = await flows.create(String(value.resourceId), String(value.definitionId), (value.input ?? {}) as Json, activation, String(value.commandId)); }
          finally { await this.customization.release(); }
          return ['queued', 'ready'].includes(created.status) ? start(created.id, created.revision) : created;
        }
        if (value.action === 'workflow-resume') return start(workflowId, Number(value.revision));
        if (value.action === 'workflow-answer') {
          const ready = await flows.answer(workflowId, String(value.waitId), String(value.commandId), value.answer as Json, Number(value.revision));
          return value.resume === true && ready.status === 'ready' ? start(workflowId, ready.revision) : ready;
        }
        if (value.action === 'workflow-resolve') return flows.resolveUnknown(workflowId, Number(value.revision), value.choice as Parameters<typeof flows.resolveUnknown>[2]);
        if (value.action === 'workflow-migrate') {
          const activation = await this.customization.acquire();
          try { return await flows.migrate(workflowId, Number(value.revision), value.target as Parameters<typeof flows.migrate>[2], activation); }
          finally { await this.customization.release(); }
        }
        throw new ApiError(400, 'workflow', '工作流操作无效');
      }
      if (value.action === 'history-branch' && typeof value.sessionId === 'string') {
        if (this.active || this.naming) throw new ApiError(409, 'busy', '请等待任务完成后创建历史分支');
        const source = await this.entry(value.sessionId), sessionId = id();
        await branchHistory(source.directory, join(this.root, sessionId), this.workspace, value.omitReasoning === true);
        return { sessionId };
      }
      if (typeof value.action === 'string' && value.action.startsWith('provider-')) {
        const profiles = new ProviderProfiles(this.paths.home);
        if (value.action === 'provider-save' && typeof value.revision === 'number') return profiles.save(value.profile as ProviderProfile, value.revision);
        if (value.action === 'provider-select' && typeof value.revision === 'number' && ['main', 'auxiliary', 'naming'].includes(String(value.purpose))) return profiles.select(value.purpose as 'main' | 'auxiliary' | 'naming', typeof value.id === 'string' ? value.id : undefined, value.revision);
        if (value.action === 'provider-credential' && typeof value.ref === 'string' && (typeof value.secret === 'string' || value.secret === null)) { await profiles.saveCredential(value.ref, value.secret); return { status: 'saved' }; }
        if (value.action === 'provider-migrate' && typeof value.revision === 'number') return profiles.migrateLegacy(value.revision);
        throw new ApiError(400, 'provider', 'Provider 操作无效');
      }
      if (['mcp-authorize', 'mcp-disconnect'].includes(String(value.action))) {
        const resource = (await this.customization.catalog.discover()).find(r => r.kind === 'mcp' && r.id === value.id);
        if (!resource) throw new ApiError(400, 'mcp', 'MCP 连接不存在');
        if (value.action === 'mcp-authorize') return this.customization.oauth.begin(resource);
        await this.customization.oauth.disconnect(resource);
        return { status: 'disconnected' };
      }
      if (typeof value.action === 'string' && ['package-collect', 'package-list', 'package-inspect', 'package-activate', 'package-rollback', 'package-export', 'package-uninstall'].includes(value.action)) return packageAction(this.customization, { ...value, action: value.action.slice(8) }, { user: true });
      if (value.action === 'candidate-inspect' && typeof value.id === 'string') return new Candidates(this.customization.catalog.workspace).preview(value.id);
      if (value.action === 'candidate-activate' && typeof value.id === 'string' && typeof value.contentHash === 'string') return this.customization.requestCandidate(value.id, value.contentHash, value.authorize === true);
      if (value.action === 'candidate-rollback' && typeof value.name === 'string') return this.customization.requestRollback(value.name, value.authorize === true);
      if (value.action === 'validate') {
        const r = (await this.customization.catalog.discover()).find(r => r.id === value.id);
        if (!r || r.kind !== 'extension') throw new ApiError(400, 'resource', '扩展不存在');
        return { errors: await validateExtension(r), report: checkTypes(r) };
      }
      if (value.action === 'set' && typeof value.id === 'string' && typeof value.enabled === 'boolean' && typeof value.trusted === 'boolean' && typeof value.revision === 'number') {
        await this.customization.catalog.decide(value.id, value.enabled, value.trusted, value.revision);
        return this.customization.requestReload();
      }
      throw new ApiError(400, 'resource', '资源操作无效');
    });
  }
  async answerInteraction(sessionId: string, value: Record<string, unknown>) {
    return this.exclusive(async () => {
      if (typeof value.id !== 'string' || typeof value.commandId !== 'string' || !validId(value.commandId) || value.answer === undefined) throw new ApiError(400,'answer','回答无效');
      const entry = await this.entry(sessionId);
      const prior = entry.reader.events.find(e => e.type === 'interaction.answered' && ((e.payload as any).id === value.id || (e.payload as any).commandId === value.commandId));
      if (prior) {
        const p = prior.payload as any;
        if (p.id !== value.id || p.commandId !== value.commandId || p.payloadHash !== hash(JSON.stringify(value.answer))) throw new ApiError(409,'answer_conflict','回答与原提交不同');
        return { status: 'answered' };
      }
      return this.interactions.answer(sessionId,value.id,value.commandId,value.answer as Json);
    });
  }
  async close() {
    this.closing = true;
    this.active?.abort.abort(new Error("服务正在停止"));
    await this.active?.done;
    this.naming?.abort.abort(new Error("服务正在停止"));
    await this.naming?.done;
    const workflowTask = this.workflowTask;
    if (workflowTask) { await this.customization.workflows.cancel(workflowTask.id, 0); await workflowTask.done; }
    await this.customization.close();
    await this.release();
  }
}
