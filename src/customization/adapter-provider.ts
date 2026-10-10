import { assertPhysicalRouting } from "../model-routing.js";
import { envelopeKey, estimateTokens } from '../context-meter.js';
import { contextMeasurementIdentity } from '../context-meta.js';
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { RecordedModelStream as StreamFn } from "../pi/model-stream.js";
import { RecordedCall, retryableModelStatus } from "../recorded-call.js";
import { Journal, id, type Links } from "../journal.js";
import { type assemblePrompt, type WireItem } from "../context.js";
import { canonicalContext, persistRequestContext, type PreparedRequestContext } from "../context-snapshot.js";
import { ResponsesProvider, type ProviderOptions } from "../provider.js";
import { ProviderProfiles } from "./provider-profiles.js";
import { ProviderRegistry, type RegisteredProvider } from "./provider-registry.js";
import type { ModelDefinition, ProviderOutput } from "./contracts.js";
import type { ProcessContext } from "./process.js";
import type { CustomizationHost, Activation } from "./host.js";
import { ResourceAccess } from "./resource-access.js";
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
export async function createProvider(host: CustomizationHost, activation: Activation, journal: Journal, links: Links, prompt: ReturnType<typeof assemblePrompt>, settings: ProviderOptions) {
  assertPhysicalRouting(settings.routing);
  const purpose = settings.purpose === "extension" ? "auxiliary" : settings.purpose ?? settings.mode ?? (prompt.profile.id==="create"?"create":"work");
  const explicit = settings.purpose === "extension" ? settings.auxiliaryProfile : settings.purpose === "session-title" ? settings.namingProfile : settings.providerProfile;
  const selected = await new ProviderProfiles(host.catalog.home).resolve(purpose, explicit);
  const history = settings.contextEvents ?? journal.events;
  const checkHistory = (protocol: string, compatibility: string) => {
    for (const event of history.filter(e => e.type === "context.add" && String((e.payload as any).source).startsWith("response:"))) {
      const p = event.payload as any;
      if ((p.protocol ?? "responses") !== protocol || (p.historyCompatibility ?? "deepseek-responses-v1") !== compatibility) throw new Error("Provider history incompatible; create an explicit history branch before switching protocol or compatibility group");
    }
  };
  if (!selected) {
    checkHistory("responses", "deepseek-responses-v1");
    return new ResponsesProvider(journal, links, prompt, {...settings,revalidateConfiguration:async()=>{
      await settings.revalidateConfiguration?.();
      if(await new ProviderProfiles(host.catalog.home).resolve(purpose,explicit))throw new Error("Provider selection changed during summary");
    }});
  }
  const sourceResource = activation.resources.find(resource => resource.id === selected.profile.resourceId);
  const sourceAccess = sourceResource ? await ResourceAccess.create(host.catalog, [sourceResource], !!links.workflowId) : undefined;
  const revalidateConfiguration = async () => {
    await settings.revalidateConfiguration?.();
    const profiles = new ProviderProfiles(host.catalog.home), current = (await profiles.list()).entries[selected.profile.id];
    if (JSON.stringify(current) !== JSON.stringify(selected.profile)) throw new Error("Provider endpoint authorization changed during run");
    const currentSelection = await profiles.resolve(purpose, explicit);
    if(currentSelection?.profile.id!==selected.profile.id)throw new Error("Provider selection changed during summary");
    if (selected.profile.credentialRef && (await profiles.credentials()).entries[selected.profile.credentialRef] !== selected.apiKey) throw new Error("Provider credential changed or revoked during run");
    if (sourceResource) await sourceAccess!.assert([sourceResource.id]);
    const resource = activation.resources.find(resource => resource.id === selected.profile.resourceId);
    if (resource) {
      const grant = await host.catalog.grant(resource);
      if (!grant?.enabled || !grant.trusted || resource.manifest?.requiredCapabilities?.some(capability => !grant.capabilities?.includes(capability))) throw new Error("Provider authorization revoked");
    }
  };
  const guardedSettings: ProviderOptions = { ...settings, revalidateConfiguration, beforeDispatch: async context => {
    await settings.beforeDispatch?.(context); await revalidateConfiguration();
  } };
  if (selected.profile.providerId === "deepseek") {
    if (selected.profile.resourceId !== "builtin:deepseek" || !selected.profile.paths.includes("/responses")) throw new Error("Invalid built-in Provider profile");
    checkHistory("responses", "deepseek-responses-v1"); journal.registerSecret(selected.apiKey ?? "");
    return new ResponsesProvider(journal, links, prompt, { ...guardedSettings, model: selected.profile.model, baseUrl: selected.profile.baseUrl, apiKey: selected.apiKey ?? "" });
  }
  const provider = new ProviderRegistry(activation.extensions.flatMap(e => e.providers)).custom.get(selected.profile.providerId);
  if (!provider || provider.resource.id !== selected.profile.resourceId) throw new Error("Provider profile registration unavailable or source identity changed");
  const model = provider.models.find(m => m.id === selected.profile.model && (m.operation??"chat")==="chat");
  if (!model) throw new Error("Provider model unavailable");
  if(model.credentialRequired && !selected.apiKey)throw new Error("Provider model credential is not configured");
  checkHistory(model.protocol, model.historyCompatibility);
  journal.registerSecret(selected.apiKey ?? "");
  return new AdapterProvider(host, journal, links, prompt, guardedSettings, provider, model, selected);
}
export class AdapterProvider {
  private readonly configurationIdentity: string;
  private preparedModels = new WeakMap<PreparedRequestContext, { model: ModelDefinition; transport: Model<"openai-responses"> & { contextIdentity: string } }>();
  readonly model: Model<"openai-responses"> & { contextIdentity: string };
  get protocol(){return this.definition.protocol;}
  lastOutcome = "completed";
  async validateConfiguration() {
    if(JSON.stringify(canonicalContext({definition:this.definition,providerRevision:this.provider.resource.hash}))!==this.configurationIdentity)throw new Error('Provider model snapshot changed during summary');
    await this.settings.revalidateConfiguration?.();
  }
  constructor(private host: CustomizationHost, private journal: Journal, private links: Links, private prompt: ReturnType<typeof assemblePrompt>, private settings: ProviderOptions, private provider: RegisteredProvider, private definition: ModelDefinition, private selected: NonNullable<Awaited<ReturnType<ProviderProfiles["resolve"]>>>) {
    this.configurationIdentity=JSON.stringify(canonicalContext({definition,providerRevision:provider.resource.hash}));
    this.model = { contextIdentity: `${provider.resource.hash}:${definition.protocol}:${definition.historyCompatibility}`, id: definition.id, name: definition.name, api: "openai-responses", provider: provider.id, baseUrl: selected.profile.baseUrl, reasoning: definition.capabilities.reasoning, input: definition.capabilities.images ? ["text", "image"] : ["text"], contextWindow: definition.contextWindow, maxTokens: Math.min(settings.maxOutputTokens ?? definition.maxOutputTokens, definition.maxOutputTokens), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  }
  wireCallId(value: string) { return value; }
  private context(signal: AbortSignal, links: Links): ProcessContext {
    const denied = async (): Promise<never> => { throw new Error("Provider parsers and serializers cannot call host effect services"); };
    return { workspace: this.host.catalog.workspace, resourceId: this.provider.resource.id, runId: links.runId ?? id(), reloadReceiptId: "unavailable", signal, callTool: denied, model: denied, state: { get: denied, set: denied }, ui: denied, contribute: denied, followUp: () => { throw new Error("Provider effects unavailable"); }, reload: () => { throw new Error("Provider effects unavailable"); }, recordRpc: async (type, payload, rpcLinks) => { await this.journal.append(type, payload, { ...rpcLinks, ...links }); } };
  }
  private message(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"], errorMessage?: string): AssistantMessage { return { role: "assistant", api: "openai-responses", provider: this.provider.id, model: this.definition.id, content, stopReason, errorMessage, usage: emptyUsage(), timestamp: Date.now() }; }
  private validateOutput(output: ProviderOutput): WireItem[] {
    if (!output || output.terminal !== "completed" || !Array.isArray(output.rawItems) || !Array.isArray(output.contextItems) || !Array.isArray(output.projection?.content) || output.contextItems.some(i => !i || typeof i !== "object" || Array.isArray(i))) throw new Error("Invalid or failed Provider output");
    const items = output.contextItems as WireItem[], calls = items.filter(i => i.type === "function_call");
    const native = output.rawItems as any[];
    const pointer = (root: unknown, path: string): any => {
      if (typeof path !== "string" || !path.startsWith("/") || path.length > 1024) throw new Error("Invalid native evidence pointer");
      return path.slice(1).split("/").reduce<any>((value, part) => {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("Missing native tool evidence");
        return value[key];
      }, root);
    };
    const nativeCalls = this.definition.protocol === "responses" ? native.filter(i => i?.type === "function_call").map(i => ({ id: i.call_id, name: i.name, arguments: i.arguments })) : this.definition.protocol === "chat-completions" ? native.flatMap(i => i?.tool_calls ?? []).map(i => ({ id: i.id, name: i.function?.name, arguments: i.function?.arguments })) : Object.values(output.toolEvidence ?? {}).map(e => {
      if (!Number.isInteger(e.itemIndex) || e.itemIndex < 0 || e.itemIndex >= native.length) throw new Error("Invalid native evidence item index");
      const args = pointer(native[e.itemIndex], e.argumentsPath);
      return { id: pointer(native[e.itemIndex], e.callIdPath), name: pointer(native[e.itemIndex], e.namePath), arguments: typeof args === "string" ? args : JSON.stringify(args) };
    });
    const seen = new Set<string>();
    for (const part of output.projection.content) {
      if (part.type === "text") { if (typeof part.text !== "string") throw new Error("Invalid Provider text projection"); continue; }
      if (part.type !== "toolCall" || !this.definition.capabilities.tools || typeof part.id !== "string" || !part.id || seen.has(part.id) || typeof part.name !== "string" || !part.arguments || typeof part.arguments !== "object" || Array.isArray(part.arguments)) throw new Error("Invalid Provider tool projection");
      seen.add(part.id);
      const projected = calls.find(i => i.call_id === part.id), original = nativeCalls.find(i => i.id === part.id);
      if (!projected || !original || projected.name !== part.name || original.name !== part.name || JSON.stringify(JSON.parse(String(projected.arguments))) !== JSON.stringify(part.arguments) || JSON.stringify(JSON.parse(String(original.arguments))) !== JSON.stringify(part.arguments)) throw new Error("Provider tool call lacks matching native evidence");
    }
    if (seen.size !== calls.length || seen.size !== nativeCalls.length) throw new Error("Provider omitted or duplicated tool calls");
    if (items.some(i => i.role === "system" || i.role === "developer" || i.role === "user" || i.type === "function_call_output")) throw new Error("Provider cannot fabricate privileged or user/tool history");
    return items;
  }
  async prepare(signal?: AbortSignal): Promise<PreparedRequestContext> {
    this.journal.check(); signal?.throwIfAborted();
    await this.settings.beforeRequest?.();
    const model = canonicalContext(this.definition), transport = canonicalContext(this.model);
    const prepared = await persistRequestContext(this.journal, this.journal.links(this.links), {
      prompt: this.prompt, contextEvents: this.settings.contextEvents, purpose: this.settings.purpose, runId: this.links.runId,
      model: { provider: this.provider.id, resourceId: this.provider.resource.id, id: model.id, protocol: model.protocol, contextWindow: model.contextWindow,
        baseUrl: transport.baseUrl, profileId: this.selected.profile.id, profileRevision: this.selected.revision,
        maxTokens: transport.maxTokens, contextIdentity: transport.contextIdentity, providerRevision: this.provider.resource.hash, historyCompatibility: model.historyCompatibility },
    });
    this.journal.check(); signal?.throwIfAborted();
    this.preparedModels.set(prepared, { model, transport }); return prepared;
  }
  readonly stream: StreamFn = (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const call = new RecordedCall(this.journal, this.links);
      try {
        const prepared = context.productContext ?? await this.prepare(options?.signal), pinned = this.preparedModels.get(prepared);
        if (!pinned) throw new Error("Request context was not prepared by this Provider or was already consumed");
        this.preparedModels.delete(prepared);
        const view = prepared.snapshot.view;
        const auxiliary = !["work", "create"].includes(prepared.snapshot.purpose);
        const history = view.nodes.map(n => n.item);
        if ((!pinned.model.capabilities.tools && view.prompt.schemas.length) || (!pinned.model.capabilities.images && /"(?:input_image|image_url)"\s*:/.test(JSON.stringify(history)))) throw new Error("Selected model does not support tools or images in this context");
        if (Buffer.byteLength(JSON.stringify({ history, instructions: view.prompt.text, tools: view.prompt.schemas })) > Math.min(32 * 1024 * 1024, pinned.model.contextWindow * 16)) throw new Error("Provider context byte budget exceeded");
        await this.journal.append("context.view", { revision: view.revision, artifact: await this.journal.artifact(JSON.stringify(view)), contextSnapshot: prepared.reference, provider: this.provider.id, providerRevision: this.provider.resource.hash, profile: this.selected.profile.id, profileRevision: this.selected.revision, protocol: pinned.model.protocol, historyCompatibility: pinned.model.historyCompatibility }, call.links);
        const attempts = this.settings.maxAttempts ?? 2;
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error("maxAttempts must be 1..10");
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const recorded = await call.attempt(this.settings, { purpose: prepared.snapshot.purpose, profile: view.prompt.profile, contextSnapshot: prepared.reference, protocol: pinned.model.protocol, provider: this.provider.id, providerRevision: this.provider.resource.hash, model: pinned.model.id, attempt }, options?.signal, view.revision);
          let parserStarted = false, finished = false;
          try {
            const ctx = this.context(recorded.signal, recorded.links);
            const envelope = JSON.stringify({ model: pinned.model, instructions: view.prompt.text, history, tools: view.prompt.schemas, maxOutputTokens: pinned.transport.maxTokens });
            if (this.journal.clean(envelope) !== envelope) throw new Error("Provider input contains a configured credential; request not serialized");
            recorded.projectContext(prepared, { kind: "provider", id: this.provider.id, revision: this.provider.resource.hash }, await this.journal.artifact(envelope));
            const serialized = await this.provider.serialize(JSON.parse(envelope), ctx);
            if (!serialized || !this.selected.profile.paths.includes(serialized.path)) throw new Error("Provider request path not authorized");
            const target = new URL(this.selected.profile.baseUrl.replace(/\/$/, "") + serialized.path);
            const current = (await new ProviderProfiles(this.host.catalog.home).list()).entries[this.selected.profile.id];
            if (JSON.stringify(current) !== JSON.stringify(this.selected.profile)) throw new Error("Provider endpoint authorization changed during run");
            if (this.selected.profile.credentialRef && (await new ProviderProfiles(this.host.catalog.home).credentials()).entries[this.selected.profile.credentialRef] !== this.selected.apiKey) throw new Error("Provider credential changed or revoked during run");
            const grant = await this.host.catalog.grant(this.provider.resource);
            if (!grant?.enabled || !grant.trusted) throw new Error("Provider authorization revoked");
            const response = await recorded.fetch(target, { method: "POST", redirect: "error", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(this.selected.apiKey ? { authorization: `Bearer ${this.selected.apiKey}` } : {}) }, body: JSON.stringify(serialized.body) });
            const reader = response.body?.getReader(); if (!reader) throw new Error("Provider response body missing");
            let terminal: ProviderOutput | null = null, sequence = 0; const decoder = new TextDecoder();
            const parse = async (chunk: string, final: boolean) => {
              parserStarted = true;
              if (++sequence > (this.settings.maxResponseEvents ?? 10000)) throw new Error("Provider parser event limit exceeded");
              const result = await this.provider.parse({ requestId: recorded.links.attemptId!, sequence, chunk, final }, ctx);
              if (result) { if (terminal) throw new Error("Duplicate Provider terminal result"); terminal = result; }
            };
            try {
              for (;;) { const chunk = await reader.read(); if (chunk.done) break; if (response.ok) for (let offset = 0; offset < chunk.value.length; offset += 65536) await parse(decoder.decode(chunk.value.subarray(offset, offset + 65536), { stream: true }), false); }
              if (response.ok) await parse(decoder.decode(), true);
            } finally { await reader.cancel().catch(() => {}); }
            recorded.signal.throwIfAborted();
            if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
            if (!terminal) throw new Error("Provider did not produce a terminal result");
            const completed = terminal as ProviderOutput, items = this.validateOutput(completed);
            const native = await this.journal.artifact(JSON.stringify(completed.rawItems));
            await recorded.finish({ status: "completed", response: native, usage: completed.usage, parserChunks: sequence });
            finished = true;
            recorded.signal.throwIfAborted();
            const inputUsage=(completed.usage as any)?.input_tokens ?? (completed.usage as any)?.inputTokens ?? (completed.usage as any)?.prompt_tokens;
            if(!auxiliary && Number.isSafeInteger(inputUsage) && inputUsage>0) await this.journal.append('context.usage',{key:envelopeKey(view,pinned.transport,contextMeasurementIdentity(view,[],prepared.snapshot)),purpose:prepared.snapshot.purpose,input:inputUsage,heuristic:estimateTokens(view.prompt.text)+estimateTokens(view.prompt.schemas)+estimateTokens(view.nodes.map(n=>n.item)),attemptId:recorded.links.attemptId},call.links);

            await this.journal.append(auxiliary ? "auxiliary.response" : "context.add", { items, source: `response:${recorded.links.attemptId}`, native, provider: this.provider.id, providerRevision: this.provider.resource.hash, protocol: this.definition.protocol, historyCompatibility: this.definition.historyCompatibility }, recorded.links);
            this.lastOutcome = "completed";
            const message = this.message(completed.projection.content, completed.projection.content.some(c => c.type === "toolCall") ? "toolUse" : "stop");
            stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(); return;
          } catch (error) {
            this.lastOutcome = options?.signal?.aborted ? "cancelled" : "failed";
            if (parserStarted || recorded.signal.aborted) {
              try { await this.provider.abort(); } catch { this.host.degraded = "Provider process cleanup could not be confirmed"; }
            }
            if (!finished) await recorded.finish({ status: this.lastOutcome, error: this.journal.clean(String(error)), parserStarted });
            const retry = attempt < attempts && !recorded.signal.aborted && !parserStarted && retryableModelStatus(recorded.status);
            if (!retry) throw error;
            await this.journal.append("attempt.retry", { nextAttempt: attempt + 1 }, recorded.links);
          }
        }
      } catch (error) {
        this.lastOutcome = options?.signal?.aborted ? "cancelled" : "failed";
        const message = this.message([], options?.signal?.aborted ? "aborted" : "error", this.journal.clean(String(error)));
        stream.push({ type: "error", reason: message.stopReason as "aborted" | "error", error: message }); stream.end();
      }
    })();
    return stream;
  };
}
