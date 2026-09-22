import { mkdir, readdir, readFile, writeFile, rename, rm, chmod, realpath } from "node:fs/promises";
import { join, dirname } from "node:path";
import { Value } from "typebox/value";
import { Journal, readSession, readArtifact, artifactRefs, hash, id, type JournalEvent, type Artifact } from "../journal.js";
import { CoreTools } from "../tools.js";
import type { ProviderOptions } from "../provider.js";
import type { CustomizationHost, Activation } from "./host.js";
import { CustomRun, validateContribution } from "./run.js";
import { Packages, type PackageCandidate } from "./packages.js";
import { WorkspaceState } from "./workspace-state.js";
import { safePath, exists, LIMITS, type Resource } from "./resources.js";
import { contentHash } from "./validation.js";
import type { WorkflowDescriptor, RegisteredWorkflow } from "./workflow-contract.js";
import type { StepOutcome, WorkflowContext } from "./contracts.js";
import type { ProcessContext } from "./process.js";
import type { Json, Contribution } from "./types.js";

interface DefinitionSnapshot { definition: WorkflowDescriptor; resources: Resource[]; package?: PackageCandidate }
export interface WorkflowState {
  id: string; resourceId: string; definitionId: string; definitionRevision: string; schemaVersion: number;
  status: "queued" | "ready" | "running" | "unknown" | "waiting" | "completed" | "cancelled";
  revision: number; step: string; input: Json; attemptId?: string; output?: Json;
  wait?: { id: string; form: Contribution }; snapshot: Artifact; steps: number;
  error?: string;
}
const validId = (value: string) => /^[a-f0-9-]{36}$/.test(value);
export class Workflows {
  private active?: { id: string; abort: AbortController; done: Promise<void>; finish: () => void };
  private queue: Array<{ id: string; settings: ProviderOptions }> = [];
  private draining = false;
  private closing = false;
  constructor(readonly host: CustomizationHost, public settings: ProviderOptions, private fault?: (stage: string) => void | Promise<void>) {}
  get busy() { return !!this.active; }
  configure(options: ProviderOptions) { if (this.busy) throw new Error("Cannot replace active workflow options"); this.settings = { ...options }; }
  private async root() { const root = await safePath(this.host.catalog.workspace, ".nekomimi/workflows"); await mkdir(root, { recursive: true }); return root; }
  private async path(workflowId: string) { if (!validId(workflowId)) throw new Error("Invalid workflow ID"); return safePath(await this.root(), workflowId); }
  private async outcome(directory: string, artifact: Artifact): Promise<StepOutcome> { return JSON.parse((await readArtifact(directory, artifact)).toString()); }
  private async state(directory: string, events: JournalEvent[]): Promise<WorkflowState> {
    const created = events.find(e => e.type === "workflow.created"); if (!created) throw new Error("Workflow creation record missing");
    const p = created.payload as any;
    const state: WorkflowState = { id: p.id, resourceId: p.resourceId, definitionId: p.definitionId, definitionRevision: p.definitionRevision, schemaVersion: p.schemaVersion, status: "queued", revision: 0, step: p.entry, input: p.input, snapshot: p.snapshot, steps: 0 };
    for (const event of events) {
      const value = event.payload as any; state.revision = event.seq;
      if (event.type === "workflow.step.started") { state.error = undefined; state.status = "unknown"; state.attemptId = event.attemptId; state.step = value.step; state.input = value.input; state.steps++; }
      if (["workflow.blocked", "workflow.step.unknown"].includes(event.type)) state.error = value.error;
      if (["workflow.step.completed", "workflow.unknown.resolved"].includes(event.type)) {
        const outcome = await this.outcome(directory, value.outcome);
        state.wait = undefined;
        if (outcome.kind === "complete") { state.status = "completed"; state.output = outcome.output; }
        else { state.step = outcome.step; state.input = outcome.input; state.status = outcome.kind === "wait" ? "waiting" : "ready"; if (outcome.kind === "wait") state.wait = { id: value.waitId, form: outcome.form }; }
      }
      if (event.type === "workflow.retry.authorized") { state.status = "ready"; state.wait = undefined; }
      if (event.type === "workflow.answered") { state.status = "ready"; state.input = { input: state.input, answer: value.answer }; state.wait = undefined; }
      if (event.type === "workflow.cancelled") { state.status = "cancelled"; state.wait = undefined; }
      if (event.type === "workflow.migrated") { state.snapshot = value.snapshot; state.resourceId = value.resourceId; state.definitionId = value.definitionId; state.definitionRevision = value.definitionRevision; state.schemaVersion = value.schemaVersion; state.step = value.step; state.input = value.input; state.status = "ready"; state.wait = undefined; }
    }
    return state;
  }
  async inspect(workflowId: string) { const path = await this.path(workflowId), state = await this.state(path, (await readSession(path)).events); if (this.active?.id === workflowId && state.status === "unknown") state.status = "running"; return state; }
  async list() {
    const names = (await readdir(await this.root())).filter(validId);
    if (names.length > 4096) throw new Error("Workflow history directory limit");
    const result: WorkflowState[] = [];
    for (const name of names) result.push(await this.inspect(name));
    return result;
  }
  private async pin(workflow: RegisteredWorkflow, activation: Activation, workflowId: string): Promise<DefinitionSnapshot> {
    const { resource } = workflow;
    const definition: WorkflowDescriptor = { id: workflow.id, schemaVersion: workflow.schemaVersion, inputSchema: workflow.inputSchema, entry: workflow.entry, steps: workflow.steps, ...(workflow.triggers ? { triggers: workflow.triggers } : {}) };
    if (resource.packageId) {
      const store = new Packages(this.host.catalog.workspace, this.host.catalog.home), pkg = (await store.list()).find(p => p.packageId === resource.packageId && p.revision === resource.packageRevision);
      if (!pkg) throw new Error("Workflow package lock unavailable");
      await store.retain(pkg, workflowId);
      return { definition, resources: await store.resources(pkg), package: pkg };
    }
    const files = resource.files!; if (!files || Object.keys(files).length > 256 || Buffer.byteLength(JSON.stringify(files)) > LIMITS.package) throw new Error("Workflow definition snapshot limit");
    const root = await safePath(this.host.catalog.workspace, `.nekomimi/workflow-content/${contentHash(files)}`);
    if (!(await exists(root))) {
      const staging = root + "." + id(); await mkdir(staging, { recursive: true });
      try { for (const [name, text] of Object.entries(files)) { const path = await safePath(staging, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text, { mode: 0o444 }); }
        await rename(staging, root);
      } finally { await rm(staging, { recursive: true, force: true }); }
    }
    return { definition, resources: [{ ...resource, root, path: join(root, resource.manifest!.entry), status: "enabled" }] };
  }
  private async snapshot(directory: string, ref: Artifact): Promise<DefinitionSnapshot> {
    const snapshot = JSON.parse((await readArtifact(directory, ref)).toString()) as DefinitionSnapshot;
    if (snapshot.package) snapshot.resources = await new Packages(this.host.catalog.workspace, this.host.catalog.home).resources(snapshot.package);
    else for (const resource of snapshot.resources) {
      const actual: Record<string, string> = {};
      for (const name of Object.keys(resource.files ?? {})) actual[name] = await readFile(await safePath(resource.root, name), "utf8");
      if (contentHash(actual) !== contentHash(resource.files ?? {})) throw new Error("Pinned workflow definition integrity mismatch");
    }
    return snapshot;
  }
  async create(resourceId: string, definitionId: string, input: Json, activation: Activation, workflowId = id(), causes: string[] = []) {
    if (Buffer.byteLength(JSON.stringify(input)) > LIMITS.file) throw new Error("Workflow input limit");
    const directory = await this.path(workflowId);
    if (await exists(directory)) {
      const old = await this.inspect(workflowId);
      const created = (await readSession(directory)).events.find(e => e.type === "workflow.created")!.payload as any;
      if (created.resourceId !== resourceId || created.definitionId !== definitionId || hash(JSON.stringify(created.input)) !== hash(JSON.stringify(input))) throw new Error("Workflow command identity conflict");
      return old;
    }
    const queue = await this.list(); if (queue.length >= 4096 || queue.filter(w => !["completed", "cancelled"].includes(w.status)).length >= 64) throw new Error("Workflow queue limit");
    const workflow = activation.extensions.flatMap(e => e.workflows).find(w => w.resource.id === resourceId && w.id === definitionId);
    if (!workflow || !Value.Check(workflow.inputSchema, input)) throw new Error("Unknown workflow or invalid input schema");
    return this.materialize(workflowId, resourceId, input, causes, await this.pin(workflow, activation, workflowId));
  }
  private async materialize(workflowId: string, resourceId: string, input: Json, causes: string[], snapshot: DefinitionSnapshot) {
    const directory = await this.path(workflowId), workflow = snapshot.definition;
    const resource = snapshot.resources.find(r => r.id === resourceId);
    if (!resource) throw new Error("Workflow snapshot identity missing");
    if (await exists(directory)) {
      const created = (await readSession(directory)).events.find(e => e.type === "workflow.created")?.payload as any;
      if (!created || created.resourceId !== resourceId || created.definitionId !== workflow.id || created.definitionRevision !== resource.hash || hash(JSON.stringify(created.input)) !== hash(JSON.stringify(input))) throw new Error("Workflow outbox identity conflict");
      return this.inspect(workflowId);
    }
    const queue = await this.list();
    if (queue.length >= 4096 || queue.filter(w => !["completed", "cancelled"].includes(w.status)).length >= 64) throw new Error("Workflow queue limit");
    const definitionId = workflow.id, staging = directory + ".pending-" + id();
    const journal = await Journal.open(staging, { secrets: [this.settings.apiKey] });
    try {
      await journal.append("workflow.created", { version: 1, id: workflowId, resourceId, definitionId, definitionRevision: resource.hash, schemaVersion: workflow.schemaVersion, entry: workflow.entry, input, causes: [...causes, `${resourceId}:${definitionId}`], snapshot: await journal.artifact(JSON.stringify(snapshot)) }, { workflowId, resourceId, definitionRevision: resource.hash });
      await journal.close(); await rename(staging, directory);
      return this.inspect(workflowId);
    } catch (error) { await journal.close().catch(() => {}); await rm(staging, { recursive: true, force: true }); throw error; }
  }
  private validateOutcome(outcome: StepOutcome, definition: WorkflowDescriptor, step: string) {
    if (!outcome || !["next", "wait", "complete"].includes(outcome.kind) || Buffer.byteLength(JSON.stringify(outcome)) > LIMITS.file) throw new Error("Invalid workflow outcome");
    if (outcome.kind !== "complete" && (!Object.hasOwn(definition.steps, outcome.step) || !definition.steps[step]?.transitions.includes(outcome.step))) throw new Error("Undeclared workflow transition");
    if (outcome.kind === "wait") { validateContribution(outcome.form); if (outcome.form.kind !== "form") throw new Error("Workflow wait requires a durable form"); }
  }
  async advance(workflowId: string, options: { activation?: Activation; signal?: AbortSignal; maxSteps?: number; expectedRevision?: number } = {}) {
    if (this.active) throw new Error("Workflow execution already active");
    const directory = await this.path(workflowId), abort = new AbortController();
    if (this.active) throw new Error("Workflow execution already active");
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    this.active = { id: workflowId, abort, done, finish };
    let acquired = false; let journal: Journal | undefined;
    try {
      journal = await Journal.open(directory, { secrets: [this.settings.apiKey] });
      const writer = journal;
      let state = await this.state(directory, journal.events);
      if (options.expectedRevision !== undefined && state.revision !== options.expectedRevision) throw new Error("Workflow revision conflict");
      if (!["queued", "ready"].includes(state.status)) throw new Error(`Workflow ${state.status}; explicit answer or unknown resolution required`);
      await this.recover(journal);
      const snapshot = await this.snapshot(directory, state.snapshot);
      const activation = options.activation ?? await this.host.acquirePinned(snapshot.resources); acquired = !options.activation;
      const ext = activation.extensions.find(e => e.resource.id === state.resourceId && e.resource.hash === state.definitionRevision);
      const workflow = ext?.workflows.find(w => w.id === state.definitionId);
      if (!ext || !workflow) throw new Error("Pinned workflow registration missing");
      const signal = AbortSignal.any([abort.signal, journal.failure.signal, ...(options.signal ? [options.signal] : [])]);
      const workspaceState = new WorkspaceState(this.host.catalog.workspace); await workspaceState.recover(journal);
      for (let count = 0; count < (options.maxSteps ?? 64) && ["queued", "ready"].includes(state.status); count++) {
        signal.throwIfAborted(); if (state.steps >= 128) throw new Error("Workflow step/causal budget exceeded");
        const attemptId = id(), runId = id(), stepId = state.step;
        const links = { workflowId, resourceId: state.resourceId, definitionRevision: state.definitionRevision, stepId, attemptId, runId };
        const custom = new CustomRun(this.host, activation, journal, runId, signal, this.settings, undefined, false, {}, links);
        const core = await CoreTools.create(this.host.catalog.workspace, journal, links, { search: { apiKey: this.settings.apiKey, fetch: this.settings.fetch, settings: this.settings.search } });
        await custom.initialize(core.definitions());
        const base = custom.context(ext), context: ProcessContext & WorkflowContext = { ...base, workflowId, stepId, attemptId, workspaceState: { get: (key, version) => workspaceState.get(state.resourceId, key, version), set: (key, schemaVersion, expectedRevision, value) => workspaceState.set(writer, { resourceId: state.resourceId, key, schemaVersion, expectedRevision, value }) }, ui: async value => { if (value.kind === "form") throw new Error("Return a wait outcome for persistent workflow interaction"); return base.ui(value); }, followUp: () => { throw new Error("Use explicit workflow transitions instead of ephemeral follow-up"); }, recordRpc: async (type, payload, rpcLinks) => { await writer.append(type, payload, { ...rpcLinks, ...links }); } };
        await journal.append("workflow.step.started", { step: stepId, input: state.input }, links);
        try {
          await this.fault?.("intent-written");
          const outcome = await workflow.execute(stepId, state.input, context);
          await this.fault?.("effect-completed"); signal.throwIfAborted(); this.validateOutcome(outcome, snapshot.definition, stepId);
          await journal.append("workflow.step.completed", { outcome: await journal.artifact(JSON.stringify(outcome)), ...(outcome.kind === "wait" ? { waitId: id() } : {}) }, links);
        } catch (error) {
          journal.check();
          await journal.append(abort.signal.aborted ? "workflow.cancelled" : "workflow.step.unknown", { error: journal.clean(String(error)), unknown: true }, links);
          return this.state(directory, journal.events);
        }
        await this.fault?.("completion-written");
        state = await this.state(directory, journal.events);
      }
      if (state.status === "completed") await this.observe(journal, activation, "run-completed", state.definitionId, this.settings);
      return state;
    } catch (error) {
      if (journal) { journal.check(); await journal.append("workflow.blocked", { error: journal.clean(String(error)) }, { workflowId }); }
      throw error;
    } finally {
      try { await journal?.close(); } finally { try { if (acquired) await this.host.release(); } finally { this.active = undefined; finish(); } }
      if (!this.host.busy) await this.drain();
    }
  }
  private async edit(workflowId: string, expectedRevision: number, fn: (journal: Journal, state: WorkflowState) => Promise<void>) {
    const directory = await this.path(workflowId), journal = await Journal.open(directory);
    try { const state = await this.state(directory, journal.events); if (state.revision !== expectedRevision) throw new Error("Workflow revision conflict"); await fn(journal, state); return this.state(directory, journal.events); }
    finally { await journal.close(); }
  }
  async answer(workflowId: string, waitId: string, commandId: string, answer: Json, expectedRevision: number) {
    const directory = await this.path(workflowId), previous = (await readSession(directory)).events.find(e => e.type === "workflow.answered" && (e.payload as any).commandId === commandId);
    if (previous) { const p = previous.payload as any; if (p.waitId !== waitId || p.payloadHash !== hash(JSON.stringify(answer))) throw new Error("Workflow answer identity conflict"); return this.inspect(workflowId); }
    if (!validId(commandId)) throw new Error("Invalid workflow answer command ID");
    return this.edit(workflowId, expectedRevision, async (journal, state) => {
      if (state.status !== "waiting" || state.wait?.id !== waitId || !answer || typeof answer !== "object" || Array.isArray(answer)) throw new Error("Workflow interaction is not waiting or answer invalid");
      const fields = state.wait.form.fields!;
      if (Object.keys(answer).some(key => !fields.some(f => f.name === key)) || fields.some(f => (answer[f.name] !== undefined && typeof answer[f.name] !== "string") || (f.required && !answer[f.name]) || (f.options && answer[f.name] && !f.options.includes(String(answer[f.name]))))) throw new Error("Invalid workflow form answer");
      await journal.append("workflow.answered", { waitId, commandId, answer, payloadHash: hash(JSON.stringify(answer)) }, { workflowId });
    });
  }
  async resolveUnknown(workflowId: string, expectedRevision: number, choice: { retry: true; note: string } | { outcome: StepOutcome; note: string }) {
    return this.edit(workflowId, expectedRevision, async (journal, state) => {
      if (state.status !== "unknown" || !choice.note?.trim()) throw new Error("Unknown workflow and an explicit reconciliation note required");
      if ("retry" in choice) await journal.append("workflow.retry.authorized", { previousAttemptId: state.attemptId, note: choice.note }, { workflowId });
      else { const snapshot = await this.snapshot(journal.directory, state.snapshot); this.validateOutcome(choice.outcome, snapshot.definition, state.step); await journal.append("workflow.unknown.resolved", { previousAttemptId: state.attemptId, note: choice.note, outcome: await journal.artifact(JSON.stringify(choice.outcome)), ...(choice.outcome.kind === "wait" ? { waitId: id() } : {}) }, { workflowId }); }
    });
  }
  async cancel(workflowId: string, expectedRevision: number) {
    if (this.active?.id === workflowId) { this.active.abort.abort(new Error("Workflow cancelled by user")); return { id: workflowId, status: "cancelling" }; }
    return this.edit(workflowId, expectedRevision, async (journal, state) => { if (["completed", "cancelled"].includes(state.status)) return; await journal.append("workflow.cancelled", { unknown: state.status === "unknown" }, { workflowId }); });
  }
  async migrate(workflowId: string, expectedRevision: number, target: { resourceId: string; definitionId: string; fromSchemaVersion: number; step: string; input: Json; note: string }, activation: Activation) {
    return this.edit(workflowId, expectedRevision, async (journal, state) => {
      if (!["queued", "ready", "waiting"].includes(state.status) || state.schemaVersion !== target.fromSchemaVersion || !target.note?.trim()) throw new Error("Workflow migration requires a compatible settled state and explicit note");
      const workflow = activation.extensions.flatMap(e => e.workflows).find(w => w.resource.id === target.resourceId && w.id === target.definitionId);
      if (!workflow || !Object.hasOwn(workflow.steps, target.step) || !Value.Check(workflow.inputSchema, target.input)) throw new Error("Workflow migration target/schema invalid");
      const snapshot = await this.pin(workflow, activation, workflowId);
      await journal.append("workflow.migrated", { previous: await journal.artifact(JSON.stringify(state)), snapshot: await journal.artifact(JSON.stringify(snapshot)), resourceId: target.resourceId, definitionId: target.definitionId, definitionRevision: workflow.resource.hash, schemaVersion: workflow.schemaVersion, step: target.step, input: target.input, note: target.note }, { workflowId });
    });
  }
  async recoverWorkflow(workflowId: string) {
    const journal=await Journal.open(await this.path(workflowId));
    try {await this.recover(journal); return {status:'recovered',execution:'explicit-resume-required'};} finally {await journal.close();}
  }
  async stateGet(resourceId:string,key:string,schemaVersion:number) {return new WorkspaceState(this.host.catalog.workspace).get(resourceId,key,schemaVersion);}
  async stateMigrate(write: Parameters<WorkspaceState['migrate']>[1]) {
    if(this.host.busy || this.busy) throw new Error('Workspace state migration requires an idle runtime');
    if(typeof write.resourceId!=='string'||!write.resourceId||write.resourceId.length>1024) throw new Error('Invalid state resource identity');
    const journal=await Journal.open(await safePath(this.host.catalog.workspace,'.nekomimi/state-management'));
    try {const states=new WorkspaceState(this.host.catalog.workspace);await states.recover(journal);return {revision:await states.migrate(journal,write)};} finally {await journal.close();}
  }
  async evidence(workflowId: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid evidence offset");
    const events = (await readSession(await this.path(workflowId))).events;
    return { events: events.slice(offset, offset + 50).map(e => ({ eventId: e.eventId, seq: e.seq, type: e.type, workflowId: e.workflowId, stepId: e.stepId, attemptId: e.attemptId, resourceId: e.resourceId, artifacts: artifactRefs(e.payload), payloadPreview: JSON.stringify(e.payload).slice(0, 4000) })), next: offset + 50 < events.length ? offset + 50 : undefined };
  }
  async artifact(workflowId: string, digest: string) {
    const directory = await this.path(workflowId), events = (await readSession(directory)).events;
    const ref = events.flatMap(e => artifactRefs(e.payload)).find(a => a.sha256 === digest);
    if (!ref) throw new Error("Workflow artifact is not referenced");
    const bytes = await readArtifact(directory, ref);
    return { artifact: ref, text: bytes.subarray(0, LIMITS.file).toString("utf8"), truncated: bytes.length > LIMITS.file };
  }
  async observe(source: Journal, activation: Activation, kind: "run-completed" | "tool-completed", name: string | undefined, settings: ProviderOptions) {
    if (this.closing) return;
    const event = source.events.findLast(e => kind === "tool-completed" ? e.type === "tool.completed" && (!name || (e.payload as any).name === name) : ["run.finished", "workflow.step.completed"].includes(e.type));
    if (!event) return;
    const causes: string[] = (source.events.find(e => e.type === "workflow.created")?.payload as any)?.causes ?? [];
    for (const workflow of activation.extensions.flatMap(e => e.workflows).filter(w => w.triggers?.some(t => t.kind === kind && (!t.name || t.name === name)))) {
      const target = `${workflow.resource.id}:${workflow.id}`;
      const digest = hash(`${source.sessionId}:${event.eventId}:${target}:${workflow.resource.hash}`), workflowId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
      if (source.events.some(e => e.type === "workflow.trigger.delivered" && (e.payload as any).workflowId === workflowId)) continue;
      if (causes.includes(target) || causes.length >= 8 || this.queue.length >= 64) { await source.append("workflow.trigger.blocked", { target, sourceEventId: event.eventId, reason: "Causal cycle/depth/queue budget" }); continue; }
      const input = { event: { kind, name: name ?? "", sourceSessionId: source.sessionId, sourceEventId: event.eventId }, causes };
      if (!Value.Check(workflow.inputSchema, input)) { await source.append("workflow.trigger.blocked", { target, sourceEventId: event.eventId, reason: "Trigger input schema mismatch" }); continue; }
      if (!this.busy) this.configure(settings);
      const snapshot = await this.pin(workflow, activation, workflowId);
      if (!source.events.some(e => e.type === "workflow.trigger.enqueued" && (e.payload as any).workflowId === workflowId)) await source.append("workflow.trigger.enqueued", { workflowId, input, causes, resourceId: workflow.resource.id, definitionId: workflow.id, definitionRevision: workflow.resource.hash, snapshot: await source.artifact(JSON.stringify(snapshot)) });
      await this.fault?.("trigger-enqueued");
      try {
        await this.create(workflow.resource.id, workflow.id, input, activation, workflowId, causes);
      } catch (error) {
        if (!/queue limit/.test(String(error))) throw error;
        await source.append("workflow.trigger.blocked", { target, sourceEventId: event.eventId, reason: "Persistent workflow queue limit" }); continue;
      }
      await this.fault?.("trigger-created");
      await source.append("workflow.trigger.delivered", { workflowId, sourceEventId: event.eventId });
      await this.fault?.("trigger-delivered");
      if (!this.queue.some(item => item.id === workflowId)) this.queue.push({ id: workflowId, settings: { ...settings } });
    }
  }
  /** Outbox recovery writes only metadata. Recovered work requires explicit resume. */
  async recover(source: Journal) {
    for (const event of source.events.filter(e => e.type === "workflow.trigger.enqueued")) {
      const value = event.payload as any;
      if (source.events.some(e => e.type === "workflow.trigger.delivered" && (e.payload as any).workflowId === value.workflowId)) continue;
      const snapshot = JSON.parse((await readArtifact(source.directory, value.snapshot)).toString()) as DefinitionSnapshot;
      await this.materialize(value.workflowId, value.resourceId, value.input, value.causes, snapshot);
      await source.append("workflow.trigger.delivered", { workflowId: value.workflowId, recovered: true, sourceEventId: event.eventId });
    }
  }
  async drain() {
    if (this.draining || this.busy || this.host.busy || this.closing) return;
    this.draining = true;
    try {
      for (let processed = 0; this.queue.length && processed < 64 && !this.closing; processed++) {
        const entry = this.queue.shift()!; this.configure(entry.settings);
        try { const state = await this.inspect(entry.id); if (state.status === "queued") await this.advance(entry.id); }
        catch { /* The workflow journal retains blocked/unknown evidence; never auto-retry. */ }
      }
    } finally { this.draining = false; }
  }
  async close() { this.closing = true; this.queue = []; const active = this.active; active?.abort.abort(new Error("Workflow host closing")); await active?.done; }
}
