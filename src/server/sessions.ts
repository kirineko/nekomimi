import type { HandoffRelationsView, DeliveriesView, HandoffStatesView } from '../shared/handoff-view.js';
import type { CoreSwitchBlocker, CoreSwitchReadiness } from '../core/switch-gate.js';
import { SDK_CONTRACT_VERSION } from '../shared/versions.js';
import { contextView, type assemblePrompt } from "../context.js";
import { measureContext, type ContextModel } from "../context-meter.js";
import type { ContextOccupancy } from "../shared/protocol.js";
import { CustomizationHost, validateExtension } from "../customization/host.js";
import { CoreOperations } from "../core/operations.js";
import { ValidationTasks } from "../customization/validation-tasks.js";
import { Candidates } from "../customization/candidates.js";
import { applyProjectDelivery, previewProjectDelivery, type ProjectDeliveryContext } from './candidate-delivery.js';
import { packageAction } from "../customization/package-management.js";
import { PROVIDER_PURPOSES, type ProviderPurpose, ProviderProfiles, type ProviderProfile } from "../customization/provider-profiles.js";
import { branchHistory } from "../customization/history-branch.js";
import { checkTypes } from "../customization/validation.js";
import { Interactions } from "../customization/interactions.js";
import type { Json } from "../customization/types.js";
import { nodeSyntax } from "../presentation/syntax/node.js";
import { diagnostic, readDiagnostics, saveDiagnostic } from "../diagnostics.js";
import type { Diagnostic } from "../shared/protocol.js";
import { ConfigStore } from "../config/store.js";
import { workspacePaths } from "../storage/paths.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { inspectJournalEventsFormat, inspectJournalFormat, openJournalStorage } from "../pi/journal-storage.js";
import { migrate } from "../storage/migrate.js";
import { nameSession } from "../session/title.js";
import { previewHandoff, prepareHandoffSummary } from "../session/handoff.js";
import { cleanHandoff } from "../session/handoff.js";
import { buildDeliverySnapshots, validateDeliveryVersions, inspectWorkDelivery } from "../session/delivery.js";
import { transferHandoff, handoffIntent, handoffRequestHash, readHandoffPayload, recordedHandoffReceipt, validateDeliveryReferences, type HandoffIntent, type HandoffStage } from "../session/handoff-transfer.js";
import { mkdir, realpath, readdir, rename, rm, open, stat } from "node:fs/promises";
import { createSessionBinding, creationHash, parseSessionCreation, sessionBinding, checkSessionTarget } from "../session/identity.js";
import { creationAction } from "../shared/mode-policy.js";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import {
  Journal,
  readSession,
  hash,
  id,
  artifactRefs,
  type JournalEvent,
} from "../journal.js";
import { run, type RunOptions } from "../runtime.js";
import {
  ApiError,
  parseHandoffIds,
  validId,
  type Receipt,
  type Submit,
  type SessionCreation,
  type SessionMode,
  type SessionBinding,
} from "../shared/protocol.js";
import { JournalReader } from "./journal-reader.js";
import { SessionProjection } from "../projection/session.js";
export interface Entry {
  targetError?: string;
  directory: string;
  reader: JournalReader;
  projection: SessionProjection;
  tail: Promise<unknown>;
  diagnostics: Diagnostic[];
}
export interface ServiceOptions {
  /** Fault injection at durable creation boundaries; never supplied by clients. */
  creationFault?: (stage: "intent" | "identity" | "created" | "committed") => Promise<void>;
  /** Durable metadata barriers for failure tests; not accepted from HTTP. */
  handoffFault?: (stage: HandoffStage) => Promise<void>;
  handoffJournalOptions?: import("../journal.js").JournalOptions;
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
  targetRoot: string;
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
  private handoffPreparations = new Map<string, { sourceSessionId: string; abort: AbortController; done: Promise<unknown> }>();
  private workflowTask?: { id: string; host: CustomizationHost; done: Promise<unknown>; error?: string };
  private candidateFrames = new Map<string, { sessionId:string; host: CustomizationHost; frame: { instanceId: string; nonce: string; url: string; fallback: string } }>();
  private createHosts = new Map<string, CustomizationHost>();
  validationTasks!: ValidationTasks;
  coreOperations!: CoreOperations;
  config!: ConfigStore;
  customization!: CustomizationHost;
  readonly interactions = new Interactions();
  paths!: Awaited<ReturnType<typeof workspacePaths>>;
  private gate = Promise.resolve();
  private runs = new Map<string, Active>();
  private titles = new Map<string, { sessionId: string; targetRoot: string; runId: string; abort: AbortController; done: Promise<void> }>();
  /** Compatibility observation for callers that only start one run. Use activeFor for session identity. */
  get active() { return this.runs.values().next().value; }
  get naming() { return this.titles.values().next().value; }
  activeFor(sessionId: string) { return this.runs.get(sessionId); }
  namingFor(sessionId: string) { return this.titles.get(sessionId); }
  private readers = new Map<string, number>();
  private coreSwitchFence?: string;
  private initializing = false;
  private initialization: Promise<void> = Promise.resolve();
  waitInitialization() { return this.initialization; }
  async coreSwitchBlockers(): Promise<CoreSwitchBlocker[]> {
    const blockers: CoreSwitchBlocker[] = [];
    if (this.initializing) blockers.push({ kind: 'initialization' });
    for (const task of this.runs.values()) blockers.push({ kind: 'run', id: task.runId, sessionId: task.sessionId, target: task.targetRoot, state: task.cancelling ? 'cancelling' : 'running' });
    for (const [sessionId, task] of this.titles) blockers.push({ kind: 'naming', id: task.runId, sessionId, target: task.targetRoot });
    for (const [id, task] of this.handoffPreparations) blockers.push({ kind: 'handoff-preparation', id, sessionId: task.sourceSessionId });
    for (const [sessionId, count] of this.readers) if (count) blockers.push({ kind: 'download', sessionId });
    for (const item of this.interactions.pending()) blockers.push({ kind: 'approval', id: item.id, sessionId: item.sessionId });
    for (const task of this.coreOperations.busy()) blockers.push({ kind: 'core-operation', id: task.commandId, sessionId: task.sessionId, target: task.target, state: task.cancelling ? 'cancelling' : 'running' });
    for (const task of this.validationTasks.busy()) blockers.push({ kind: 'validation', id: task.id, sessionId: task.sessionId, target: task.target, state: task.status });
    if (this.workflowTask) blockers.push({ kind: 'workflow-task', id: this.workflowTask.id });
    for (const host of new Set([this.customization, ...this.createHosts.values()])) {
      const target = host.catalog.workspace;
      if (host.busy) blockers.push({ kind: 'host', target });
      if (host.degraded) blockers.push({ kind: 'host', target, state: 'cleanup-unknown' });
      for (const receipt of host.receipts) if (receipt.status === 'pending') blockers.push({ kind: 'host-change', target, id: receipt.id });
      try { for (const workflow of await host.workflows.listReadonly()) if (!['completed', 'cancelled'].includes(workflow.status)) blockers.push({ kind: 'workflow', target, id: workflow.id, state: workflow.status }); }
      catch { blockers.push({ kind: 'workflow-history', target, state: 'unreadable' }); }
    }
    return blockers;
  }
  beginCoreSwitch(token: string): Promise<CoreSwitchReadiness> {
    return this.exclusive(async () => {
      if (typeof token !== 'string' || !validId(token)) throw new ApiError(400, 'input', '切换门禁 ID 无效');
      if (this.coreSwitchFence) return { ready: this.coreSwitchFence === token, ...(this.coreSwitchFence === token ? { token } : {}), blockers: this.coreSwitchFence === token ? [] : [{ kind: 'switch', id: this.coreSwitchFence }] };
      this.check();
      const blockers = await this.coreSwitchBlockers();
      if (blockers.length) return { ready: false, blockers };
      this.coreSwitchFence = token;
      return { ready: true, token, blockers: [] };
    });
  }
  endCoreSwitch(token: string) {
    return this.exclusive(async () => {
      if (this.coreSwitchFence && this.coreSwitchFence !== token) throw new ApiError(409, 'core_switching', '切换门禁不属于此命令');
      this.coreSwitchFence = undefined;
    });
  }
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
  private contextCache = new WeakMap<Entry, {key:string; value:{context?:ContextOccupancy; compacting:boolean}}>();
  async context(entry: Entry) {
    // Read metadata only: neither acquiring resources nor constructing a Provider is allowed here.
    const settings = await this.settings(), profiles = await new ProviderProfiles(this.paths.home).list();
    const binding = sessionBinding(entry.reader.events);
    const profile = profiles.entries[profiles.selection[binding?.mode??'work'] ?? profiles.selection.main ?? ''];
    const activation = binding?.mode === "create" ? this.createHosts.get(binding.target.id)?.active : this.customization.active;
    const running = this.runs.get(entry.reader.events[0]?.sessionId ?? "");
    const semantic=entry.reader.events.findLast(e=>['context.measured','context.add','context.usage','tool.result','tool.failed','recovery.tool_unknown','run.finished'].includes(e.type)||e.type.startsWith('compaction.'))?.eventId;
    const key = JSON.stringify([semantic, running?.runId, settings.revision, settings.model, settings.baseUrl, profiles.revision, activation?.revision]);
    const cached = this.contextCache.get(entry); if (cached?.key === key) return cached.value;
    const events = entry.reader.events;
    const recorded = events.findLast(e => e.type === 'context.measured')?.payload as {prompt:ReturnType<typeof assemblePrompt>;model:ContextModel;resourceRevision:string}|undefined;
    const latest = events.findLast(e => e.type.startsWith('compaction.') || e.type === 'run.finished');
    const compacting = latest?.type === 'compaction.started' && latest.runId === running?.runId && !!running;
    let context: ContextOccupancy | undefined;
    if (recorded && recorded.resourceRevision === activation?.revision) {
      const providerId=profile?.providerId ?? 'deepseek', modelId=profile?.model ?? settings.model;
      const registered=activation?.extensions.flatMap(e=>e.providers).find(p=>p.id===providerId);
      const definition=registered?.models.find(m=>m.id===modelId&&(m.operation??"chat")==="chat");
      const model:ContextModel={...recorded.model,id:modelId,provider:providerId,baseUrl:profile?.baseUrl??settings.baseUrl,
        contextIdentity:definition&&registered?`${registered.resource.hash}:${definition.protocol}:${definition.historyCompatibility}`:undefined,
        contextWindow:providerId==='deepseek'?(modelId==='deepseek-flash'?1_000_000:0):(definition?.contextWindow??0)};
      context=measureContext(contextView(events,recorded.prompt),model,events);
    }
    const value={context,compacting};this.contextCache.set(entry,{key,value});return value;
  }
  async migration(execute = false) {
    return this.exclusive(async () => {
      this.check();
      if (this.runs.size || this.titles.size)
        throw new ApiError(409, "busy", "请先停止活动任务");
      return migrate(this.paths, execute, this.options.legacyHome);
    });
  }
  async downloadLease(sessionId: string) {
    return this.exclusive(async () => {
      this.check();
      if (
        this.runs.has(sessionId) ||
        this.titles.has(sessionId)
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
        this.runs.has(sessionId) ||
        this.titles.has(sessionId) ||
        [...this.handoffPreparations.values()].some(task => task.sourceSessionId === sessionId) ||
        this.coreOperations.busy().some(task => task.sessionId === sessionId) ||
        this.validationTasks.busy().some(task => task.sessionId === sessionId) ||
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
          const deleted = (await this.creationEvents()).some(event => event.type === "session.deleted" && (event.payload as { sessionId?: string }).sessionId === sessionId);
          if (deleted) {
            let remaining: string | undefined;
            try { remaining = await this.sessionDirectory(sessionId); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
            if (remaining) {
              const unlock = await lockfile.lock(remaining, { retries: 0 });
              try { await rename(remaining, target); } finally { await unlock(); }
            }
          }
          await rm(target, { recursive: true, force: true });
          return { status: "deleted" };
        }
        throw e;
      }
      const release = await lockfile.lock(entry.directory, { retries: 0 });
      try {
        const catalog = await Journal.open(join(this.paths.root, "session-catalog"));
        try {
          if (!catalog.events.length) await catalog.append("session.catalog", { formatVersion: 2, workspace: this.workspace });
          if (!catalog.events.some(event => event.type === "session.deleted" && (event.payload as { sessionId?: string }).sessionId === sessionId))
            await catalog.append("session.deleted", { sessionId });
        } finally { await catalog.close(); }
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
    service.validationTasks = new ValidationTasks(paths.root);
    service.coreOperations = new CoreOperations(paths.root);
    service.config = new ConfigStore(paths.home);
    service.customization = new CustomizationHost(workspace, paths.home);
    service.release = await lockfile.lock(root, {
      stale: options.lockStaleMs ?? 10000,
      retries: 0,
      onCompromised: (e) => {
        service.leaseError = e;
        service.validationTasks.abortAll(e);
        service.coreOperations.abortAll(e);
        for (const task of [...service.runs.values(), ...service.titles.values(), ...service.handoffPreparations.values()]) task.abort.abort(e);
      },
    });
    for (const name of await readdir(paths.deleting))
      if (validId(name))
        await rm(join(paths.deleting, name), { recursive: true, force: true });
    service.initializing = true;
    service.initialization = service.customization.initialize().finally(() => { service.initializing = false; });
    void service.initialization.catch(() => {});
    return service;
  }
  check() {
    if (this.coreSwitchFence) throw new ApiError(409, "core_switching", "核心切换正在准备，暂不接受新操作");
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
  private async sessionHost(binding: SessionBinding) {
    await checkSessionTarget(binding, this.paths.home);
    if (binding.mode === "work") return this.customization;
    let host = this.createHosts.get(binding.target.id);
    if (!host) { host = new CustomizationHost(binding.target.root, this.paths.home); this.createHosts.set(binding.target.id, host); }
    return host;
  }
  async runtimeUi(sessionId?: string) {
    let host = this.customization;
    const binding = sessionId ? sessionBinding((await this.entry(sessionId)).reader.events) : undefined;
    if (sessionId) {
      if (!binding) throw new ApiError(422, 'session_identity', '会话缺少模式身份');
      host = await this.sessionHost(binding);
    }
    return { runtimeUi: await host.themes.describe(), panels: host.panels.catalog(), scope: binding ? {sessionId,mode:binding.mode,targetId:binding.target.id} : undefined };
  }
  async describeCustomization(sessionId?: string) {
    const settings = await this.settings();
    let host = this.customization;
    if (sessionId) {
      const binding = sessionBinding((await this.entry(sessionId)).reader.events);
      if (!binding) throw new ApiError(422, "session_identity", "会话缺少模式身份");
      host = await this.sessionHost(binding);
    }
    return { ...(await host.describe(!!settings.apiKey)), workflowBusy: this.workflowTask?.host === host, defaultModel: { providerId: 'deepseek', model: settings.model, baseUrl: settings.baseUrl, protocol: 'responses', configured: !!settings.apiKey } };
  }
  async candidateView(candidateId: string, sessionId?: string) {
    let host = this.customization;
    let binding: SessionBinding | undefined;
    if (sessionId) {
      binding = sessionBinding((await this.entry(sessionId)).reader.events);
      if (binding?.mode !== 'create') throw new ApiError(403, 'mode_permission', '候选目标需要创造会话');
      host = await this.sessionHost(binding);
    }
    const store = new Candidates(host.catalog.workspace), candidate = await store.view(candidateId);
    const managed = (await store.active()).find(item => item.resourceId === candidate.resourceId);
    let rollback: { contentHash: string; requestedCapabilities: string[] } | undefined, rollbackError: string | undefined;
    if (managed?.previous) {
      try { const previous = await store.previous(candidate.name); rollback = { contentHash: previous.hash, requestedCapabilities: previous.manifest?.requiredCapabilities ?? [] }; }
      catch { rollbackError = '回退版本不可读取或完整性验证失败'; }
    }
    const identity = await (await import('../customization/sdk.js')).hostIdentity();
    const records = (await host.lifecycle.evidence()).filter(item => item.resourceId === candidate.resourceId);
    const current = (item: typeof records[number]) => item.revision === candidate.contentHash && item.host === identity.build && item.environment?.node === process.version && item.environment.platform === process.platform && item.environment.arch === process.arch && item.environment.sdkVersion === SDK_CONTRACT_VERSION;
    return { ...candidate, rollback, rollbackError, target: binding?.target, host: identity, evidence: records.filter(current), previousEvidence: records.filter(item => !current(item)).slice(-20), validationTasks: sessionId ? await this.validationTasks.list(sessionId, candidateId) : [] };
  }
  async validationTaskView(sessionId: string) {
    const binding = sessionBinding((await this.entry(sessionId)).reader.events);
    if (binding?.mode !== 'create' || binding.target.kind !== 'extension') throw new ApiError(403, 'mode_permission', '验证任务需要扩展创造会话');
    return this.validationTasks.listSession(sessionId);
  }
  async validationPreview(sessionId: string, taskId: string) {
    const binding = sessionBinding((await this.entry(sessionId)).reader.events);
    if (binding?.mode !== 'create' || binding.target.kind !== 'extension') throw new ApiError(403, 'mode_permission', '预览需要扩展创造会话');
    const task = await this.validationTasks.read(taskId);
    if (!task || task.sessionId !== sessionId || task.stage !== 'preview') throw new ApiError(404, 'validation_missing', '此会话没有该预览任务');
    if (task.status !== 'passed') throw new ApiError(409, 'preview_not_ready', '预览尚未确认通过');
    const saved = this.candidateFrames.get(taskId);
    if (!saved) throw new ApiError(410, 'preview_expired', '预览实例已过期或服务已重启；不会自动重跑');
    try { await saved.host.panels.document(saved.frame.instanceId,sessionId); }
    catch { this.candidateFrames.delete(taskId); throw new ApiError(410, 'preview_expired', '预览实例已关闭或过期；不会自动重跑'); }
    return { frame: saved.frame };
  }
  async coreOperationView(sessionId: string) {
    const binding = sessionBinding((await this.entry(sessionId)).reader.events);
    if (binding?.mode !== 'create' || binding.target.kind !== 'core') throw new ApiError(403, 'mode_permission', '核心操作需要核心创造会话');
    return this.coreOperations.list(sessionId);
  }
  async coreLaunchInfo(sessionId: string, buildId: string) {
    const binding = sessionBinding((await this.entry(sessionId)).reader.events);
    if (binding?.mode !== 'create' || binding.target.kind !== 'core' || !binding.target.coreCandidate)
      throw new ApiError(403, 'mode_permission', '启动指引需要绑定的核心创造会话');
    await checkSessionTarget(binding, this.paths.home);
    if (!validId(buildId)) throw new ApiError(400, 'input', '构建编号无效');
    const { CoreCandidates } = await import('../core/candidates.js'), { CoreBuilds } = await import('../core/builds.js');
    const builds = new CoreBuilds(new CoreCandidates(this.workspace, this.paths.home));
    const owned = (await builds.records()).some(event => event.type === 'core.build.intent' && event.candidateId === binding.target.coreCandidate!.id
      && (event.payload as { buildId?: string }).buildId === buildId);
    if (!owned) throw new ApiError(404, 'not_found', '该构建不属于当前核心候选');
    return (await import('../core/managed.js')).coreLaunchInfo(builds, buildId);
  }
  async coreCandidateView(sessionId: string) {
    const binding = sessionBinding((await this.entry(sessionId)).reader.events);
    if (binding?.mode !== 'create' || binding.target.kind !== 'core') throw new ApiError(403, 'mode_permission', '核心候选需要绑定的核心创造会话');
    await checkSessionTarget(binding, this.paths.home);
    const { CoreCandidates } = await import('../core/candidates.js');
    const { coreCandidateView } = await import('../core/candidate-view.js');
    return coreCandidateView(new CoreCandidates(this.workspace, this.paths.home), binding.target);
  }
  async panelDocument(instanceId: string, sessionId?: string) {
    if (!sessionId) return this.customization.panels.document(instanceId);
    const binding = sessionBinding((await this.entry(sessionId)).reader.events);
    if (!binding) throw new ApiError(422, 'session_identity', '会话缺少模式身份');
    return (await this.sessionHost(binding)).panels.document(instanceId,sessionId);
  }
  async referenceWorkspace(sessionId?:string) {
    if(!sessionId)return this.workspace;
    const binding=sessionBinding((await this.entry(sessionId)).reader.events);
    if(!binding)throw new ApiError(422,'session_identity','会话缺少模式身份');
    await checkSessionTarget(binding,this.paths.home);
    return binding.target.root;
  }
  async commandCatalog(sessionId?: string) {
    if (!sessionId) return this.customization.commands("work");
    const binding = sessionBinding((await this.entry(sessionId)).reader.events);
    if (!binding) throw new ApiError(422, "session_identity", "会话缺少模式身份");
    return (await this.sessionHost(binding)).commands(binding.mode);
  }
  async handoffReferenceOptions(sessionId: string) {
    const entry = await this.entry(sessionId), settings = await this.settings();
    const allowed = new Set(['context.add', 'tool.completed', 'tool.failed', 'recovery.tool_unknown', 'compaction.completed', 'handoff.received']);
    const events = entry.reader.events.filter(event => allowed.has(event.type));
    const secrets = [settings.apiKey ?? '', ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)];
    return { omitted: Math.max(0, events.length - 100), items: events.slice(-100).reverse().map(event => ({ sessionId, eventId: event.eventId, type: event.type, payloadHash: hash(JSON.stringify(event.payload)),
      excerpt: JSON.stringify(cleanHandoff(event.payload, secrets)).slice(0, 2000) })) };
  }
  async handoffPreview(sourceSessionId: string, draft: unknown) {
    this.check();
    const settings = await this.settings();
    const preview = await previewHandoff({ sourceSessionId, draft, ownerWorkspace: this.workspace, home: this.paths.home,
      secrets: [settings.apiKey ?? "", ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)],
      observe: async sessionId => { const entry = await this.entry(sessionId); return { directory: entry.directory, events: entry.reader.events.slice() }; },
      resolveDelivery: async (source, target, selections) => buildDeliverySnapshots({ source, target, selections, development: await this.sessionHost(source), work: await this.sessionHost(target) }) });
    if (preview.creation) {
      const catalog = await this.creationEvents();
      if (catalog.some(event => event.type === "session.deleted" && (event.payload as any).sessionId === preview.target.sessionId))
        throw new ApiError(410, "session_deleted", "该目标创建命令对应的会话已删除，请选择新目标");
      const prior = catalog.find(event => event.type === "session.create.intent" && (event.payload as any).commandId === preview.creation!.input.commandId);
      if (prior && JSON.stringify((prior.payload as any).binding) !== JSON.stringify(preview.target))
        throw new ApiError(409, "command_conflict", "目标创建命令已绑定其他内容或身份，请选择新目标");
      if (catalog.some(event => event.type === "session.create.committed" && (event.payload as any).sessionId === preview.target.sessionId))
        await this.sessionDirectory(preview.target.sessionId);
    }
    return preview;
  }
  async prepareHandoff(sourceSessionId: string, value: Record<string, unknown>, signal?: AbortSignal) {
    const { key, task } = await this.exclusive(async () => {
      this.check();
      if (value.version !== 1 || typeof value.commandId !== "string" || !validId(value.commandId) || typeof value.payloadHash !== "string")
        throw new ApiError(400, "handoff_command", "摘要准备参数无效");
      const preview = await this.handoffPreview(sourceSessionId, value.draft);
      if (preview.payloadHash !== value.payloadHash) throw new ApiError(409, "handoff_changed", "交接输入已变化，请重新预览");
      const key = hash(JSON.stringify([sourceSessionId, value.commandId]));
      if (this.handoffPreparations.has(key)) throw new ApiError(409, "handoff_preparation", "该摘要准备任务仍在运行");
      if (this.handoffPreparations.size >= 8) throw new ApiError(409, "busy", "交接摘要准备任务已达到并发上限");
      const settings = await this.settings();
      if (!settings.apiKey && !(await new ProviderProfiles(this.paths.home).resolve("handoff"))) throw new ApiError(422, "model_unavailable", "摘要模型未配置凭证");
      const binding = sessionBinding((await this.entry(sourceSessionId)).reader.events)!;
      const host = await this.sessionHost(binding), abort = new AbortController();
      const secrets = [settings.apiKey ?? "", ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)];
      this.check();
      const task = { sourceSessionId, abort, done: Promise.resolve() as Promise<unknown> };
      this.handoffPreparations.set(key, task);
      const validate = async () => {
        this.check();
        const current = await this.handoffPreview(sourceSessionId, value.draft);
        if (current.payloadHash !== preview.payloadHash) throw new ApiError(409, "handoff_changed", "源记录、引用或目标已变化，未提交迟到摘要");
      };
      task.done = prepareHandoffSummary({ directory: join(this.paths.root, "handoff-preparations", key), preview, commandId: value.commandId,
        host, settings: { ...this.options.runtime, ...settings, apiKey: settings.apiKey ?? "", mode: binding.mode },
        secrets,
        signal: AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]), validate,
      });
      return { key, task };
    });
    try { return await task.done; } finally { if (this.handoffPreparations.get(key) === task) this.handoffPreparations.delete(key); }
  }
  async cancelHandoffPreparation(sourceSessionId: string, commandId: unknown) {
    this.check(); await this.entry(sourceSessionId);
    if (typeof commandId !== "string" || !validId(commandId)) throw new ApiError(400, "handoff_command", "摘要命令无效");
    const task = this.handoffPreparations.get(hash(JSON.stringify([sourceSessionId, commandId])));
    task?.abort.abort(new Error("用户取消交接摘要"));
    return { status: task ? "cancelling" : "not_running" };
  }
  private handoffBusy(sourceSessionId: string, targetSessionId?: string) {
    if ([sourceSessionId, targetSessionId].some(id => id && (this.runs.has(id) || this.titles.has(id))))
      throw new ApiError(409, "busy", "交接关联会话仍在运行或命名，请先等待停止");
  }
  private async receiveHandoffTarget(sourceSessionId: string, accepted: import("../shared/protocol.js").HandoffPreview) {
    this.check(); this.handoffBusy(sourceSessionId, accepted.target.sessionId);
    if (accepted.creation) await this.createInner(accepted.creation.title, accepted.creation.input, accepted.target);
    const target = await this.entry(accepted.target.sessionId), binding = sessionBinding(target.reader.events);
    if (!binding) throw new ApiError(422, "handoff_target", "目标缺少持久绑定，不能接收交接");
    await checkSessionTarget(binding, this.paths.home);
    return { directory: target.directory, binding };
  }
  private async validateHandoffDelivery(sourceSessionId: string, accepted: import("../shared/protocol.js").HandoffPreview) {
    if (!accepted.delivery) return;
    const source = sessionBinding((await this.entry(sourceSessionId)).reader.events);
    if (!source || source.mode !== "create" || source.target.id !== accepted.source.targetId) throw new ApiError(403, "delivery_scope", "交付来源身份已变化");
    await validateDeliveryVersions(await this.sessionHost(source), accepted.delivery);
  }
  async confirmHandoff(sourceSessionId: string, value: Record<string, unknown>) {
    return this.exclusive(async () => {
      this.check();
      if (value.version !== 1 || value.confirmed !== true || typeof value.commandId !== "string" || !validId(value.commandId) ||
          typeof value.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(value.payloadHash))
        throw new ApiError(400, "handoff_confirmation", "交接需要明确确认、固定命令和预览 hash");
      const entry = await this.entry(sourceSessionId), prior = handoffIntent(entry.reader.events, value.commandId);
      const settings = await this.settings(), secrets = [settings.apiKey ?? "", ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)];
      const requestHash = handoffRequestHash(cleanHandoff({ draft: value.draft, payloadHash: value.payloadHash }, secrets));
      const preview = prior ? undefined : await this.handoffPreview(sourceSessionId, value.draft);
      if (preview && preview.payloadHash !== value.payloadHash) throw new ApiError(409, "handoff_changed", "交接输入已变化，请重新预览并确认");
      if (!prior || !entry.reader.events.some(event => event.type === "handoff.committed" && (event.payload as HandoffIntent).handoffId === (prior.payload as HandoffIntent).handoffId))
        this.handoffBusy(sourceSessionId, preview?.target.sessionId ?? (prior?.payload as HandoffIntent | undefined)?.targetSessionId);
      return transferHandoff({ sourceDirectory: entry.directory, sourceSessionId, ownerWorkspace: this.workspace, commandId: value.commandId,
        payloadHash: value.payloadHash, requestHash, preview, secrets, journalOptions: this.options.handoffJournalOptions, fault: this.options.handoffFault,
        validatePreview: accepted => this.validateHandoffDelivery(sourceSessionId, accepted),
        ensureTarget: accepted => this.receiveHandoffTarget(sourceSessionId, accepted) });
    });
  }
  async recoverHandoff(sourceSessionId: string, value: Record<string, unknown>) {
    return this.exclusive(async () => {
      this.check();
      if (value.version !== 1 || typeof value.commandId !== "string" || !validId(value.commandId)) throw new ApiError(400, "handoff_command", "恢复交接命令无效");
      if (value.draft !== undefined) throw new ApiError(400, "handoff_recovery", "恢复只能使用已接受的交接快照，不能提供新内容");
      const entry = await this.entry(sourceSessionId), intent = handoffIntent(entry.reader.events, value.commandId);
      if (!intent) throw new ApiError(404, "handoff_missing", "没有已接受的交接意图，恢复不会新建交接");
      if (value.payloadHash !== undefined && value.payloadHash !== (intent.payload as HandoffIntent).payloadHash)
        throw new ApiError(409, "command_conflict", "恢复请求的内容 hash 与原交接不同");
      if (!entry.reader.events.some(event => event.type === "handoff.committed" && (event.payload as HandoffIntent).handoffId === (intent.payload as HandoffIntent).handoffId))
        this.handoffBusy(sourceSessionId, (intent.payload as HandoffIntent).targetSessionId);
      const settings = await this.settings(), secrets = [settings.apiKey ?? "", ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)];
      return transferHandoff({ sourceDirectory: entry.directory, sourceSessionId, ownerWorkspace: this.workspace, commandId: value.commandId,
        secrets, journalOptions: this.options.handoffJournalOptions, fault: this.options.handoffFault,
        validatePreview: accepted => this.validateHandoffDelivery(sourceSessionId, accepted),
        ensureTarget: accepted => this.receiveHandoffTarget(sourceSessionId, accepted) });
    });
  }
  async handoffStates(sourceSessionId: string): Promise<HandoffStatesView> {
    this.check(); const entry = await this.entry(sourceSessionId);
    const result = [];
    for (const intent of entry.reader.events.filter(event => event.type === "handoff.intent")) {
      const metadata = intent.payload as HandoffIntent;
    const preview = await readHandoffPayload(entry.directory, intent);
      const committed = entry.reader.events.find(event => event.type === "handoff.committed" && (event.payload as HandoffIntent).handoffId === metadata.handoffId);
      let phase: HandoffStage = committed ? "committed" : "intent", error: string | undefined;
      if (preview.delivery) try { await this.validateHandoffDelivery(sourceSessionId, preview); } catch (failure) { error = String(failure); }
      try {
        const target = await this.entry(metadata.targetSessionId);
        if (JSON.stringify(sessionBinding(target.reader.events)) !== JSON.stringify(preview.target)) throw new Error("目标身份与交接不一致");
        if (target.targetError) throw new Error(target.targetError);
        const received = target.reader.events.find(event => event.type === "handoff.received" && (event.payload as HandoffIntent).handoffId === metadata.handoffId);
        if (received) {
          const payload = await readHandoffPayload(target.directory, received);
          if (payload.payloadHash !== preview.payloadHash) throw new Error("目标接收快照与源交接不一致");
        }
        if (!committed) phase = received ? "received" : "target";
      } catch (failure) {
        const missingNewTarget = preview.creation && failure instanceof ApiError && failure.code === "not_found";
        if (!missingNewTarget || (await this.creationEvents()).some(event => ["session.deleted", "session.create.committed"].includes(event.type) && (event.payload as any).sessionId === metadata.targetSessionId)) error = String(failure);
      }
      result.push({ handoffId: metadata.handoffId, commandId: metadata.commandId, sourceSessionId, targetSessionId: metadata.targetSessionId,
        payloadHash: metadata.payloadHash, sourceRevision: preview.source.revision, phase, status: error ? "blocked" : committed ? "committed" : "pending",
        ...(committed ? { receipt: recordedHandoffReceipt(intent, committed) } : {}), ...(error ? { error } : {}), createsTask: false, grantsPermissions: false });
    }
    return { items: result };
  }
  /** Relationships are metadata observations; a missing source is never recreated. */
  async handoffRelations(sessionId: string): Promise<HandoffRelationsView> {
    this.check(); const entry = await this.entry(sessionId), items = [];
    for (const event of entry.reader.events.filter(event => ["handoff.intent", "handoff.received"].includes(event.type))) {
      const snapshot = await readHandoffPayload(entry.directory, event), metadata = event.payload as HandoffIntent;
      let sourceAvailable = false, targetAvailable = false, sourceSnapshotRetained = false, targetSnapshotRetained = false;
      try {
        const entry = await this.entry(metadata.sourceSessionId), source = sessionBinding(entry.reader.events);
        const record = entry.reader.events.find(event => event.type === "handoff.intent" && event.handoffId === metadata.handoffId);
        sourceSnapshotRetained = !!record && (await readHandoffPayload(entry.directory, record)).payloadHash === metadata.payloadHash;
        sourceAvailable = !!source && source.mode === snapshot.source.mode && source.target.id === snapshot.source.targetId;
      } catch {}
      try {
        const target = await this.entry(metadata.targetSessionId);
        targetAvailable = !target.targetError && JSON.stringify(sessionBinding(target.reader.events)) === JSON.stringify(snapshot.target);
        const record = target.reader.events.find(event => event.type === "handoff.received" && event.handoffId === metadata.handoffId);
        targetSnapshotRetained = !!record && (await readHandoffPayload(target.directory, record)).payloadHash === metadata.payloadHash;
      } catch {}
      items.push({ handoffId: metadata.handoffId, direction: event.type === "handoff.received" ? "incoming" : "outgoing",
        sourceSessionId: metadata.sourceSessionId, targetSessionId: metadata.targetSessionId, payloadHash: metadata.payloadHash,
        sourceAvailable, targetAvailable, sourceSnapshotRetained, targetSnapshotRetained, sourceEvidence: sourceAvailable ? "available" : "unavailable", snapshot,
        createsTask: false, grantsPermissions: false });
    }
    return { items };
  }
  async deletionPreview(sessionId: string) {
    await this.entry(sessionId); const relations = await this.handoffRelations(sessionId);
    return { sessionId, busy: this.runs.has(sessionId) || this.titles.has(sessionId) || [...this.handoffPreparations.values()].some(task => task.sourceSessionId === sessionId) || !!this.readers.get(sessionId),
      removes: ["journal", "artifacts", "rebuildable-cache"], preserves: ["related-sessions", "workspace-files", "candidates", "active-capabilities"],
      relations: relations.items.map(({ snapshot, ...metadata }) => ({ ...metadata, snapshotRetainedInOtherSession: metadata.direction === "incoming" ? metadata.sourceSnapshotRetained : metadata.targetSnapshotRetained })),
      selectedSessionEvidenceAfterDelete: "unavailable", createsTask: false };
  }
  async deliveries(sessionId: string): Promise<DeliveriesView> {
    this.check();
    const entry = await this.entry(sessionId), binding = sessionBinding(entry.reader.events);
    if (!binding) throw new ApiError(422, "session_identity", "会话缺少交付身份");
    const items = [];
    for (const event of entry.reader.events.filter(event => binding.mode === "work" ? event.type === "handoff.received" : event.type === "handoff.intent")) {
      const payload = await readHandoffPayload(entry.directory, event);
      if (!payload.delivery?.length) continue;
      const metadata = event.payload as HandoffIntent;
      let sourceAvailable = false, targetAvailable = true, source: SessionBinding | undefined, targetEvents: readonly JournalEvent[] = [];
      try { source = sessionBinding((await this.entry(payload.source.sessionId)).reader.events); sourceAvailable = !!source && source.mode === "create" && source.target.id === payload.source.targetId; } catch {}
      try { const target = await this.entry(payload.target.sessionId); targetEvents = target.reader.events; targetAvailable = !target.targetError && JSON.stringify(sessionBinding(target.reader.events)) === JSON.stringify(payload.target); } catch { targetAvailable = false; }
      const current = [];
      for (const snapshot of payload.delivery) {
        let versionState = sourceAvailable ? "current" : "source-unavailable", error: string | undefined;
        if (sourceAvailable && source) try { await validateDeliveryVersions(await this.sessionHost(source), [snapshot]); } catch (failure) { versionState = "changed-or-missing"; error = String(failure); }
        let work;
        if (targetAvailable) work = await inspectWorkDelivery(await this.sessionHost(payload.target), snapshot);
        current.push({ resourceId: snapshot.resourceId, revision: snapshot.revision, versionState, targetAvailable,
          ...(work ? { work } : {}), ...(error ? { error } : {}) });
      }
      const consumedBy = targetEvents.filter(event => event.type === "delivery.referenced" && event.handoffId === metadata.handoffId).map(event => ({ eventId: event.eventId, runId: event.runId, commandId: (event.payload as any).commandId }));
      items.push({ handoffId: metadata.handoffId, payloadHash: payload.payloadHash, sourceSessionId: payload.source.sessionId, targetSessionId: payload.target.sessionId,
        snapshot: payload.delivery, current, sourceAvailable, targetAvailable, consumedBy, receivedEventId: binding.mode === "work" ? event.eventId : undefined,
        executesCommand: false, grantsPermissions: false });
    }
    return { items };
  }
  private async managementBlocked(action: string, sessionId: string | undefined, binding: SessionBinding | undefined, reason: string) {
    const settings = await this.settings();
    const journal = await Journal.open(join(this.paths.root, "session-catalog"), { secrets: [settings.apiKey ?? "", ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)] });
    try {
      if (!journal.events.length) await journal.append("session.catalog", { formatVersion: 2, workspace: this.workspace });
      await journal.append("operation.blocked", { action, sourceSessionId: sessionId, reason, mode: binding?.mode }, { mode: binding?.mode, targetId: binding?.target.id });
    } finally { await journal.close(); }
    throw new ApiError(403, "mode_permission", reason);
  }
  private async creationEvents() {
    try { return (await readSession(join(this.paths.root, "session-catalog"))).events; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
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
    if (first.type !== "durable.session" || first.seq !== 1 || first.schemaVersion !== 1 ||
        first.previousHash !== "" || hash(JSON.stringify(body)) !== digest ||
        (first.payload as {workspace?: string})?.workspace !== this.workspace)
      throw new ApiError(403, "workspace", "会话不属于当前工作区");
    const saved = await readDiagnostics(directory);
    const merged = new Map(saved.map(value => [value.id, value]));
    for (const value of this.entries.get(sessionId)?.diagnostics ?? []) merged.set(value.id, value);
    return [...merged.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  async entry(sessionId: string, project = true): Promise<Entry> {
    if ((await this.creationEvents()).some(event => event.type === "session.deleted" && (event.payload as { sessionId?: string }).sessionId === sessionId))
      throw new ApiError(404, "not_found", "会话不存在（已删除）");
    const directory = await this.sessionDirectory(sessionId);
    let entry = this.entries.get(sessionId);
    if (!entry) {
      const reader = new JournalReader(directory);
      if (project) await inspectJournalFormat(directory, this.workspace);
      else {
        // Metadata reads verify the reliable chain without opening display artifacts.
        await reader.refresh();
        inspectJournalEventsFormat(reader.events, this.workspace);
      }
      entry = this.entries.get(sessionId);
      if (!entry) {
      if (this.entries.size >= 32) {
        const oldest = [...this.entries.keys()].find(
          (key) => !this.runs.has(key) && !this.titles.has(key),
        );
        if (oldest) this.entries.delete(oldest);
      }
      entry = {
        directory,
        reader,
        projection: new SessionProjection(directory),
        tail: Promise.resolve(),
        diagnostics: [],
      };
      const initialized = entry;
      initialized.tail = readDiagnostics(directory).then(values => { initialized.diagnostics = values; });
      this.entries.set(sessionId, entry);
      }
    }
    const current = entry;
    const update = current.tail.then(async () => {
      await current.reader.refresh();
      const meta = current.reader.events.find(
        (e) => e.type === "session.created",
      )?.payload as { workspace?: string; ownerWorkspace?: string } | undefined;
      const binding = sessionBinding(current.reader.events);
      if (binding && binding.sessionId !== sessionId) throw new ApiError(422, "session_identity", "会话路径与身份不一致");
      if ((binding?.ownerWorkspace ?? meta?.ownerWorkspace ?? meta?.workspace) !== this.workspace)
        throw new ApiError(403, "workspace", "会话不属于当前工作区");
      if (binding) {
        try { await checkSessionTarget(binding, this.paths.home); current.targetError = undefined; }
        catch (error) { current.targetError = error instanceof Error ? error.message : String(error); }
      }
      if (project) await current.projection.update(current.reader.events);
    });
    current.tail = update.catch(() => {});
    await update;
    return current;
  }
  info(sessionId: string, entry: Entry) {
    const binding = sessionBinding(entry.reader.events);
    return {
      ...entry.projection.info(
        sessionId,
        entry.reader.events,
        this.runs.get(sessionId),
      ),
      naming: this.titles.has(sessionId),
      namingRunId: this.titles.get(sessionId)?.runId,
      diagnostic: entry.diagnostics.at(-1),
      ...(binding ? { binding, targetState: entry.targetError ? "unavailable" as const : "available" as const, targetError: entry.targetError } : {}),
    };
  }
  async create(title: string, creation?: SessionCreation) {
    return this.exclusive(() => this.createInner(title, creation));
  }
  private async createInner(title: string, creation?: SessionCreation, expectedBinding?: SessionBinding) {
    this.check();
    const input = parseSessionCreation(creation ?? { commandId: id(), mode: "work" });
    const payloadHash = creationHash(title, input);
    const sessionId = hash(JSON.stringify([this.workspace, input.commandId]));
    const settings = await this.settings();
    const secrets = [settings.apiKey ?? "", ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)];
    // A Journal registry retains creation receipts independently of a deleted
    // conversation. It is authoritative metadata, not a second history store.
    const catalog = await Journal.open(join(this.paths.root, "session-catalog"), { secrets, lockStaleMs: this.options.lockStaleMs });
    try {
    if (!catalog.events.length) await catalog.append("session.catalog", { formatVersion: 2, workspace: this.workspace });
    const root = catalog.events[0];
    if (root?.type !== "session.catalog" || (root.payload as { formatVersion?: number; workspace?: string }).formatVersion !== 2 || (root.payload as { workspace?: string }).workspace !== this.workspace)
      throw new ApiError(422, "session_identity", "会话创建注册日志格式不受支持");
    const prior = catalog.events.find(event => event.type === "session.create.intent" && (event.payload as { commandId?: string }).commandId === input.commandId);
    if (prior && (prior.payload as { payloadHash: string }).payloadHash !== payloadHash)
      throw new ApiError(409, "command_conflict", "同一创建命令 ID 的模式、目标或内容不同");
    if (catalog.events.some(event => event.type === "session.deleted" && (event.payload as { sessionId?: string }).sessionId === sessionId))
      throw new ApiError(410, "session_deleted", "该创建命令对应的会话已删除，请使用新命令创建");
    const accepted = prior?.payload as { binding: import("../shared/protocol.js").SessionBinding; title: string; model: string; baseUrl: string } | undefined;
    if (expectedBinding && accepted && catalog.events.some(event => event.type === "session.create.committed" && (event.payload as any).sessionId === sessionId)) {
      try { await this.sessionDirectory(sessionId); }
      catch { throw new ApiError(410, "session_deleted", "已创建的交接目标记录丢失，恢复不会重建目标"); }
    }
    const binding = accepted?.binding ?? await createSessionBinding(this.workspace, sessionId, input, payloadHash, this.paths.home);
    if (expectedBinding) {
      if (JSON.stringify(binding) !== JSON.stringify(expectedBinding)) throw new ApiError(409, "handoff_target", "创造目标身份与已确认交接不一致");
      await checkSessionTarget(binding, this.paths.home);
    }
    if (catalog.clean(JSON.stringify(binding)) !== JSON.stringify(binding)) throw new ApiError(422, "session_identity", "会话身份不能包含凭证");
    const metadata = accepted ?? { commandId: input.commandId, payloadHash, binding, location: join(this.root, sessionId), title: title.trim().slice(0, 100) || "新会话", model: settings.model, baseUrl: settings.baseUrl.replace(/\/$/, "") };
    if (!prior) await catalog.append("session.create.intent", metadata, { mode: binding.mode, targetId: binding.target.id });
    await this.options.creationFault?.("intent");
    const directory = join(this.root, sessionId);
    const durableStorage = await openJournalStorage(directory, BACKGROUND_CONTEXT, { secrets, lockStaleMs: this.options.lockStaleMs }, { workspace: this.workspace, binding });
    const j = durableStorage.journal;
    try {
      await this.options.creationFault?.("identity");
      const existing = sessionBinding(j.events);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(binding)) throw new ApiError(422, "session_identity", "会话创建身份不一致");
      const links = { mode: binding.mode, targetId: binding.target.id };
      if (!j.events.some(event => event.type === "session.created")) await j.append("session.created", {
        workspace: binding.target.root, ownerWorkspace: this.workspace,
        model: metadata.model, baseUrl: metadata.baseUrl, binding,
      }, links);
      if (!j.events.some(event => event.type === "web.session")) await j.append("web.session", { title: metadata.title }, links);
      await this.options.creationFault?.("created");
    } finally {
      await durableStorage.storage.close(BACKGROUND_CONTEXT);
    }
    if (!catalog.events.some(event => event.type === "session.create.committed" && (event.payload as { sessionId?: string }).sessionId === sessionId))
      await catalog.append("session.create.committed", { commandId: input.commandId, payloadHash, sessionId }, { mode: binding.mode, targetId: binding.target.id });
    await this.options.creationFault?.("committed");
    return this.info(sessionId, await this.entry(sessionId));
    } finally { await catalog.close(); }
  }
  private listCache = new Map<string, { stamp: string; info: ReturnType<Sessions["info"]> }>();
  async list(offset: number, limit: number, revision?: string, filter: { mode?: SessionMode; targetId?: string } = {}) {
    const ids = (await readdir(this.root)).filter(validId);
    const deleted = new Set((await this.creationEvents()).filter(event => event.type === "session.deleted").map(event => (event.payload as { sessionId: string }).sessionId));
    const live = new Set(ids);
    for (const cached of this.listCache.keys()) if (!live.has(cached)) this.listCache.delete(cached);
    const results = [];
    for (const sessionId of ids) {
      if (deleted.has(sessionId)) { this.listCache.delete(sessionId); continue; }
      try {
        const directory = await this.sessionDirectory(sessionId);
        const mark = await stat(join(directory, "durable.json"));
        const journal = await stat(join(directory, "journal.jsonl"));
        const stamp = `${mark.ino}:${mark.mtimeMs}:${mark.ctimeMs}:${mark.size}:${journal.ino}:${journal.mtimeMs}:${journal.size}:${this.runs.has(sessionId) ? this.runs.get(sessionId)!.cancelling ? "cancelling" : "running" : "inactive"}`;
        let cached = this.listCache.get(sessionId);
        if (!cached || cached.stamp !== stamp || this.runs.has(sessionId) || this.titles.has(sessionId)) {
          cached = { stamp, info: this.info(sessionId, await this.entry(sessionId, false)) };
          this.listCache.set(sessionId, cached);
        }
        let targetError: string | undefined;
        if (cached.info.binding) try { await checkSessionTarget(cached.info.binding, this.paths.home); } catch (error) { targetError = String(error); }
        if ((!filter.mode || cached.info.binding?.mode === filter.mode) && (!filter.targetId || cached.info.binding?.target.id === filter.targetId))
          results.push({ ...cached.info, ...(cached.info.binding ? { targetState: targetError ? "unavailable" as const : "available" as const, targetError } : {}), naming: this.titles.has(sessionId), namingRunId: this.titles.get(sessionId)?.runId });
      } catch {
        this.listCache.delete(sessionId);
        // Unmanaged or corrupt entries are not readable sessions.
      }
    }
    results.sort((a, b) => (b.activityAt ? Date.parse(b.activityAt) : -8640000000000000) - (a.activityAt ? Date.parse(a.activityAt) : -8640000000000000) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const listRevision = hash(JSON.stringify(results.map(s => [s.id, s.activityAt])));
    if (revision && revision !== listRevision) throw new ApiError(409, "list_changed", "会话顺序已更新，正在重新加载");
    return {
      sessions: results.slice(offset, offset + limit),
      next: offset + limit < results.length ? offset + limit : undefined,
      listRevision,
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
    const entry = await this.entry(sessionId);
    const binding = sessionBinding(entry.reader.events);
    if (!binding) throw new ApiError(422, "session_identity", "会话缺少模式身份，请使用新会话");
    await checkSessionTarget(binding, this.paths.home);
    const host = await this.sessionHost(binding);
    const handoffIds = parseHandoffIds(command.handoffIds);
    const payloadHash = hash(JSON.stringify({ prompt: command.prompt, ...(handoffIds?.length ? { handoffIds } : {}) }));
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
          : this.runs.get(sessionId)?.runId === prior.runId
            ? "running"
            : "interrupted",
      };
    }
    await validateDeliveryReferences(entry.directory, entry.reader.events, binding, handoffIds ?? []);
    const current = this.runs.get(sessionId);
    if (current) {
      if (current.commandId === command.commandId && current.payloadHash === payloadHash) return current.accepted;
      throw new ApiError(409, "busy", "该会话已有任务运行，请等待完成或取消");
    }
    // A host owns one mutable activation at a time. Independent targets may run together.
    if ([...this.runs.values()].some(task => task.targetRoot === binding.target.root) || host.workflows.busy || this.workflowTask?.host.catalog.workspace === binding.target.root)
      throw new ApiError(409, "busy", "该目标已有任务运行，请等待完成或取消");
    const naming = [...this.titles.values()].find(task => task.targetRoot === binding.target.root);
    if (naming) {
      naming.abort.abort(new Error("同一目标的新任务优先"));
      await naming.done;
    }
    if (host.busy) throw new ApiError(409, "busy", "该目标宿主仍在停止，请稍后重试");
    const settings = await this.settings();
    if (!settings.apiKey && !(await new ProviderProfiles(this.paths.home).resolve(/^\/compact(?:\s|$)/.test(command.prompt.trim())?"compaction":binding.mode)))
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
      targetRoot: binding.target.root,
      sessionId,
      runId: id(),
      commandId: command.commandId,
      payloadHash,
      abort: new AbortController(),
      cancelling: false,
      accepted,
      done: Promise.resolve(),
    };
    this.check();
    this.runs.set(sessionId, active);
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
      workspace: binding.target.root,
      home: this.paths.home,
      customization: host,
      mode: binding.mode,
      interactions: this.interactions,
      journalOptions: { ...this.options.runtime?.journalOptions, onDiagnostic: receiveDiagnostic },
      session: entry.directory,
      apiKey: settings.apiKey ?? "",
      model: settings.model,
      baseUrl: settings.baseUrl,
      search: settings.search,
      autoCompact: settings.autoCompact,
      prompt: command.prompt,
      handoffIds,
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
          !result.replayed &&
          !/^\/compact(?:\s|$)/.test(command.prompt.trim()) &&
          !this.closing &&
          this.options.naming !== false
        ) {
          const naming = {
            targetRoot: binding.target.root,
            sessionId,
            runId: id(),
            abort: new AbortController(),
            done: Promise.resolve(),
          };
          this.titles.set(sessionId, naming);
          naming.done = nameSession(
            entry.directory,
            { ...this.options.runtime, ...settings, apiKey: settings.apiKey ?? "" },
            naming.abort.signal,
            { onDiagnostic: receiveDiagnostic, diagnosticRunId: naming.runId },
            host,
          )
            .catch(async error => { if (!naming.abort.signal.aborted) await reportBackground(error, naming.runId, "background.naming"); })
            .finally(() => {
              if (this.titles.get(sessionId) === naming) this.titles.delete(sessionId);
            });
        }
      })
      .catch(async (error) => {
        reject(error);
        if (!active.abort.signal.aborted) await reportBackground(error, active.runId, "background.run");
      })
      .finally(() => {
        if (this.runs.get(sessionId) === active) this.runs.delete(sessionId);
      });
    return accepted;
  }
  async cancel(sessionId: string, runId: string) {
    this.check();
    await this.entry(sessionId);
    const active = this.runs.get(sessionId), naming = this.titles.get(sessionId);
    if (active?.runId === runId) {
      active.cancelling = true;
      active.abort.abort(new Error("用户取消"));
      return { status: "cancelling" };
    }
    if (naming?.runId === runId) {
      naming.abort.abort(new Error("用户取消命名"));
      return { status: "cancelling" };
    }
    return { status: "not_running" };
  }
  async customizationAction(value: Record<string, unknown>) {
    return this.exclusive(async () => {
      this.check();
      const action = String(value.action ?? "");
      const sessionId = typeof value.sessionId === "string" ? value.sessionId : undefined;
      const binding = sessionId ? sessionBinding((await this.entry(sessionId)).reader.events) : undefined;
      let needsCreate = creationAction(action);
      if (action === "set" && value.enabled === true && value.trusted === true) {
        const active = this.customization.active?.resources.find(resource => resource.id === value.id);
        const current = (await this.customization.catalog.discover()).find(resource => resource.id === value.id);
        const grant = current && await this.customization.catalog.grant(current);
        needsCreate = !active || !current || active.hash !== current.hash || !grant?.trusted || !!current.manifest?.requiredCapabilities?.some(capability => !grant.capabilities?.includes(capability));
      }
      if (needsCreate && binding?.mode !== "create") return this.managementBlocked(action, sessionId, binding, "创造管理操作需要绑定的创造会话；模式不授予额外权限");
      if (action === 'candidate-delivery-preview' || action === 'candidate-delivery-apply') {
        if (!binding || binding.target.kind !== 'extension' || typeof value.targetSessionId !== 'string' || !validId(value.targetSessionId) ||
            typeof value.handoffId !== 'string' || !/^[a-f0-9]{64}$/.test(value.handoffId) || typeof value.id !== 'string' || !/^[a-z0-9-]{1,100}$/.test(value.id) ||
            typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash))
          throw new ApiError(400, 'delivery_input', '项目交付需要绑定的创造会话、工作会话和确切交付版本');
        const targetSessionId = value.targetSessionId, handoffId = value.handoffId, candidateId = value.id, contentHash = value.contentHash;
        const resolve = async (): Promise<ProjectDeliveryContext> => {
          const target = sessionBinding((await this.entry(targetSessionId)).reader.events);
          if (!target || target.mode !== 'work' || target.ownerWorkspace !== binding.ownerWorkspace) throw new ApiError(403,'delivery_scope','交付目标不是同项目工作会话');
          const received = (await this.deliveries(targetSessionId)).items.find(item => item.handoffId === handoffId && item.sourceSessionId === sessionId && item.targetSessionId === targetSessionId);
          const snapshot = received?.snapshot.find(item => item.candidateId === candidateId && item.revision === contentHash);
          if (!snapshot) throw new ApiError(409,'delivery_missing','工作会话没有收到此候选版本的交付快照');
          return {delivery:{source:binding,target,handoffId,candidateId,contentHash},snapshot,sourceHost:await this.sessionHost(binding),workHost:await this.sessionHost(target)};
        };
        if (action === 'candidate-delivery-preview') return previewProjectDelivery(await resolve());
        if (value.authorize !== true || typeof value.commandId !== 'string' || !validId(value.commandId) || typeof value.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.planHash))
          throw new ApiError(400,'delivery_authorization','安装交付版本需要明确授权、已审阅计划摘要和命令编号');
        const settings = await this.settings();
        const secrets = [settings.apiKey ?? '', ...Object.values((await new ProviderProfiles(this.paths.home).credentials()).entries)];
        return applyProjectDelivery(join(this.paths.root,'candidate-deliveries'),{sourceSessionId:sessionId!,targetSessionId,handoffId,candidateId,contentHash,planHash:value.planHash,commandId:value.commandId},resolve,secrets);
      }
      if (action === 'candidate-validation-cancel') {
        if (binding?.target.kind !== 'extension' || typeof value.taskId !== 'string') throw new ApiError(400, 'validation_input', '取消需要扩展会话及验证编号');
        return this.validationTasks.cancel(value.taskId, sessionId!);
      }
      if (action === 'candidate-core-cancel') {
        if (binding?.target.kind !== 'core' || typeof value.commandId !== 'string') throw new ApiError(400, 'core_operation_input', '核心取消需要会话及任务编号');
        return this.coreOperations.cancel(value.commandId, sessionId!);
      }
      const host = binding ? await this.sessionHost(binding) : this.customization;
      if (value.action === 'theme-verify') {
        const active = (await host.themes.describe()).active;
        if (!active || active.resourceId !== value.resourceId || active.revision !== value.contentHash || active.id !== value.id) throw new ApiError(409,'theme_conflict','主题版本已变化');
        const resource = host.active?.resources.find(r => r.id === active.resourceId);
        if (!resource) throw new ApiError(409,'theme_conflict','主题尚未加载');
        const evidence = await host.lifecycle.evidence();
        const identity = await (await import('../customization/sdk.js')).hostIdentity();
        if (!evidence.some(e => e.resourceId === resource.id && e.revision === resource.hash && e.stage === 'host' && e.host === identity.build && e.contributionId === active.id && e.check === 'theme-stylesheet-mounted' && e.environment?.node === process.version && e.environment.platform === process.platform && e.environment.arch === process.arch)) await host.lifecycle.record(resource,'host',{status:'observed',check:'theme-stylesheet-mounted',contributionId:active.id});
        return {status:'observed',check:'theme-stylesheet-mounted',hostIntegration:'observed'};
      }
      if (value.action === 'theme-select') return host.themes.select(value.scope as 'user'|'project', value.selection as any, Number(value.revision));
      if (value.action === 'user-writes' && typeof value.enabled === 'boolean' && typeof value.revision === 'number') { await host.catalog.allowUserWrites(value.enabled,value.revision); return { status: 'saved' }; }
      if (['candidate-core-plan', 'candidate-core-build', 'candidate-core-validate'].includes(action)) {
        if (binding?.target.kind !== 'core' || !binding.target.coreCandidate) throw new ApiError(403, 'mode_permission', '需要绑定的核心创造目标');
        const { CoreCandidates } = await import('../core/candidates.js'), { CoreBuilds } = await import('../core/builds.js');
        const candidates = new CoreCandidates(this.workspace, this.paths.home), builds = new CoreBuilds(candidates), candidateId = binding.target.coreCandidate.id;
        if (action === 'candidate-core-plan') return builds.plan(candidateId);
        if (value.authorize !== true || typeof value.commandId !== 'string' || !validId(value.commandId)) throw new ApiError(400, 'core_operation_authorization', '核心执行需要明确授权和命令编号');
        const input = { commandId: value.commandId, sessionId: sessionId!, candidateId, target: binding.target.root, hostBuild: binding.target.host!.build };
        if (action === 'candidate-core-build') {
          if (typeof value.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputHash)) throw new ApiError(400, 'core_build_input', '缺少已审阅的构建计划摘要');
          const request = { ...input, kind: 'build' as const, inputHash: value.inputHash };
          return this.coreOperations.start(request, async signal => {
            this.check(); await checkSessionTarget(binding, this.paths.home); signal.throwIfAborted();
            const result = await builds.build({ candidateId, commandId: request.commandId, inputHash: request.inputHash, authorize: true }, { signal });
            return { status: result.status, resultId: result.buildId, error: result.error };
          }, async () => {
            if ((await builds.plan(candidateId)).inputHash !== request.inputHash) throw new ApiError(409, 'core_build_changed', '构建输入已变化，请重新审阅计划');
            this.check();
          });
        }
        if (typeof value.buildId !== 'string' || !validId(value.buildId) || typeof value.artifactRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.artifactRevision)) throw new ApiError(400, 'core_validation_input', '缺少构建编号或产物摘要');
        const records = await builds.records();
        if (!records.some(event => event.candidateId === candidateId && event.type === 'core.build.finished' && (event.payload as { buildId?: string }).buildId === value.buildId)) throw new ApiError(403, 'core_build_target', '构建不属于当前候选');
        const request = { ...input, kind: 'validation' as const, buildId: value.buildId, artifactRevision: value.artifactRevision };
        return this.coreOperations.start(request, async signal => {
          this.check(); await checkSessionTarget(binding, this.paths.home); signal.throwIfAborted();
          const { CoreValidations } = await import('../core/validations.js');
          const result = await new CoreValidations(builds).validate({ commandId: request.commandId, buildId: request.buildId, artifactRevision: request.artifactRevision, authorize: true }, { signal });
          return { status: result.status, resultId: result.validationId, error: result.error };
        }, async () => {
          const inspected = await builds.inspect(request.buildId);
          if (!inspected.validForCurrent || inspected.result.artifact?.revision !== request.artifactRevision) throw new ApiError(409, 'core_artifact_changed', inspected.invalidReason ?? '构建或产物已变化');
          this.check();
        });
      }
      if (action === 'candidate-execution-start') {
        if (binding?.target.kind !== 'extension' || typeof value.id !== 'string' || typeof value.commandId !== 'string' || !validId(value.commandId) || typeof value.contentHash !== 'string' || !['simulation', 'preview'].includes(String(value.stage)) || value.authorize !== true)
          throw new ApiError(400, 'validation_input', '可信验证需要扩展会话、候选版本、任务编号及明确授权');
        const stage = value.stage as 'simulation' | 'preview';
        const command = typeof value.command === 'string' ? value.command : '';
        const modelReply = typeof value.modelReply === 'string' ? value.modelReply : undefined;
        const props = (value.props ?? {}) as Json, panelId = typeof value.panelId === 'string' ? value.panelId : undefined;
        if (stage === 'simulation' && (!command.startsWith('/') || command.length > 8000) || (modelReply?.length ?? 0) > 16000 || Buffer.byteLength(JSON.stringify(props)) > 32768) throw new ApiError(400, 'validation_input', '模拟命令或预览输入无效/过长');
        const candidate = await new Candidates(host.catalog.workspace).read(value.id);
        if (candidate.hash !== value.contentHash) throw new ApiError(409, 'candidate_changed', '候选内容已变化，请重新查看');
        const identity = await (await import('../customization/sdk.js')).hostIdentity();
        const input = { id: value.commandId, sessionId: sessionId!, candidateId: value.id, contentHash: candidate.hash, hostBuild: identity.build, target: binding.target.root, stage,
          requestHash: hash(JSON.stringify({ stage, command, modelReply, props, panelId })) };
        return this.validationTasks.startExecution(input, async signal => {
          this.check(); await checkSessionTarget(binding, this.paths.home); signal.throwIfAborted();
          if (stage === 'simulation') {
            const { trialCandidate } = await import('../customization/trial.js');
            const result = await trialCandidate(host.catalog.workspace, this.paths.home, input.candidateId, input.contentHash, command, true, { signal, model: modelReply, validationTaskId: input.id, sessionId, assertTarget: () => checkSessionTarget(binding, this.paths.home) });
            return { trialSession: result.session, text: result.text?.slice(0, 8000) };
          }
          const result = await host.panels.previewCandidate(input.candidateId, input.contentHash, panelId, props, true, signal, { validationTaskId: input.id, sessionId, assertTarget: () => checkSessionTarget(binding, this.paths.home) });
          if (this.candidateFrames.size >= 256) { const oldest = this.candidateFrames.entries().next().value; if (oldest) { oldest[1].host.panels.unmount(oldest[1].frame.instanceId,oldest[1].sessionId); this.candidateFrames.delete(oldest[0]); } }
          this.candidateFrames.set(input.id, { host, frame: result.frame, sessionId:sessionId! });
          return { instanceId: result.frame.instanceId };
        }, () => { const saved = this.candidateFrames.get(input.id); if (saved) saved.host.panels.unmount(saved.frame.instanceId,saved.sessionId); this.candidateFrames.delete(input.id); });
      }
      if (action === 'candidate-validation-start') {
        if (binding?.target.kind !== 'extension' || typeof value.id !== 'string' || typeof value.commandId !== 'string' || typeof value.contentHash !== 'string') throw new ApiError(400, 'validation_input', '静态校验需要扩展目标及固定候选版本');
        const resource = await new Candidates(host.catalog.workspace).read(value.id);
        if (resource.hash !== value.contentHash) throw new ApiError(409, 'candidate_changed', '候选内容已变化，请重新查看后发起验证');
        const identity = await (await import('../customization/sdk.js')).hostIdentity();
        return this.validationTasks.start({ id: value.commandId, sessionId: sessionId!, candidateId: value.id, contentHash: resource.hash, hostBuild: identity.build, target: binding.target.root, stage: 'static' }, resource,
          report => host.lifecycle.record(resource, 'static', { passed: report.passed, diagnostics: report.diagnostics, sessionId, runId: value.commandId as string }));
      }
      if (value.action === 'candidate-panel-preview') return host.panels.previewCandidate(String(value.id),String(value.contentHash),typeof value.panelId === 'string'?value.panelId:undefined,(value.props ?? {}) as Json,value.authorize===true,undefined,{sessionId});
      if (value.action === 'panel-mount') return host.panels.mount(String(value.resourceId), String(value.panelId), String(value.revision), (value.props ?? {}) as Json, typeof value.workflowId === 'string' ? value.workflowId : undefined, value.preview === true, typeof value.theme === 'string' ? value.theme : undefined, typeof value.sessionId === 'string' ? value.sessionId : undefined, binding?.mode ?? 'work');
      if (value.action === 'panel-action') {
        if(['draft.set','command.run','session.navigate','view.open','state.read','state.subscribe'].includes(String(value.method))) {
          const data=(value.value??{}) as Record<string,unknown>;
          const bound=await host.panels.uiAction(String(value.instanceId),Number(value.sequence),String(value.method),data as Json,sessionId);
          const entry=await this.entry(bound.sessionId);
          if(value.method==='command.run') {
            if(typeof data.command!=='string'||data.command.length>8000||typeof data.commandId!=='string'||!validId(data.commandId))throw new ApiError(400,'panel_command','命令参数无效');
            const name=/^\/([a-z][a-z0-9_:-]*)(?:\s|$)/.exec(data.command)?.[1];
            if(!name||!host.commands().commands.some(c=>c.name===`/${name}`))throw new ApiError(400,'panel_command','只能调用已注册命令');
            await host.panels.recordUiAction(String(value.instanceId),'command.run','intent',data);
            try {
              const receipt=await this.submitInner(bound.sessionId,{version:1,commandId:data.commandId,prompt:data.command});
              await host.panels.recordUiAction(String(value.instanceId),'command.run','completed',receipt);
              return receipt;
            }catch(error){await host.panels.recordUiAction(String(value.instanceId),'command.run','failed',{error:String(error)});throw error;}
          }
          if(value.method==='state.read'||value.method==='state.subscribe')return {sessionId:bound.sessionId,title:this.info(bound.sessionId,entry).title,status:this.info(bound.sessionId,entry).status};
          if(value.method==='draft.set'&&(typeof data.text!=='string'||data.text.length>16000))throw new ApiError(400,'panel_draft','草稿无效');
          if(value.method==='session.navigate') {
            if(data.sessionId!==bound.sessionId)throw new ApiError(403,'panel_scope','无法导航到未绑定会话');
          }
          if(value.method==='view.open'&&!host.panels.catalog().some(p=>p.resourceId===bound.resourceId&&p.id===data.viewId&&p.slot==='page'))throw new ApiError(403,'panel_view','视图不可用');
          return {uiAction:value.method,value:data,sessionId:bound.sessionId,resourceId:bound.resourceId};
        }
        try {return await host.panels.action(String(value.instanceId), Number(value.sequence), String(value.method), (value.value ?? null) as Json,sessionId);}
        catch(error) {
          if(/Workflow (revision conflict|answer identity conflict|interaction is not waiting)/.test(String(error))) throw new ApiError(409,'panel_conflict','工作流回答冲突，请刷新权威状态');
          if(/Panel (authorization revoked|revision no longer active|instance expired|action not authorized)/.test(String(error))) throw new ApiError(403,'panel_permission','面板授权、版本或交互已失效');
          throw error;
        }
      }
      if (value.action === 'panel-unmount') {
        const result=host.panels.unmount(String(value.instanceId),sessionId);
        for (const [key, saved] of this.candidateFrames) if (saved.host === host && saved.frame.instanceId === value.instanceId) this.candidateFrames.delete(key);
        return result;
      }
      if (value.action === 'reload') return host.requestReload();
      if (typeof value.action === 'string' && value.action.startsWith('workflow-')) {
        const flows = host.workflows, workflowId = String(value.id ?? '');
        if (value.action === 'workflow-recover') return flows.recoverWorkflow(workflowId);
        if (value.action === 'workflow-inspect') return flows.inspect(workflowId);
        if (value.action === 'workflow-evidence') return flows.evidence(workflowId, Number(value.offset ?? 0));
        if (value.action === 'workflow-artifact') return flows.artifact(workflowId, String(value.hash ?? ''));
        if (value.action === 'workflow-cancel') return flows.cancel(workflowId, Number(value.revision));
        if (value.action !== 'workflow-start' && (await flows.inspect(workflowId)).mode !== (binding?.mode ?? "work"))
          return this.managementBlocked(action, sessionId, binding, "工作流模式与当前会话不一致，不能跨模式继续执行");
        if (this.runs.size || this.titles.size || this.workflowTask) throw new ApiError(409, 'busy', '请等待当前任务完成或取消');
        flows.configure({ ...this.options.runtime, ...await this.settings(), mode: binding?.mode ?? 'work', apiKey: (await this.settings()).apiKey ?? '' });
        const start = (workflowId: string, revision: number) => {
          const task = { id: workflowId, host, done: Promise.resolve() as Promise<unknown>, error: undefined as string | undefined };
          this.workflowTask = task;
          task.done = flows.advance(workflowId, { expectedRevision: revision }).catch(error => { task.error = String(error); }).finally(() => { if (this.workflowTask === task) this.workflowTask = undefined; });
          return { id: workflowId, status: 'running' };
        };
        if (value.action === 'workflow-start') {
          const activation = await host.acquire();
          let created;
          try {
            if (value.definitionRevision !== undefined && !activation.extensions.some(extension => extension.resource.id === value.resourceId && extension.resource.hash === value.definitionRevision && extension.workflows.some(flow => flow.id === value.definitionId))) throw new ApiError(409, 'workflow_definition_conflict', '工作流定义已变化，请重新审阅');
            created = await flows.create(String(value.resourceId), String(value.definitionId), (value.input ?? {}) as Json, activation, String(value.commandId)); }
          catch (error) { if (error instanceof ApiError && error.code === "mode_permission") return this.managementBlocked(action, sessionId, binding, "工作流不适用于当前会话模式"); throw error; }
          finally { await host.release(); }
          return ['queued', 'ready'].includes(created.status) ? start(created.id, created.revision) : created;
        }
        if (value.action === 'workflow-resume') return start(workflowId, Number(value.revision));
        if (value.action === 'workflow-answer') {
          const ready = await flows.answer(workflowId, String(value.waitId), String(value.commandId), value.answer as Json, Number(value.revision));
          return value.resume === true && ready.status === 'ready' ? start(workflowId, ready.revision) : ready;
        }
        if (value.action === 'workflow-resolve') return flows.resolveUnknown(workflowId, Number(value.revision), value.choice as Parameters<typeof flows.resolveUnknown>[2]);
        if (value.action === 'workflow-migrate') {
          const activation = await host.acquire();
          try { return await flows.migrate(workflowId, Number(value.revision), value.target as Parameters<typeof flows.migrate>[2], activation); }
          finally { await host.release(); }
        }
        throw new ApiError(400, 'workflow', '工作流操作无效');
      }
      if (value.action === 'history-branch' && typeof value.sessionId === 'string') {
        if (this.runs.size || this.titles.size) throw new ApiError(409, 'busy', '请等待任务完成后创建历史分支');
        if (value.commandId !== undefined && (typeof value.commandId !== 'string' || !validId(value.commandId))) throw new ApiError(400, 'branch_command', '历史分支命令编号无效');
        if (!binding) throw new ApiError(422, 'session_identity', '历史分支需要原会话身份');
        const source = await this.entry(value.sessionId), branchId = typeof value.commandId === 'string' ? value.commandId : id();
        if ((await this.creationEvents()).some(event => event.type === 'session.deleted' && (event.payload as { sessionId?: string }).sessionId === branchId)) throw new ApiError(410, 'session_deleted', '该分支命令对应的会话已删除，不能重建');
        await branchHistory(source.directory, join(this.root, branchId), binding.target.root, value.omitReasoning === true, branchId, { home: this.paths.home, commandId: typeof value.commandId === 'string' ? value.commandId : undefined });
        return { sessionId: branchId, mode: binding.mode };
      }
      if (typeof value.action === 'string' && value.action.startsWith('provider-')) {
        const profiles = new ProviderProfiles(this.paths.home);
        if (value.action === 'provider-save' && typeof value.revision === 'number') return profiles.save(value.profile as ProviderProfile, value.revision);
        if (value.action === 'provider-select' && typeof value.revision === 'number' && PROVIDER_PURPOSES.includes(value.purpose as ProviderPurpose)) return profiles.select(value.purpose as ProviderPurpose, typeof value.id === 'string' ? value.id : undefined, value.revision);
        if (value.action === 'provider-credential' && typeof value.ref === 'string' && (typeof value.secret === 'string' || value.secret === null)) { await profiles.saveCredential(value.ref, value.secret); return { status: 'saved' }; }
        if (value.action === 'provider-migrate' && typeof value.revision === 'number') return profiles.migrateLegacy(value.revision);
        throw new ApiError(400, 'provider', 'Provider 操作无效');
      }
      if (['mcp-authorize', 'mcp-disconnect'].includes(String(value.action))) {
        const resource = (await host.catalog.discover()).find(r => r.kind === 'mcp' && r.id === value.id);
        if (!resource) throw new ApiError(400, 'mcp', 'MCP 连接不存在');
        if (value.contentHash !== undefined && value.contentHash !== resource.hash) throw new ApiError(409, 'resource_conflict', 'MCP 连接配置已变化，请重新审阅');
        if (value.action === 'mcp-authorize') return host.oauth.begin(resource);
        await host.oauth.disconnect(resource);
        return { status: 'disconnected' };
      }
      if (typeof value.action === 'string' && ['package-collect', 'package-list', 'package-inspect', 'package-rollback-inspect', 'package-activate', 'package-rollback', 'package-export', 'package-uninstall'].includes(value.action)) return packageAction(host, { ...value, action: value.action.slice(8) }, { user: true });
      if (value.action === 'candidate-export') return new Candidates(host.catalog.workspace).export(String(value.id),String(value.contentHash),String(value.output));
      if (value.action === 'candidate-inspect' && typeof value.id === 'string') {const store=new Candidates(host.catalog.workspace),preview=await store.preview(value.id);await host.lifecycle.record(await store.read(value.id),'static',{passed:preview.report.passed,diagnostics:preview.report.diagnostics});return preview;}
      if (value.action === 'candidate-activate' && typeof value.id === 'string' && typeof value.contentHash === 'string') return host.requestCandidate(value.id, value.contentHash, value.authorize === true, typeof value.revision === "number" ? value.revision : undefined, typeof value.activeRevision === "number" ? value.activeRevision : undefined);
      if (value.action === 'candidate-rollback' && typeof value.name === 'string') return host.requestRollback(value.name, value.authorize === true, typeof value.contentHash === "string" ? value.contentHash : undefined, typeof value.activeRevision === "number" ? value.activeRevision : undefined, typeof value.revision === "number" ? value.revision : undefined);
      if (value.action === 'validate') {
        const r = (await host.catalog.discover()).find(r => r.id === value.id);
        if (!r || r.kind !== 'extension') throw new ApiError(400, 'resource', '扩展不存在');
        const errors = await validateExtension(r), report = checkTypes(r);
        await host.lifecycle.record(r,'static',{passed:report.passed && !errors.length,diagnostics:report.diagnostics});
        return { errors, report };
      }
      if (value.action === 'authorize-version') {
        const resource = (await host.catalog.discover()).find(r => r.id === value.id);
        if (!resource || resource.hash !== value.contentHash) throw new ApiError(409,'resource_conflict','资源已变化，请重新确认权限');
        await host.catalog.decide(resource.id,true,true,Number(value.revision),undefined,String(value.contentHash));
        return host.requestReload(resource);
      }
      if (value.action === 'set' && typeof value.id === 'string' && typeof value.enabled === 'boolean' && typeof value.trusted === 'boolean' && typeof value.revision === 'number') {
        await host.catalog.decide(value.id, value.enabled, value.trusted, value.revision);
        return host.requestReload();
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
    this.coreOperations.abortAll(new Error("服务正在停止"));
    this.validationTasks.abortAll(new Error("服务正在停止"));
    for (const task of this.handoffPreparations.values()) task.abort.abort(new Error("服务正在停止"));
    for (const task of [...this.runs.values(), ...this.titles.values()]) task.abort.abort(new Error("服务正在停止"));
    // Finish admitted metadata operations before closing their journals and hosts.
    await this.gate;
    for (const task of [...this.handoffPreparations.values(), ...this.runs.values(), ...this.titles.values()]) task.abort.abort(new Error("服务正在停止"));
    await Promise.allSettled([...this.handoffPreparations.values()].map(task => task.done));
    await Promise.allSettled([...this.runs.values(), ...this.titles.values()].map(task => task.done));
    const workflowTask = this.workflowTask;
    if (workflowTask) { await workflowTask.host.workflows.cancel(workflowTask.id, 0); await workflowTask.done; }
    await this.coreOperations.close();
    await this.validationTasks.close();
    this.candidateFrames.clear();
    await this.customization.close();
    for (const host of this.createHosts.values()) await host.close();
    await this.release();
  }
}
