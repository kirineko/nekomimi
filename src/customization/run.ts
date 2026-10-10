import { StateCompatibilityError } from "./state-compatibility.js";
import { McpDiscovery, mcpToolName } from "./mcp-discovery.js";
import { callModelOperation } from "./model-operations.js";
import { hostToolContract, validateHostToolArgs } from "./tool-contracts.js";
import { matchCommands, matchSkills, commandTargets } from "./commands.js";
import { CREATION_TOOLS, modeAllows, modeDenial } from "../shared/mode-policy.js";
import type { SessionMode } from "../shared/protocol.js";
import { Value } from "typebox/value";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ProcessContext } from "./process.js";
import { checkTypes } from "./validation.js";
import { Candidates } from "./candidates.js";
import { sdkCatalog } from "./sdk.js";
import { packageAction } from "./package-management.js";
import { realpath } from "node:fs/promises";
import { Type } from "typebox";
import type { RuntimeTool } from "../tool-contracts.js";
import { basename, dirname, join, resolve, relative, matchesGlob } from "node:path";
import { Journal, hash, id, type JournalEvent } from "../journal.js";
import {
  assemblePrompt,
  promptEscape,
  type Instruction,
  type ToolDefinition,
} from "../context.js";
import type { ProviderOptions } from "../provider.js";
import { createProvider } from "./adapter-provider.js";
import { recordedTool, bindToolPolicy } from "./execution.js";
import {
  deadline,
  validateExtension,
  type Activation,
  type CustomizationHost,
  type LoadedExtension,
} from "./host.js";
import {
  boundedRead,
  exists,
  inside,
  safePath,
  LIMITS,
  type Resource,
} from "./resources.js";
import type {
  ExtensionContext,
  Hook,
  HookEvent,
  Json,
  ToolResult,
  Contribution,
} from "./types.js";
import type { Interactions } from "./interactions.js";
import { sessionBinding, checkSessionTarget } from "../session/identity.js";
import { CONTEXT_POLICY, contextDirectory, shortContextText } from "../context-policy.js";
import type { ContextResource } from "../resource-context.js";
import { ResourceAccess, ResourceScopeError, type ResourceAccessState } from "./resource-access.js";
import type { PreparedRequestContext } from "../context-snapshot.js";
export class CustomRun {
  private readonly callSignals = new AsyncLocalStorage<AbortSignal>();
  get signal() { return this.callSignals.getStore() ?? this.runSignal; }
  readonly instructions: Instruction[] = [];
  readonly followups: string[] = [];
  readonly definitions: ToolDefinition[] = [];
  private rules = new Map<string, string>();
  private changes = 0;
  private operations = 0;
  private fileVersions = new Map<string,string>();
  private mcpContentBytes = 0;
  private mcpDiscovery?: McpDiscovery;
  private executionMode: SessionMode = "work";
  private excludedTools = new Set<string>();
  private access?: ResourceAccess;
  private unavailableResources = new Set<string>();
  private instructionOwners = new Map<string, string>();
  private ruleSources = new Set<string>();
  private toolOwners = new Map<string, string>();
  private contextResources: ContextResource[] = [];
  private catalogRevision = "";
  private directorySource?: string;
  private querySource?: string;
  private contextState = "";
  private capabilityNames: string[] = [];
  effectiveDefinitions() { return this.definitions.filter(definition => !this.unavailableResources.has(this.toolOwners.get(definition.tool.name) ?? "")); }
  private async assertResources(ids: Iterable<string>) { await this.access?.assert(ids); }
  async recordMcpDeclarations(prompt: ReturnType<typeof assemblePrompt>) {
    if(!this.activation.mcp.length)return;
    const declared=prompt.schemas.filter(schema=>schema.name.startsWith('mcp_'));
    const manifest={version:1,activationRevision:this.activation.revision,declared,discoveries:this.mcpDiscovery?.declarations()??[]};
    await this.journal.append('mcp.request.declarations',{schemaHash:hash(JSON.stringify(declared)),artifact:await this.journal.artifact(JSON.stringify(manifest))},{runId:this.runId});
  }
  async validateRequest(context?: PreparedRequestContext) {
    this.signal.throwIfAborted(); this.journal.check();
    const binding = sessionBinding(this.journal.events);
    if (binding) await checkSessionTarget(binding, this.host.catalog.home);
    if (!context) return;
    await this.validateContext(context.snapshot.view.prompt, context.snapshot.model.resourceId);
  }
  /** Read-only source check, suitable for the compaction writer-queue predicate. */
  async validateContext(prompt: ReturnType<typeof assemblePrompt>, modelResourceId?: string) {
    this.signal.throwIfAborted(); this.journal.check();
    const ids = new Set<string>();
    if (modelResourceId && !modelResourceId.startsWith("builtin:")) ids.add(modelResourceId);
    for (const fragment of prompt.fragments) {
      const owner = this.instructionOwners.get(fragment.source); if (owner) ids.add(owner);
    }
    for (const schema of prompt.schemas) {
      const owner = this.toolOwners.get(schema.name); if (owner) ids.add(owner);
    }
    await this.assertResources(ids);
    for (const fragment of prompt.fragments.filter(fragment => this.ruleSources.has(fragment.source) && !this.instructionOwners.has(fragment.source))) {
      const path = fragment.source.slice(5);
      if (!await exists(await safePath(this.host.catalog.workspace, path))) throw new Error(`Rule scope revoked: ${path}`);
    }
  }
  private async validateTool(name: string, args: Readonly<Record<string, unknown>>) {
    this.signal.throwIfAborted(); this.journal.check();
    const binding = sessionBinding(this.journal.events);
    if (binding) await checkSessionTarget(binding, this.host.catalog.home);
    if (!this.toolModeAllowed(name)) throw modeDenial("Tool unavailable in this session mode");
    const ids = [this.toolOwners.get(name), name === "resource_read" && typeof args.id === "string" ? args.id : undefined,
      ["mcp_content","mcp_discover","mcp_call"].includes(name) && typeof args.server === "string" ? args.server : undefined].filter((value): value is string => !!value);
    const links = this.journal.links();
    for (const callId of [links.toolCallId, links.parentToolCallId]) {
      const request = callId && this.journal.events.findLast(event => event.type === "tool.requested" && event.toolCallId === callId);
      const source = request && (request.payload as { source?: string }).source;
      if (source) ids.push(source);
    }
    await this.assertResources(ids);
  }
  async refreshContext() {
    let states: ResourceAccessState[] | undefined;
    try { states = await this.access?.inspect(); }
    catch (error) {
      if (error instanceof ResourceScopeError) {
        const revoked = new Set(error.resourceIds);
        for (const id of revoked) this.unavailableResources.add(id);
        for (let index = this.instructions.length - 1; index >= 0; index--) {
          const instruction = this.instructions[index]!, owner = this.instructionOwners.get(instruction.source);
          if (owner && revoked.has(owner)) {
            this.instructions.splice(index, 1);
            if (instruction.section === "rules") this.rules.delete(instruction.source.slice(5));
            await this.journal.append("instruction.withdrawn", { source: instruction.source, hash: hash(promptEscape(instruction.text)), sourceHash: hash(instruction.text),
              section: instruction.section, scope: instruction.scope, version: instruction.version ?? "1", resourceId: owner, reason: "scope-changed" }, { runId: this.runId });
          }
        }
        this.contextResources = this.contextResources.map(resource => revoked.has(resource.id) ? { ...resource, status: "scope-changed", present: false, accessReason: "scope-changed" } : resource);
        await this.journal.append("resources.context", { version: CONTEXT_POLICY.version, revision: this.catalogRevision, items: this.contextResources, blocked: true }, { runId: this.runId });
      }
      throw error;
    }
    if (!states) return false;
    let withdrawn = false;
    this.unavailableResources = new Set(states.filter(state => !state.available).map(state => state.id));
    const byId = new Map(states.map(state => [state.id, state]));
    for (let index = this.instructions.length - 1; index >= 0; index--) {
      const instruction = this.instructions[index]!, owner = this.instructionOwners.get(instruction.source);
      let invalidRule = false;
      if (!owner && this.ruleSources.has(instruction.source)) {
        try { invalidRule = !await exists(await safePath(this.host.catalog.workspace, instruction.source.slice(5))); }
        catch { invalidRule = true; }
      }
      if (owner && this.unavailableResources.has(owner) || invalidRule) {
        this.instructions.splice(index, 1);
        withdrawn = true;
        if (instruction.section === "rules") this.rules.delete(instruction.source.slice(5));
        await this.journal.append("instruction.withdrawn", { source: instruction.source, hash: hash(promptEscape(instruction.text)), sourceHash: hash(instruction.text),
          section: instruction.section, scope: instruction.scope, version: instruction.version ?? "1", resourceId: owner,
          reason: owner ? byId.get(owner)?.reason : "scope-changed" }, { runId: this.runId });
      }
    }
    const commands = this.instructions.find(instruction => instruction.source === `commands:${this.activation.revision}`);
    if (commands) commands.text = `User commands: ${commandTargets(this.activation, this.mode).filter(target => !this.unavailableResources.has(target.ext.resource.id)).map(target => "/" + target.ext.resource.name + ":" + target.name).join(", ")}. Unique short names are also accepted.`;
    this.contextResources = this.activation.resources.map(resource => {
      const state = byId.get(resource.id)!;
      return { ...this.contextDescriptor(resource), status: state.status, present: state.present, accessReason: state.reason, currentRevision: state.currentRevision };
    });
    const state = hash(JSON.stringify(this.contextResources));
    this.catalogRevision = hash(JSON.stringify([this.activation.revision, state]));
    if (state !== this.contextState) {
      await this.journal.append("resources.context", { version: CONTEXT_POLICY.version, revision: this.catalogRevision, items: this.contextResources }, { runId: this.runId });
      const exclusions = this.capabilityNames.flatMap(name => {
        const resourceId = this.toolOwners.get(name);
        return resourceId && this.unavailableResources.has(resourceId) ? [{ name, resourceId, reason: byId.get(resourceId)?.reason ?? "unavailable" }] : [];
      });
      const removed = new Set(exclusions.map(item => item.name));
      await this.journal.append("capabilities.effective", { mode: this.mode, capabilityRevision: this.activation.revision,
        tools: this.capabilityNames.filter(name => !removed.has(name)), excludedTools: [...this.excludedTools].sort(), toolExclusions: exclusions,
        commands: commandTargets(this.activation, this.mode).filter(target => !this.unavailableResources.has(target.ext.resource.id)).map(target => `${target.ext.resource.name}:${target.name}`).sort() }, { ...this.evidenceLinks, runId: this.runId });
      this.contextState = state;
    }
    this.refreshDirectory();
    return withdrawn;
  }
  private refreshDirectory() {
    if (!this.directorySource) return;
    const entries = this.contextResources.filter(resource => resource.status === "enabled" && resource.modeAllowed);
    const page = contextDirectory(entries, this.catalogRevision, { bytes: CONTEXT_POLICY.directoryBytes,
      accept: page => Buffer.byteLength(promptEscape(JSON.stringify(page))) <= CONTEXT_POLICY.directoryBytes });
    const instruction = this.instructions.find(value => value.source === this.directorySource);
    if (instruction) instruction.text = `Available resources (read matching skills on demand with resource_read):\n${JSON.stringify(page)}\nOmitted entries: ${page.omitted}.`;
    if (this.querySource && !this.instructions.some(value => value.source === this.querySource) && page.omitted)
      this.instructions.push({ source: this.querySource, section: "resources", requiresTools: ["resource_read", "resource_list"], text: "Use resource_list with offset/limit to discover resources omitted from the directory; retain its revision when continuing pages." });
  }
  get mode() { return this.executionMode; }
  toolModeAllowed(name: string) { return !this.excludedTools.has(name) && !(this.mode === "work" && CREATION_TOOLS.has(name)); }
  async recordModeBlock(operation: string, name: string, toolCallId?: string) {
    await this.journal.append(toolCallId ? "tool.blocked" : "operation.blocked", { operation, name, reason: "mode", mode: this.mode },
      { ...this.evidenceLinks, runId: this.runId, ...(toolCallId ? { toolCallId } : {}) });
  }
  constructor(
    readonly host: CustomizationHost,
    readonly activation: Activation,
    readonly journal: Journal,
    readonly runId: string,
    private readonly runSignal: AbortSignal,
    readonly options: ProviderOptions,
    readonly interactions?: Interactions,
    readonly trial = false,
    readonly trialMocks: { model?: string; form?: Json } = {},
    readonly evidenceLinks: import("../journal.js").Links = {},
  ) {}
  private budget() {
    this.signal.throwIfAborted();
    this.journal.check();
    if (++this.operations > LIMITS.operations)
      throw new Error("Customization operation budget exceeded");
  }
  async initialize(builtins: ToolDefinition[]) {
    const binding = sessionBinding(this.journal.events);
    this.executionMode = binding?.mode ?? this.evidenceLinks.mode ?? this.options.mode ?? "work";
    if (binding && this.options.mode && this.options.mode !== binding.mode) throw new Error("Session mode cannot change");
    this.access = await ResourceAccess.create(this.host.catalog, this.activation.resources, !!this.evidenceLinks.workflowId, this.trial);
    const { revision } = this.activation;
    const artifact = await this.journal.artifact(
      JSON.stringify({
        ...this.activation.snapshot,
        resources: this.activation.resources
          .filter((r) => r.status === "enabled")
          .map((r) => ({ ...r, config: undefined })),
        mcp: this.activation.mcp.map((m) => ({
          id: m.resource.id,
          server: m.serverInfo,
          tools: m.tools,
          resources: m.resources, templates: m.templates, prompts: m.prompts,
        })),
      }),
    );
    await this.journal.append(
      "resources.activated",
      { version: 1, revision, artifact },
      { runId: this.runId },
    );
    this.definitions.push(...builtins.filter(definition => this.toolModeAllowed(definition.tool.name)));
    this.add('model_catalog','List typed model identities, capabilities and credential availability without calling a model.',Type.Object({operation:Type.Optional(Type.Union(['chat','classifier','image'].map(v=>Type.Literal(v)))),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))}),async args=>{
      const items=(await this.host.modelCatalog(!!this.options.apiKey||undefined)).flatMap(provider=>provider.models.map(model=>({provider:provider.id,revision:provider.revision,...model}))).filter(model=>!args.operation||model.operation===args.operation);
      const offset=Number(args.offset??0),limit=Number(args.limit??20),value={items:items.slice(offset,offset+limit),total:items.length,...(offset+limit<items.length?{nextOffset:offset+limit}:{})};
      return {content:[{type:'text',text:JSON.stringify(value)}],details:JSON.parse(JSON.stringify(value))};
    },undefined,[],'Discover models by operation and configuration status');
    const question = Type.Union([
      Type.Object({type:Type.Literal('bool'),instructions:Type.String(),criteria:Type.Object({true:Type.String(),false:Type.String()})}),
      Type.Object({type:Type.Literal('choice'),instructions:Type.String(),criteria:Type.Record(Type.String(),Type.String())}),
      Type.Object({type:Type.Literal('score'),instructions:Type.String(),criteria:Type.Array(Type.String(),{minItems:1})}),
    ]);
    this.add('model_classify','Classify data with the explicitly configured classifier model.',Type.Object({profile:Type.Optional(Type.String()),state:Type.Record(Type.String(),Type.Unknown()),questions:Type.Record(Type.String(),question)}),async args=>{
      if(this.trial)throw new Error('Typed model calls are unavailable in simulated trials');
      return callModelOperation(this.host,this.activation,this.journal,this.journal.links({runId:this.runId}),this.options,this.signal,{operation:'classifier',profile:args.profile as string|undefined,context:{state:args.state as any,questions:args.questions as any}});
    },undefined,[],'Classify explicit data using the configured classifier');
    this.add('model_image','Generate images with the explicitly configured image model; returns persistent evidence references.',Type.Object({profile:Type.Optional(Type.String()),input:Type.Array(Type.Union([Type.Object({type:Type.Literal('text'),text:Type.String()}),Type.Object({type:Type.Literal('image'),data:Type.String(),mimeType:Type.String()})]),{minItems:1})}),async args=>{
      if(this.trial)throw new Error('Typed model calls are unavailable in simulated trials');
      return callModelOperation(this.host,this.activation,this.journal,this.journal.links({runId:this.runId}),this.options,this.signal,{operation:'image',profile:args.profile as string|undefined,context:{input:args.input as any}});
    },undefined,[],'Generate images using the configured image model');
    for (const ext of this.activation.extensions)
      for (const t of ext.tools) {
        const fullName = `ext_${ext.resource.name.replace(/-/g, "_")}_${t.name}`;
        const name =
          fullName.length <= 64
            ? fullName
            : fullName.slice(0, 55) + "_" + hash(fullName).slice(0, 8);
        this.add(
          name,
          t.description,
          t.parameters,
          async (args, callId) => t.execute(args, this.context(ext, callId)),
          ext.resource,
          t.promptGuidelines,
          t.promptSnippet,
          undefined, t.modes,
        );
      }
    const discovery = new McpDiscovery(this.activation.mcp, server => this.assertResources([server]), this.journal);
    this.mcpDiscovery=discovery;await discovery.restore();
    if(this.activation.mcp.some(m=>m.exposure!=="hidden")) {
      this.add('mcp_discover','Discover a server tool page and its fixed schema revision. Discovery does not grant permission.',Type.Object({server:Type.String(),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:32}))}),async args=>{
        const value=await discovery.discover(String(args.server),this.signal,Number(args.offset??0),Number(args.limit??20));
        await this.journal.append('mcp.discovery',value);
        return {content:[{type:'text',text:JSON.stringify(value)}],details:JSON.parse(JSON.stringify(value))};
      },undefined,[],'Discover MCP tool identities and schemas by server ID');
      this.add('mcp_call','Call an exact tool identity and revision returned by mcp_discover. Codemode servers require script invocation.',Type.Object({server:Type.String(),tool:Type.String(),revision:Type.String(),args:Type.Record(Type.String(),Type.Unknown())}),async args=>{
        const links=this.journal.links(),request=this.journal.events.findLast(event=>event.type==='tool.requested'&&event.toolCallId===links.toolCallId);
        return discovery.call(String(args.server),String(args.tool),String(args.revision),args.args as Record<string,unknown>,this.signal,(request?.payload as {origin?:string}|undefined)?.origin==='codemode');
      },undefined,[],'Call a discovered MCP tool using its exact revision');
    }
    for (const m of this.activation.mcp.filter(connection => connection.exposure === "direct"))
      for (const tool of m.tools) {
        const name = mcpToolName(m.resource, tool.name);
        if (tool.inputSchema.type !== "object")
          throw new Error(`Unsupported MCP schema: ${tool.name}`);
        this.add(
          name,
          `${tool.name}: ${tool.description ?? "MCP tool"}`,
          tool.inputSchema as any,
          async (args) => {
            const grant = await this.host.catalog.grant(m.resource);
            if (!grant?.enabled || !grant.trusted) throw new Error("MCP grant revoked");
            try { return await m.call(tool.name, args, this.signal); }
            finally {
              if (m.cleanup) await this.journal.append("mcp.cleanup", { server: m.resource.id, ...m.cleanup });
            }
          },
          m.resource, [], undefined, tool.description??"",
        );
      }
    if (this.activation.mcp.some(m => m.exposure !== "hidden")) this.add("mcp_content", "Explicitly list/read MCP resources or get a prompt as untrusted tool data. Prompts are distinct from Skills and never become system instructions. Resource links are never fetched automatically; subscription notifications only mark a pending refresh.", Type.Object({ action: Type.Union(["list", "read", "prompt", "subscribe", "unsubscribe"].map(v => Type.Literal(v))), server: Type.String(), uri: Type.Optional(Type.String()), template: Type.Optional(Type.String()), name: Type.Optional(Type.String()), parameters: Type.Optional(Type.Record(Type.String(), Type.String())) }), async args => {
      const connection = this.activation.mcp.find(m => m.resource.id === args.server && m.exposure !== "hidden");
      if (!connection) throw new Error("Unknown MCP server identity");
      const grant = await this.host.catalog.grant(connection.resource);
      if (!grant?.enabled || !grant.trusted) throw new Error("MCP grant revoked");
      await connection.ready(this.signal);
      await this.assertResources([connection.resource.id]);
      const parameters = (args.parameters ?? {}) as Record<string, string>;
      const result = args.action === "list" ? { content: [{ type: "text" as const, text: JSON.stringify(connection.catalog()) }] } : args.action === "read" ? await connection.readContent({ uri: args.uri as string | undefined, template: args.template as string | undefined, parameters }, this.signal) : args.action === "prompt" ? await connection.prompt(String(args.name ?? ""), parameters, this.signal) : { content: [{ type: "text" as const, text: JSON.stringify(await connection.subscribe(String(args.uri ?? ""), args.action === "subscribe", this.signal)) }] };
      this.mcpContentBytes += Buffer.byteLength(JSON.stringify(result));
      if (this.mcpContentBytes > LIMITS.result * 4) throw new Error("MCP cumulative content limit exceeded");
      const source = {server:connection.resource.id,revision:connection.resource.hash,contentRevision:connection.catalog().contentRevision,mode:this.mode,targetId:binding?.target.id??this.evidenceLinks.targetId,action:args.action};
      const artifact = await this.journal.artifact(JSON.stringify(result));
      const observed = await this.journal.append('mcp.content.observed',{source,artifact,grantsPermissions:false},{resourceId:connection.resource.id,resourceRevision:connection.resource.hash});
      const details = 'details' in result && result.details && typeof result.details==='object' && !Array.isArray(result.details) ? result.details : {};
      return {...result,details:JSON.parse(JSON.stringify({...details,source:{...('source' in details && typeof details.source==='object'?details.source:{}),...source},observation:{eventId:observed.eventId,artifact}}))};
    });
    const enabled = this.activation.resources.filter(
      (r) => r.status === "enabled",
    );
    const readable = enabled.filter((r) => (this.mode === "create" || r.kind !== "doc") &&
      ["skill", "rule", "doc", "extension", "mcp", "provider", "workflow", "panel"].includes(r.kind),
    );
    if (readable.length || this.activation.extensions.length) {
      this.add(
        "resource_read",
        this.mode === "create" ? "Read a discovered skill, rule or SDK document by its resource ID." : "Read a discovered project skill, rule or enabled resource by its ID.",
        Type.Object({ id: Type.String(), file: Type.Optional(Type.String()) }),
        async (args) => ({
          content: [
            {
              type: "text",
              text: await this.load(
                String(args.id),
                args.file as string | undefined,
              ),
            },
          ],
        }),
      );
      const entries = readable.map(resource => this.contextDescriptor(resource));
      const directory = contextDirectory(entries, revision, { bytes: CONTEXT_POLICY.directoryBytes,
        accept: page => Buffer.byteLength(promptEscape(JSON.stringify(page))) <= CONTEXT_POLICY.directoryBytes });
      this.instructions.push({
        source: `resources:${revision}`, section: "resources", requiresTools: ["resource_read"],
        text: `Available resources (read matching skills on demand with resource_read):\n${JSON.stringify(directory)}\nOmitted entries: ${directory.omitted}.`,
      });
      this.directorySource = `resources:${revision}`;
      this.querySource = `resource-directory-query:${revision}`;
      if (directory.omitted) this.instructions.push({ source: `resource-directory-query:${revision}`, section: "resources", requiresTools: ["resource_read", "resource_list"], text: "Use resource_list with offset/limit to discover resources omitted from the directory; retain its revision when continuing pages." });
    }
    const contextResources = this.activation.resources.map(resource => this.contextDescriptor(resource));
    this.contextResources = contextResources; this.catalogRevision = revision;
    await this.journal.append("resources.context", { version: CONTEXT_POLICY.version, revision, items: contextResources }, { runId: this.runId });
    this.add(
      "resource_list",
      "List a bounded page of resource IDs, revisions, scopes and activation states. Continue with next and the returned revision.",
      Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: CONTEXT_POLICY.pageEntries })), revision: Type.Optional(Type.String()) }),
      async args => {
        if (args.revision !== undefined && args.revision !== this.catalogRevision) throw new Error("Resource catalog revision changed; restart discovery");
        const resources = this.contextResources.filter(resource => resource.modeAllowed);
        const page = contextDirectory(resources, this.catalogRevision, { offset: args.offset as number | undefined, limit: args.limit as number | undefined,
          // Preserve structured pagination through the common result projector.
          accept: page => Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(page) }], details: page })) <= LIMITS.projection });
        return { content: [{ type: "text", text: JSON.stringify(page) }], details: JSON.parse(JSON.stringify(page)) };
      },
    );
    this.add(
      "customization_validate",
      "Statically validate discovered extensions without executing factories.",
      Type.Object({}),
      async () => {
        const resources = await this.host.catalog.discover();
        const checks = await Promise.all(
          resources
            .filter((r) => r.kind === "extension")
            .map(async (r) => ({
              id: r.id,
              source: r.source,
              errors: await validateExtension(r),
              report: checkTypes(r),
            })),
        );
        for (const resource of resources.filter(r => r.kind === 'extension')) await this.host.lifecycle.record(resource,'static',{passed:checks.find(c => c.id === resource.id)?.report.passed,sessionId:basename(this.journal.directory),runId:this.runId,sourceBinding:sessionBinding(this.journal.events)});
        return { content: [{ type: "text", text: JSON.stringify(checks) }] };
      },
    );
    this.add("customization_status", "Read current host customization stages, missing permissions and next steps. Unlike resource_list this reads current discovery, without loading code or changing settings.", Type.Object({resourceId:Type.Optional(Type.String())}), async args => {
      const items = (await this.host.lifecycle.catalog()).filter(item => !args.resourceId || item.resourceId === args.resourceId);
      return {content:[{type:'text',text:JSON.stringify({host:(await sdkCatalog(undefined,this.host.catalog.workspace,this.host.catalog.home,binding?.target)).host,pinnedActivation:this.activation.revision,currentActivation:this.host.active?.revision,items:items.slice(0,100),total:items.length,receipts:this.host.receipts.slice(-3)})}],details:JSON.parse(JSON.stringify({kind:'customization-delivery',items:items.slice(0,20).map(({key,resourceId,revision,name,type,phase,missing,scope})=>({key,resourceId,revision,name,type,phase,missing,scope}))}))};
    });
    this.add("customization_sdk", "Read the installed SDK catalog or signatures; availableCapabilities identifies implemented registrations.", Type.Object({ entry: Type.Optional(Type.String()) }), async args => ({ content: [{ type: "text", text: JSON.stringify(await sdkCatalog(args.entry as string | undefined,this.host.catalog.workspace,this.host.catalog.home,binding?.target)) }] }));
    this.add("customization_candidate", "Create, list or fully type-check an isolated project candidate. Activation requires explicit authorization and the checked content hash.", Type.Object({ action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("inspect"), Type.Literal("activate"), Type.Literal("rollback"), Type.Literal("export")]), output: Type.Optional(Type.String()), name: Type.Optional(Type.String()), template: Type.Optional(Type.String()), id: Type.Optional(Type.String()), contentHash: Type.Optional(Type.String()) }), async args => {
      const store = new Candidates(this.host.catalog.workspace);
      const result = args.action === "create" ? await store.scaffold(String(args.name ?? ""), typeof args.template === "string" ? args.template : undefined, binding ? {session:binding,runId:this.runId} : undefined) : args.action === "inspect" ? await store.preview(String(args.id ?? "")) : args.action === "activate" ? await this.host.requestCandidate(String(args.id ?? ""), String(args.contentHash ?? "")) : args.action === "export" ? await store.export(String(args.id??""),String(args.contentHash??""),String(args.output??"")) : args.action === "rollback" ? await this.host.requestRollback(String(args.name ?? "")) : await store.list();
      if (args.action === 'create' || args.action === 'inspect') {
        const resource = await store.read(args.action === 'create' ? (result as {id:string}).id : String(args.id));
        await this.host.lifecycle.record(resource,args.action === 'create' ? 'created' : 'static',{sessionId:basename(this.journal.directory),runId:this.runId,sourceBinding:sessionBinding(this.journal.events),...(args.action === 'inspect' ? {passed:(result as unknown as {report:{passed:boolean}}).report.passed} : {})});
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    });
    this.add("customization_package", "Prepare, inspect, activate, share or remove capability packages. New sources and expanded permissions require user authorization in management. Prepare does not execute package scripts. Local sources must be inside the workspace.", Type.Object({ action: Type.Union(["prepare", "inspect", "activate", "list", "rollback", "export", "uninstall"].map(v => Type.Literal(v))), scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("user")])), id: Type.Optional(Type.String()), source: Type.Optional(Type.Object({ kind: Type.String(), path: Type.Optional(Type.String()), name: Type.Optional(Type.String()), version: Type.Optional(Type.String()), registry: Type.Optional(Type.String()), url: Type.Optional(Type.String()), commit: Type.Optional(Type.String()) })), bindings: Type.Optional(Type.Record(Type.String(), Type.String())), output: Type.Optional(Type.String()) }), async args => {
      const result = await packageAction(this.host,args,{user:false,signal:this.signal,origin:binding?{session:binding,runId:this.runId}:undefined});
      if (args.action === 'prepare') {
        const {Packages} = await import('./packages.js');
        const store = new Packages(this.host.catalog.workspace,this.host.catalog.home);
        const candidate = result as Awaited<ReturnType<typeof store.prepare>>;
        const stage = (await store.list()).some(p => p.packageId === candidate.packageId) ? 'updated' : 'created';
        for(const resource of await store.resources(candidate)) await this.host.lifecycle.record(resource,stage,{sessionId:basename(this.journal.directory),runId:this.runId,sourceBinding:sessionBinding(this.journal.events)});
      }
      return {content:[{type:'text',text:JSON.stringify(result)}]};
    });
    this.add(
      "resource_write",
      "Write a customization resource. scope defaults to project; explicit user scope requires user directory writing authorization. previousHash null creates a file; existing files require their current hash.",
      Type.Object({
        scope: Type.Optional(Type.Union([Type.Literal("project"),Type.Literal("user")])),
        kind: Type.Union([
          Type.Literal("extension"),
          Type.Literal("skill"),
          Type.Literal("rule"),
          Type.Literal("mcp"),
        ]),
        name: Type.String(),
        file: Type.String(),
        text: Type.String(),
        previousHash: Type.Union([Type.String(), Type.Null()]),
      }),
      async (args) => {
        const scope=args.scope===undefined?"project":args.scope;
        if(scope!=="project"&&scope!=="user")throw new Error("Invalid resource scope");
        const before = args.previousHash;
        const existed=(await this.host.catalog.discover()).some(r=>r.name===args.name&&r.kind===args.kind&&r.scope===scope);
        const result = await this.host.catalog.write(
          args.kind as "extension" | "skill" | "rule" | "mcp",
          String(args.name),
          String(args.file),
          String(args.text),
          before as string | null,
          scope,
        );
        for (const resource of (await this.host.catalog.discover()).filter(r => r.name === args.name && r.scope === scope && r.kind === args.kind)) await this.host.lifecycle.record(resource,existed ? 'updated' : 'created',{sessionId:basename(this.journal.directory),runId:this.runId,sourceBinding:sessionBinding(this.journal.events)});
        await this.journal.append(
          "resource.written",
          {
            ...result,
            beforeHash: before,
            artifact: await this.journal.artifact(String(args.text)),
          },
          { runId: this.runId },
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );
    this.add(
      "customization_reload",
      "Queue resource reload after this run finishes. Receipt pending is not activation success.",
      Type.Object({}),
      async () => ({
        content: [
          { type: "text", text: JSON.stringify(this.host.requestReload()) },
        ],
      }),
    );
    this.instructions.push({source:"customization:entry:v2",version:"2",section:"resources",requiresTools:["customization_sdk"],text:"When building Nekomimi capabilities, first read customization_sdk and its matching installed guides before writing code. New capabilities default to project scope; user scope requires explicit cross-project intent. Supported capabilities do not grant authorization."});
    this.instructions.push({source:"customization:delivery:v2",version:"2",section:"resources",requiresTools:["customization_status"],text:"After developing a capability, check customization_status for the affected resource. Report its actual stage and user-visible effect; queued reload is not applied UI. Keep raw technical evidence in details."});
    for (const r of enabled.filter((r) => r.kind === "rule" && !r.ruleBinding))
      await this.recordRule(r.path, r.text, r.scope === "user" ? "user" : ".", r);
    const commands = commandTargets(this.activation, this.mode).map(target => `${target.ext.resource.name}:${target.name}`);
    if (commands.length)
      this.instructions.push({
        source: `commands:${revision}`,
        text: `User commands: ${commands.map((c) => "/" + c).join(", ")}. Unique short names are also accepted.`,
      });
    for (const definition of this.definitions) {
      definition.tool = bindToolPolicy(definition.tool, {
        revision: this.activation.revision,
        before: async (name, args) => {
          this.signal.throwIfAborted(); this.journal.check();
          if (binding) await checkSessionTarget(binding, this.host.catalog.home);
          if (!this.toolModeAllowed(name)) { await this.recordModeBlock("tool", name); throw modeDenial("Tool unavailable in this session mode"); }
          if (this.mode === "work" && name === "resource_read" && this.activation.resources.some(resource => resource.id === args.id && resource.kind === "doc"))
            throw modeDenial("Development documents require create mode");
          if (!this.definitions.includes(definition)) throw new Error("Unknown or disabled tool");
          await this.validateTool(name, args);
          return await this.checkRules(name, args as Record<string, Json>) ?? await this.hook("beforeTool", { tool: name, args: args as Record<string, Json> });
        },
        revalidate: (name, args) => this.validateTool(name, args),
        after: async (name, args, result) => { await this.hook("afterTool", { tool: name, args: args as Record<string, Json>, result: result as ToolResult }); },
      }, this.journal, { ...this.evidenceLinks, runId: this.runId });
    }
    this.capabilityNames = this.definitions.map(definition => definition.tool.name).sort();
    await this.journal.append("capabilities.effective", { mode: this.mode, targetId: binding?.target.id ?? this.evidenceLinks.targetId,
      capabilityRevision: this.activation.revision, tools: this.definitions.map(definition => definition.tool.name).sort(), excludedTools: [...this.excludedTools].sort(),
      commands: commands.slice().sort() }, { ...this.evidenceLinks, runId: this.runId });
  }
  private add(
    name: string,
    description: string,
    parameters: object,
    execute: (
      args: Record<string, Json>,
      callId: string,
    ) => Promise<ToolResult>,
    resource?: Resource,
    guidance: string[] = [],
    snippet?: string,
    originalDescription = description,
    modes?: SessionMode[],
  ) {
    if (!this.toolModeAllowed(name) || !modeAllows(this.mode, modes)) { this.excludedTools.add(name); return; }
    if (this.definitions.some((d) => d.tool.name === name))
      throw new Error(`Duplicate tool name ${name}`);
    const contract = resource ? {parameters,snippet:snippet??""} : hostToolContract(name,parameters,this.mode);
    const links = {
      ...this.evidenceLinks,
      runId: this.runId,
      resourceId: resource?.id,
      resourceRevision: this.activation.revision,
    };
    const tool: RuntimeTool = {
      name,
      label: name,
      description,
      parameters: contract.parameters as RuntimeTool["parameters"],
      execute: async (callId, args, signal) => this.callSignals.run(signal ? AbortSignal.any([this.signal, signal]) : this.signal, async () => {
        this.budget();
        if(!resource)validateHostToolArgs(name,args as Record<string,unknown>);
        const result = await deadline(
          execute(args as Record<string, Json>, callId),
          120000,
        );
        return { ...result, details: result.details ?? {} };
      }),
    };
    if (resource) this.toolOwners.set(name, resource.id);
    this.definitions.push({
      tool: recordedTool(tool, this.journal, links, {
        resourceId: resource?.id,
        resourceRevision: this.activation.revision,
        originalDescription, effectiveDescription: description,
      }),
      source: resource
        ? `${resource.id}:${resource.hash}`
        : `harness:${name}:2`,
      snippet: snippet??contract.snippet,
      guidance,
    });
  }
  async load(resourceId: string, file?: string) {
    const resource = this.activation.resources.find(
      (r) => r.id === resourceId && r.status === "enabled",
    );
    if (!resource) throw new Error("Resource unavailable or ambiguous; use resource_list for enabled IDs or customization_sdk for installed guides.");
    if (this.mode === "work" && resource.kind === "doc") { await this.recordModeBlock("resource_read", resourceId); throw modeDenial("Development documents require create mode"); }
    await this.assertResources([resourceId]);
    const sourcePath = await safePath(resource.root, resource.path.split('#')[0]!);
    if (!await exists(sourcePath)) throw new Error('Resource source missing; reload resources');
    let text: string;
    if (["extension", "provider", "workflow", "panel"].includes(resource.kind)) {
      if (!file || !Object.hasOwn(resource.files ?? {}, file))
        throw new Error("Specify a declared extension file");
      text = resource.files![file]!;
    } else if (resource.kind === "mcp")
      text = resource.files?.['mcp.json'] ?? resource.text;
    else text = resource.text;
    const artifact = await this.journal.artifact(text);
    const source = `${resource.id}:${hash(text)}`;
    await this.journal.append(
      resource.kind === "skill" ? "skill.loaded" : "resource.read",
      { resourceId, resourceRevision: resource.hash, name: resource.name, path: resource.source, source, artifact, hash: hash(text), scope: resource.scope },
      { runId: this.runId },
    );
    if (resource.kind === "skill")
      this.instructionOwners.set(source, resourceId);
    if (resource.kind === "skill")
      this.setInstruction(
        source,
        `[Skill ${resource.name}; source ${resource.source}]\n${text}`,
        "skills", resource.scope,
      );
    if(resource.kind === "skill") return `Skill ${resource.name} loaded into current instructions; source ${source}; full evidence artifact:${artifact.sha256}.`;
    return ["extension", "provider", "workflow", "panel", "mcp"].includes(resource.kind)
      ? `Content hash: ${hash(text)}\n${text}`
      : text;
  }
  private setInstruction(source: string, text: string, section:Instruction["section"]="instructions", scope?:string) {
    const old = this.instructions.find((i) => i.source === source);
    if (old) old.text = text;
    else this.instructions.push({ source, text, section, scope });
  }
  private contextDescriptor(resource: Resource): ContextResource {
    const description = resource.description ?? "";
    return { id: resource.id, kind: resource.kind, name: shortContextText(resource.name, 256), revision: resource.hash,
      scope: resource.scope, status: resource.status, source: shortContextText(resource.source, 512),
      sourceHash: hash(resource.source), sourceTruncated: Buffer.byteLength(resource.source) > 512,
      modeAllowed: this.mode === "create" || resource.kind !== "doc", description: shortContextText(description, CONTEXT_POLICY.descriptionBytes),
      descriptionHash: hash(description), descriptionTruncated: Buffer.byteLength(description) > CONTEXT_POLICY.descriptionBytes };
  }
  private async recordRule(path: string, text: string, scope: string, resource?: Resource) {
    const digest = hash(text);
    if (this.rules.get(path) === digest) return false;
    this.rules.set(path, digest);
    const source = `rule:${path}`;
    this.ruleSources.add(source);
    if (resource) this.instructionOwners.set(source, resource.id);
    this.setInstruction(
      source,
      `[Rule scope: ${scope}; more specific scopes apply only to their target paths]\n${text}`,
      "rules", scope,
    );
    await this.journal.append(
      "rule.loaded",
      {
        resourceId: resource?.id ?? `rule:${hash(path).slice(0, 20)}`,
        resourceRevision: resource?.hash ?? digest, path, name: resource?.name ?? path, source,
        scope,
        hash: digest,
        artifact: await this.journal.artifact(text),
      },
      { runId: this.runId },
    );
    return true;
  }
  async checkRules(name: string, args: Record<string, Json>) {
    const targets: string[] = [];
    if (
      ["read", "write", "edit"].includes(name) &&
      typeof args.path === "string" &&
      !args.path.startsWith("artifact:")
    )
      targets.push(args.path);
    if (["bash", "powershell"].includes(name)) targets.push("__cwd__");
    if (!targets.length) return;
    let changed = await this.refreshContext();
    for (const r of this.activation.resources.filter(
      (r) => r.kind === "rule" && r.scope === "user" && r.status === "enabled" && !this.unavailableResources.has(r.id) && !r.ruleBinding,
    )) {
      if (await exists(r.path))
        changed =
          (await this.recordRule(
            r.path,
            await boundedRead(await safePath(r.root, r.path)),
            "user", r,
          )) || changed;
      else if (this.rules.delete(r.path)) {
        const index = this.instructions.findIndex(
          (i) => i.source === `rule:${r.path}`,
        );
        if (index >= 0) this.instructions.splice(index, 1);
        await this.journal.append(
          "rule.removed",
          { path: r.path },
          { runId: this.runId },
        );
        changed = true;
      }
    }
    for (const target of targets) {
      const root = await realpath(this.host.catalog.workspace);
      const resolved = await safePath(root, target);
      for (const resource of this.activation.resources.filter(r => r.kind === "rule" && r.status === "enabled" && !this.unavailableResources.has(r.id) && r.ruleBinding)) {
        const binding = resource.ruleBinding!;
        if (binding.workspace !== root) continue;
        const boundRoot = await safePath(root, binding.root);
        const local = relative(boundRoot, resolved).split("\\").join("/");
        if (inside(boundRoot, resolved) && binding.include.some(pattern => matchesGlob(local, pattern))) {
          changed = (await this.recordRule(resource.source, resource.text, `${binding.root} [${binding.include.join(", ")}]; package ${resource.packageId}`, resource)) || changed;
        }
      }
      let dir = dirname(resolved);
      const chain: string[] = [];
      while (inside(root, dir)) {
        chain.unshift(dir);
        if (dir === root) break;
        dir = dirname(dir);
      }
      for (const current of chain) {
        const path = await safePath(root, join(current, "AGENTS.md"));
        if (
          this.activation.resources.some(
            (r) =>
              r.kind === "rule" && r.path === path && (r.status !== "enabled" || this.unavailableResources.has(r.id)),
          )
        )
          continue;
        if (await exists(path))
          changed =
            (await this.recordRule(
              path,
              await boundedRead(path),
              relative(root, current) || ".", this.activation.resources.find(r => r.kind === "rule" && r.path === path),
            )) || changed;
        else if (this.rules.has(path)) {
          this.rules.delete(path);
          const i = this.instructions.findIndex(
            (i) => i.source === `rule:${path}`,
          );
          if (i >= 0) this.instructions.splice(i, 1);
          await this.journal.append(
            "rule.removed",
            { path },
            { runId: this.runId },
          );
          changed = true;
        }
      }
    }
    if (changed) {
      if (++this.changes > 8)
        throw new Error("Rules changed repeatedly; operation stopped");
      return "Rules were loaded or changed. Read the updated scoped instructions and request the operation again.";
    }
  }
  async hook(event: Hook, value: HookEvent = {}) {
    if (!this.trial && (event === 'beforeTool' || event === 'afterTool') && ['write','edit'].includes(value.tool ?? '')) {
      const path = typeof value.args?.path === 'string' ? resolve(this.host.catalog.workspace,value.args.path) : undefined;
      if (path) {
        const store = new Candidates(this.host.catalog.workspace);
        const resources = [...await this.host.catalog.discover(), ...await Promise.all((await store.list()).map(id => store.read(id).catch(() => undefined)))].filter((r): r is Resource => !!r);
        for (const resource of resources.filter(r => r.scope !== 'builtin' && inside(r.root,path))) {
          if (event === 'beforeTool') this.fileVersions.set(resource.id,resource.hash);
          else if (this.fileVersions.get(resource.id) !== resource.hash) {
            await this.host.lifecycle.record(resource,'updated',{sessionId:basename(this.journal.directory),runId:this.runId,sourceBinding:sessionBinding(this.journal.events)});
            this.fileVersions.set(resource.id,resource.hash);
          }
        }
      }
    }
    for (const ext of this.activation.extensions)
      for (const handler of ext.hooks.get(event) ?? []) {
        if (this.unavailableResources.has(ext.resource.id)) continue;
        try {
          this.budget();
          const result = await deadline(
            handler(structuredClone(value), this.context(ext)),
          );
          if (
            result?.block &&
            (event === "beforeRun" || event === "beforeTool")
          )
            return result.block;
        } catch (e) {
          await this.journal.append(
            "extension.error",
            { event, message: String(e) },
            { runId: this.runId, resourceId: ext.resource.id },
          );
          if (event === "beforeRun" || event === "beforeTool") throw e;
        }
      }
    if (event === "afterTool" && !this.trial) {
      for (const ext of this.activation.extensions) for (const panel of ext.panels.filter(p => p.renderer === value.tool && ["sidebar-widget","tool-result"].includes(p.slot) && p.modes.includes(this.mode))) {
        try {
          const props = JSON.parse(JSON.stringify({tool:value.tool,args:value.args,result:value.result}));
          await this.context(ext).ui({kind:'panel',title:panel.title??panel.id,panelId:panel.id,props});
        } catch (error) { await this.journal.append('extension.error',{event:'renderer',panelId:panel.id,message:String(error)},{runId:this.runId,resourceId:ext.resource.id}); }
      }
      await this.host.workflows.observe(this.journal, this.activation, "tool-completed", value.tool, this.options);
    }
  }
  context(ext: LoadedExtension, outerCall?: string): ProcessContext {
    const resourceId = ext.resource.id;
    const links = this.journal.links({
      ...this.evidenceLinks,
      runId: this.runId,
      resourceId,
      resourceRevision: this.activation.revision,
      ...(outerCall ? { toolCallId: outerCall } : {}),
    });
    const stateEvents = () =>
      this.journal.events.filter(
        (e) => e.type === "extension.state" && e.resourceId === resourceId,
      );
    const context: ProcessContext = {
      workspace: this.host.catalog.workspace,
      runId: this.runId,
      reloadReceiptId: this.host.reserveReloadId(),
      recordRpc: async (type, payload, rpcLinks) => { await this.journal.append(type, payload, { ...links, ...rpcLinks }); },
      signal: this.signal,
      resourceId,
      callTool: async (name, args) => {
        const callId = id();
        const childLinks = { ...links, toolCallId: callId, parentToolCallId: links.toolCallId ?? links.parentToolCallId };
        return this.journal.withLinks(childLinks, async () => {
          this.budget();
          const tool = this.definitions.find((d) => d.tool.name === name)?.tool;
          if (!tool) {
            if (!this.toolModeAllowed(name)) { await this.recordModeBlock("tool", name, callId); throw modeDenial("Tool unavailable in this session mode"); }
            throw new Error("Unknown or disabled tool");
          }
          await this.journal.append(
            "tool.requested",
            { name, args, source: resourceId },
            childLinks,
          );
          try {
            const result = (await tool.execute(
              callId,
              args,
              this.signal,
            )) as ToolResult;
            await this.journal.append(
              "tool.result",
              { name, details: result, source: resourceId },
              childLinks,
            );
            return result;
          } catch (e) {
            await this.journal.append(
              "tool.failed",
              { name, error: String(e), source: resourceId },
              childLinks,
            );
            throw e;
          }
        });
      },
      model: async (prompt) => {
        this.budget();
        await this.assertResources([resourceId]);
        if (this.trial) {
          await this.journal.append("trial.model", { prompt }, links);
          return this.trialMocks.model ?? "Trial model response";
        }
        if (
          typeof prompt !== "string" ||
          Buffer.byteLength(prompt) > LIMITS.file
        )
          throw new Error("Invalid model prompt");
        const event = await this.journal.append(
          "extension.model_input",
          {
            source: resourceId,
            item: {
              role: "user",
              content: [{ type: "input_text", text: prompt }],
            },
          },
          links,
        );
        const provider = await createProvider(
          this.host, this.activation,
          this.journal,
          links,
          assemblePrompt([], this.instructions),
          {
            ...this.options,
            purpose: "extension",
            beforeDispatch: async context => { await this.options.beforeDispatch?.(context); await this.assertResources([resourceId]); await this.validateRequest(context); },
            contextEvents: [{ ...event, type: "context.add" } as JournalEvent],
          },
        );
        const stream = await provider.stream(
          provider.model,
          { messages: [] },
          { signal: this.signal },
        );
        const result = await stream.result();
        if (result.stopReason === "error" || result.stopReason === "aborted")
          throw new Error(result.errorMessage ?? "Model call failed");
        return result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
      },
      state: {
        get: async (key, version) => {
          this.budget();
          const e = stateEvents().findLast(
            (e) => (e.payload as any).key === key,
          );
          if (!e) return undefined;
          const p = e.payload as any;
          if (p.version !== version)
            throw new StateCompatibilityError();
          return structuredClone(p.value);
        },
        set: async (key, version, value) => {
          this.budget();
          if (
            !key ||
            !Number.isSafeInteger(version) ||
            version < 1 ||
            Buffer.byteLength(JSON.stringify(value)) > LIMITS.file
          )
            throw new Error("Invalid state value");
          const old = stateEvents().findLast(
            (e) => (e.payload as any).key === key,
          );
          if (old && (old.payload as any).version !== version)
            throw new StateCompatibilityError();
          await this.journal.append(
            "extension.state",
            { key, version, value },
            links,
          );
        },
      },
      contribute: async (text) => {
        this.budget();
        if (Buffer.byteLength(text) > LIMITS.file)
          throw new Error("Context contribution too large");
        const source = `${resourceId}:${id()}`;
        await this.journal.append(
          "extension.context",
          { source, artifact: await this.journal.artifact(text) },
          links,
        );
        this.setInstruction(source, text);
        this.instructionOwners.set(source, resourceId);
      },
      followUp: (prompt) => {
        this.budget();
        if (typeof prompt !== "string" || prompt.length > 32000)
          throw new Error("Invalid follow-up");
        this.followups.push(prompt);
      },
      reload: () => {
        if (this.mode !== "create") {
          void this.recordModeBlock("reload", "reload").catch(error => this.journal.fail(error));
          throw modeDenial("Resource reload requires create mode");
        }
        return this.host.requestReload();
      },
      ui: async (value) => {
        this.budget();
        validateContribution(value);
        let panelEvidence = {};
        if (value.kind === 'panel') {
          const panel = ext.panels.find(p => p.id === value.panelId);
          if (!panel || !panel.modes.includes(this.mode) || !Value.Check(panel.propsSchema, value.props ?? {})) throw new Error('Panel contribution schema/identity invalid');
          panelEvidence = {resourceId, resourceRevision: ext.resource.hash, bundleHash: panel.bundleHash, slot: panel.slot, contractVersion:panel.contractVersion, modes:panel.modes, targetScope:panel.targetScope, themes: panel.themes, fallback: panel.fallback, propsArtifact: await this.journal.artifact(JSON.stringify(value.props ?? {}))};
        }
        const instanceId = id();
        await this.journal.append(
          "extension.ui",
          { version: 1, instanceId, ...value, ...panelEvidence },
          links,
        );
        if (value.kind !== "form") return null;
        if (this.trial)
          return this.trialMocks.form ?? Object.fromEntries(
            (value.fields ?? []).map((f) => [
              f.name,
              f.options?.[0] ?? "trial",
            ]),
          );
        if (!this.interactions) throw new Error("interaction_unavailable");
        return this.interactions.ask(
          this.journal,
          this.runId,
          resourceId,
          value,
          this.signal,
        );
      },
    };
    // RPC arrives on the process pipe's async scope. Restore the callback's
    // parent signal and Journal ownership for every service, including nesting.
    return {
      ...context,
      callTool: AsyncLocalStorage.bind(context.callTool),
      model: AsyncLocalStorage.bind(context.model),
      state: { get: AsyncLocalStorage.bind(context.state.get), set: AsyncLocalStorage.bind(context.state.set) },
      ui: AsyncLocalStorage.bind(context.ui),
      contribute: AsyncLocalStorage.bind(context.contribute),
      followUp: AsyncLocalStorage.bind(context.followUp),
      reload: AsyncLocalStorage.bind(context.reload),
      recordRpc: AsyncLocalStorage.bind(context.recordRpc),
    };
  }
  async command(input: string): Promise<{ handled: boolean; text: string }> {
    if (input.trimEnd() === "/reload") {
      if (this.mode !== "create") { await this.recordModeBlock("command", "reload"); throw modeDenial("Resource reload requires create mode"); }
      return { handled: true, text: JSON.stringify(this.host.requestReload()) };
    }
    const skill = /^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/.exec(input);
    if (skill) {
      const candidates = matchSkills(this.activation, skill[1]!);
      if (candidates.length !== 1)
        throw new Error("Skill missing or ambiguous");
      await this.load(candidates[0]!.id);
      return {
        handled: false,
        text: `Execute skill ${skill[1]}. ${skill[2] ?? ""}`,
      };
    }
    const command = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(input);
    if (!command) return { handled: false, text: input };
    const { candidates, workflows } = matchCommands(this.activation, command[1]!, this.mode);
    const original = matchCommands(this.activation, command[1]!);
    if (!candidates.length && !workflows.length && (original.candidates.length || original.workflows.length)) {
      await this.recordModeBlock("command", command[1]!); throw modeDenial("Command unavailable in this session mode");
    }
    if (workflows.length && candidates.length || workflows.length > 1) throw new Error("Command and workflow ambiguous; use /extension:command");
    if (workflows.length === 1) {
      if (this.trial || this.evidenceLinks.workflowId) throw new Error("Workflow starts require an explicit real run, without recursive step invocation");
      const workflow = workflows[0]!; this.host.workflows.configure(this.options);
      await this.assertResources([workflow.resource.id]);
      const created = await this.host.workflows.create(workflow.resource.id, workflow.id, command[2] ? JSON.parse(command[2]) : {}, this.activation);
      await this.journal.append("workflow.reference", { workflowId: created.id, definitionId: created.definitionId, definitionRevision: created.definitionRevision }, { runId: this.runId, workflowId: created.id });
      const result = await this.host.workflows.advance(created.id, { activation: this.activation, signal: this.signal });
      return { handled: true, text: `Workflow ${result.id}: ${result.status}. Inspect its independent journal for authoritative results.` };
    }
    if (candidates.length !== 1)
      throw new Error("Command missing or ambiguous; use /extension:command");
    const { ext, cmd } = candidates[0]!;
    await this.assertResources([ext.resource.id]);
    this.budget();
    const text = await deadline(
      cmd.handler(command[2] ?? "", this.context(ext)),
      300000,
    );
    return { handled: true, text: text ?? "" };
  }
}
export function validateContribution(value: Contribution) {
  if (
    !value ||
    !["status", "card", "form", "panel"].includes(value.kind) ||
    typeof value.title !== "string" ||
    (value.text !== undefined && typeof value.text !== "string") ||
    Buffer.byteLength(JSON.stringify(value)) > 32000
  )
    throw new Error("Invalid UI contribution");
  if (value.kind === "form") {
    if (
      !Array.isArray(value.fields) ||
      !value.fields.length ||
      value.fields.length > 16
    )
      throw new Error("Invalid form fields");
    const names = new Set<string>();
    for (const f of value.fields) {
      if (
        !/^[a-z][a-z0-9_]{0,39}$/.test(f.name) ||
        names.has(f.name) ||
        typeof f.label !== "string" ||
        (f.options &&
          (!Array.isArray(f.options) ||
            f.options.some((o) => typeof o !== "string")))
      )
        throw new Error("Invalid form field");
      names.add(f.name);
    }
  }
}
