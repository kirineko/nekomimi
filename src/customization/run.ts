import { hostToolContract, validateHostToolArgs } from "./tool-contracts.js";
import { matchCommands, matchSkills } from "./commands.js";
import { Value } from "typebox/value";
import type { ProcessContext } from "./process.js";
import { checkTypes } from "./validation.js";
import { Candidates } from "./candidates.js";
import { sdkCatalog } from "./sdk.js";
import { packageAction } from "./package-management.js";
import { realpath } from "node:fs/promises";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { basename, dirname, join, resolve, relative, matchesGlob } from "node:path";
import { Journal, hash, id, type JournalEvent } from "../journal.js";
import {
  assemblePrompt,
  type Instruction,
  type ToolDefinition,
} from "../context.js";
import type { ProviderOptions } from "../provider.js";
import { createProvider } from "./adapter-provider.js";
import { recordedTool } from "./execution.js";
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
  describe,
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
export class CustomRun {
  readonly instructions: Instruction[] = [];
  readonly followups: string[] = [];
  readonly definitions: ToolDefinition[] = [];
  private rules = new Map<string, string>();
  private changes = 0;
  private operations = 0;
  private fileVersions = new Map<string,string>();
  private mcpContentBytes = 0;
  constructor(
    readonly host: CustomizationHost,
    readonly activation: Activation,
    readonly journal: Journal,
    readonly runId: string,
    readonly signal: AbortSignal,
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
    this.definitions.push(...builtins);
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
        );
      }
    for (const m of this.activation.mcp)
      for (const tool of m.tools) {
        const name = `mcp_${m.resource.name.replace(/-/g, "_")}_${hash(tool.name).slice(0, 8)}`;
        if (tool.inputSchema.type !== "object")
          throw new Error(`Unsupported MCP schema: ${tool.name}`);
        this.add(
          name,
          `${tool.name}: ${tool.description ?? "MCP tool"}`,
          tool.inputSchema as any,
          async (args) => {
            const grant = await this.host.catalog.grant(m.resource);
            if (!grant?.enabled || !grant.trusted) throw new Error("MCP grant revoked");
            return m.call(tool.name, args, this.signal);
          },
          m.resource, [], undefined, tool.description??"",
        );
      }
    if (this.activation.mcp.length) this.add("mcp_content", "Explicitly list/read MCP resources or get a prompt as untrusted tool data. Prompts are distinct from Skills and never become system instructions. Resource links are never fetched automatically; subscription notifications only mark a pending refresh.", Type.Object({ action: Type.Union(["list", "read", "prompt", "subscribe", "unsubscribe"].map(v => Type.Literal(v))), server: Type.String(), uri: Type.Optional(Type.String()), template: Type.Optional(Type.String()), name: Type.Optional(Type.String()), parameters: Type.Optional(Type.Record(Type.String(), Type.String())) }), async args => {
      const connection = this.activation.mcp.find(m => m.resource.id === args.server);
      if (!connection) throw new Error("Unknown MCP server identity");
      const grant = await this.host.catalog.grant(connection.resource);
      if (!grant?.enabled || !grant.trusted) throw new Error("MCP grant revoked");
      const parameters = (args.parameters ?? {}) as Record<string, string>;
      const result = args.action === "list" ? { content: [{ type: "text" as const, text: JSON.stringify(connection.catalog()) }] } : args.action === "read" ? await connection.readContent({ uri: args.uri as string | undefined, template: args.template as string | undefined, parameters }, this.signal) : args.action === "prompt" ? await connection.prompt(String(args.name ?? ""), parameters, this.signal) : { content: [{ type: "text" as const, text: JSON.stringify(await connection.subscribe(String(args.uri ?? ""), args.action === "subscribe", this.signal)) }] };
      this.mcpContentBytes += Buffer.byteLength(JSON.stringify(result));
      if (this.mcpContentBytes > LIMITS.result * 4) throw new Error("MCP cumulative content limit exceeded");
      return result;
    });
    const enabled = this.activation.resources.filter(
      (r) => r.status === "enabled",
    );
    const readable = enabled.filter((r) =>
      ["skill", "rule", "doc", "extension", "mcp", "provider", "workflow", "panel"].includes(r.kind),
    );
    if (readable.length || this.activation.extensions.length) {
      this.add(
        "resource_read",
        "Read a discovered skill, rule or SDK document by its resource ID.",
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
      const entries = readable.map(r => ({id:r.id,kind:r.kind,name:r.name,description:r.description??""})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
      const shown:typeof entries=[];let bytes=0;
      for(const entry of entries.filter(e=>e.kind!=="doc"||e.name==="README.md")){const size=Buffer.byteLength(JSON.stringify(entry));if(bytes+size>4096)break;shown.push(entry);bytes+=size;}
      this.instructions.push({
        source: `resources:${revision}`, section:"resources", requiresTools:["resource_read"],
        text: `Available resources (read matching skills on demand with resource_read; directory may be partial):\n${JSON.stringify(shown)}\nOmitted entries: ${entries.length-shown.length}.`,
      });
      if(entries.length>shown.length)this.instructions.push({source:`resource-directory-query:${revision}`,section:"resources",requiresTools:["resource_read","resource_list"],text:"Use resource_list to discover resources omitted from the directory."});
    }
    this.add(
      "resource_list",
      "List available resource IDs, kinds, sources and states in this activation.",
      Type.Object({}),
      async () => {
        const resources = this.activation.resources.map(describe);
        return {
          content: [{ type: "text", text: JSON.stringify(resources) }],
          details: JSON.parse(JSON.stringify(resources)),
        };
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
        for (const resource of resources.filter(r => r.kind === 'extension')) await this.host.lifecycle.record(resource,'static',{passed:checks.find(c => c.id === resource.id)?.report.passed,sessionId:basename(this.journal.directory),runId:this.runId});
        return { content: [{ type: "text", text: JSON.stringify(checks) }] };
      },
    );
    this.add("customization_status", "Read current host customization stages, missing permissions and next steps. Unlike resource_list this reads current discovery, without loading code or changing settings.", Type.Object({resourceId:Type.Optional(Type.String())}), async args => {
      const items = (await this.host.lifecycle.catalog()).filter(item => !args.resourceId || item.resourceId === args.resourceId);
      return {content:[{type:'text',text:JSON.stringify({host:(await sdkCatalog(undefined,this.host.catalog.workspace,this.host.catalog.home)).host,pinnedActivation:this.activation.revision,currentActivation:this.host.active?.revision,items:items.slice(0,100),total:items.length,receipts:this.host.receipts.slice(-3)})}],details:JSON.parse(JSON.stringify({kind:'customization-delivery',items:items.slice(0,20).map(({key,resourceId,revision,name,type,phase,missing,scope})=>({key,resourceId,revision,name,type,phase,missing,scope}))}))};
    });
    this.add("customization_sdk", "Read the installed SDK catalog or signatures; availableCapabilities identifies implemented registrations.", Type.Object({ entry: Type.Optional(Type.String()) }), async args => ({ content: [{ type: "text", text: JSON.stringify(await sdkCatalog(args.entry as string | undefined,this.host.catalog.workspace,this.host.catalog.home)) }] }));
    this.add("customization_candidate", "Create, list or fully type-check an isolated project candidate. Activation requires explicit authorization and the checked content hash.", Type.Object({ action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("inspect"), Type.Literal("activate"), Type.Literal("rollback"), Type.Literal("export")]), output: Type.Optional(Type.String()), name: Type.Optional(Type.String()), template: Type.Optional(Type.String()), id: Type.Optional(Type.String()), contentHash: Type.Optional(Type.String()) }), async args => {
      const store = new Candidates(this.host.catalog.workspace);
      const result = args.action === "create" ? await store.scaffold(String(args.name ?? ""), typeof args.template === "string" ? args.template : undefined) : args.action === "inspect" ? await store.preview(String(args.id ?? "")) : args.action === "activate" ? await this.host.requestCandidate(String(args.id ?? ""), String(args.contentHash ?? "")) : args.action === "export" ? await store.export(String(args.id??""),String(args.contentHash??""),String(args.output??"")) : args.action === "rollback" ? await this.host.requestRollback(String(args.name ?? "")) : await store.list();
      if (args.action === 'create' || args.action === 'inspect') {
        const resource = await store.read(args.action === 'create' ? (result as {id:string}).id : String(args.id));
        await this.host.lifecycle.record(resource,args.action === 'create' ? 'created' : 'static',{sessionId:basename(this.journal.directory),runId:this.runId,...(args.action === 'inspect' ? {passed:(result as unknown as {report:{passed:boolean}}).report.passed} : {})});
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    });
    this.add("customization_package", "Prepare, inspect, activate, share or remove capability packages. New sources and expanded permissions require user authorization in management. Prepare does not execute package scripts. Local sources must be inside the workspace.", Type.Object({ action: Type.Union(["prepare", "inspect", "activate", "list", "rollback", "export", "uninstall"].map(v => Type.Literal(v))), scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("user")])), id: Type.Optional(Type.String()), source: Type.Optional(Type.Object({ kind: Type.String(), path: Type.Optional(Type.String()), name: Type.Optional(Type.String()), version: Type.Optional(Type.String()), registry: Type.Optional(Type.String()), url: Type.Optional(Type.String()), commit: Type.Optional(Type.String()) })), bindings: Type.Optional(Type.Record(Type.String(), Type.String())), output: Type.Optional(Type.String()) }), async args => {
      const result = await packageAction(this.host,args,{user:false,signal:this.signal});
      if (args.action === 'prepare') {
        const {Packages} = await import('./packages.js');
        const store = new Packages(this.host.catalog.workspace,this.host.catalog.home);
        const candidate = result as Awaited<ReturnType<typeof store.prepare>>;
        const stage = (await store.list()).some(p => p.packageId === candidate.packageId) ? 'updated' : 'created';
        for(const resource of await store.resources(candidate)) await this.host.lifecycle.record(resource,stage,{sessionId:basename(this.journal.directory),runId:this.runId});
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
        for (const resource of (await this.host.catalog.discover()).filter(r => r.name === args.name && r.scope === scope && r.kind === args.kind)) await this.host.lifecycle.record(resource,existed ? 'updated' : 'created',{sessionId:basename(this.journal.directory),runId:this.runId});
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
      await this.recordRule(r.path, r.text, r.scope === "user" ? "user" : ".");
    const commands = this.activation.extensions.flatMap((e) =>
      [...e.commands.keys(), ...e.workflows.flatMap(w => (w.triggers ?? []).filter(t => t.kind === "command").map(t => t.name ?? w.id))].map((name) => `${e.resource.name}:${name}`),
    );
    if (commands.length)
      this.instructions.push({
        source: `commands:${revision}`,
        text: `User commands: ${commands.map((c) => "/" + c).join(", ")}. Unique short names are also accepted.`,
      });
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
  ) {
    if (this.definitions.some((d) => d.tool.name === name))
      throw new Error(`Duplicate tool name ${name}`);
    const contract = resource ? {parameters,snippet:snippet??""} : hostToolContract(name,parameters);
    const links = {
      ...this.evidenceLinks,
      runId: this.runId,
      resourceId: resource?.id,
      resourceRevision: this.activation.revision,
    };
    const tool: AgentTool = {
      name,
      label: name,
      description,
      parameters: contract.parameters as AgentTool["parameters"],
      execute: async (callId, args) => {
        this.budget();
        if(!resource)validateHostToolArgs(name,args as Record<string,unknown>);
        const result = await deadline(
          execute(args as Record<string, Json>, callId),
          120000,
        );
        return { ...result, details: result.details ?? {} };
      },
    };
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
      { resourceId, source, artifact, hash: hash(text), scope: resource.scope },
      { runId: this.runId },
    );
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
  private async recordRule(path: string, text: string, scope: string) {
    const digest = hash(text);
    if (this.rules.get(path) === digest) return false;
    this.rules.set(path, digest);
    const source = `rule:${path}`;
    this.setInstruction(
      source,
      `[Rule scope: ${scope}; more specific scopes apply only to their target paths]\n${text}`,
      "rules", scope,
    );
    await this.journal.append(
      "rule.loaded",
      {
        source,
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
    let changed = false;
    for (const r of this.activation.resources.filter(
      (r) => r.kind === "rule" && r.scope === "user" && r.status === "enabled" && !r.ruleBinding,
    )) {
      if (await exists(r.path))
        changed =
          (await this.recordRule(
            r.path,
            await boundedRead(await safePath(r.root, r.path)),
            "user",
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
      for (const resource of this.activation.resources.filter(r => r.kind === "rule" && r.status === "enabled" && r.ruleBinding)) {
        const binding = resource.ruleBinding!;
        if (binding.workspace !== root) continue;
        const boundRoot = await safePath(root, binding.root);
        const local = relative(boundRoot, resolved).split("\\").join("/");
        if (inside(boundRoot, resolved) && binding.include.some(pattern => matchesGlob(local, pattern))) {
          changed = (await this.recordRule(resource.source, resource.text, `${binding.root} [${binding.include.join(", ")}]; package ${resource.packageId}`)) || changed;
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
              r.kind === "rule" && r.path === path && r.status !== "enabled",
          )
        )
          continue;
        if (await exists(path))
          changed =
            (await this.recordRule(
              path,
              await boundedRead(path),
              relative(root, current) || ".",
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
            await this.host.lifecycle.record(resource,'updated',{sessionId:basename(this.journal.directory),runId:this.runId});
            this.fileVersions.set(resource.id,resource.hash);
          }
        }
      }
    }
    for (const ext of this.activation.extensions)
      for (const handler of ext.hooks.get(event) ?? []) {
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
      for (const ext of this.activation.extensions) for (const panel of ext.panels.filter(p => p.renderer === value.tool && ["sidebar","result"].includes(p.slot))) {
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
    const links = {
      ...this.evidenceLinks,
      runId: this.runId,
      resourceId,
      resourceRevision: this.activation.revision,
      toolCallId: outerCall,
    };
    const stateEvents = () =>
      this.journal.events.filter(
        (e) => e.type === "extension.state" && e.resourceId === resourceId,
      );
    return {
      workspace: this.host.catalog.workspace,
      runId: this.runId,
      reloadReceiptId: this.host.reserveReloadId(),
      recordRpc: async (type, payload, rpcLinks) => { await this.journal.append(type, payload, { ...links, ...rpcLinks }); },
      signal: this.signal,
      resourceId,
      callTool: async (name, args) => {
        this.budget();
        const tool = this.definitions.find((d) => d.tool.name === name)?.tool;
        if (!tool) throw new Error("Unknown or disabled tool");
        const reason =
          (await this.checkRules(name, args)) ??
          (await this.hook("beforeTool", { tool: name, args }));
        if (reason) throw new Error(reason);
        const callId = id();
        await this.journal.append(
          "tool.requested",
          { name, args, source: resourceId },
          { ...links, toolCallId: callId },
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
            { ...links, toolCallId: callId },
          );
          await this.hook("afterTool", { tool: name, args, result });
          return result;
        } catch (e) {
          await this.journal.append(
            "tool.failed",
            { name, error: String(e), source: resourceId },
            { ...links, toolCallId: callId },
          );
          throw e;
        }
      },
      model: async (prompt) => {
        this.budget();
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
            throw new Error(
              "State schema incompatible; explicit migration required",
            );
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
            throw new Error("State schema incompatible");
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
      },
      followUp: (prompt) => {
        this.budget();
        if (typeof prompt !== "string" || prompt.length > 32000)
          throw new Error("Invalid follow-up");
        this.followups.push(prompt);
      },
      reload: () => this.host.requestReload(),
      ui: async (value) => {
        this.budget();
        validateContribution(value);
        let panelEvidence = {};
        if (value.kind === 'panel') {
          const panel = ext.panels.find(p => p.id === value.panelId);
          if (!panel || !Value.Check(panel.propsSchema, value.props ?? {})) throw new Error('Panel contribution schema/identity invalid');
          panelEvidence = {resourceId, resourceRevision: ext.resource.hash, bundleHash: panel.bundleHash, slot: panel.slot, themes: panel.themes, fallback: panel.fallback, propsArtifact: await this.journal.artifact(JSON.stringify(value.props ?? {}))};
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
  }
  async command(input: string): Promise<{ handled: boolean; text: string }> {
    if (input.trimEnd() === "/reload")
      return { handled: true, text: JSON.stringify(this.host.requestReload()) };
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
    const { candidates, workflows } = matchCommands(this.activation, command[1]!);
    if (workflows.length && candidates.length || workflows.length > 1) throw new Error("Command and workflow ambiguous; use /extension:command");
    if (workflows.length === 1) {
      if (this.trial || this.evidenceLinks.workflowId) throw new Error("Workflow starts require an explicit real run, without recursive step invocation");
      const workflow = workflows[0]!; this.host.workflows.configure(this.options);
      const created = await this.host.workflows.create(workflow.resource.id, workflow.id, command[2] ? JSON.parse(command[2]) : {}, this.activation);
      await this.journal.append("workflow.reference", { workflowId: created.id, definitionId: created.definitionId, definitionRevision: created.definitionRevision }, { runId: this.runId, workflowId: created.id });
      const result = await this.host.workflows.advance(created.id, { activation: this.activation, signal: this.signal });
      return { handled: true, text: `Workflow ${result.id}: ${result.status}. Inspect its independent journal for authoritative results.` };
    }
    if (candidates.length !== 1)
      throw new Error("Command missing or ambiguous; use /extension:command");
    const { ext, cmd } = candidates[0]!;
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
