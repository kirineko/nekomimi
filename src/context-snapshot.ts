import { contextView, type assemblePrompt } from "./context.js";
import { hash, type Journal, type JournalEvent, type Links, type Artifact } from "./journal.js";
import { sessionBinding } from "./session/identity.js";
import type { SessionMode, SessionTarget } from "./shared/protocol.js";
import { canonicalContext, effectiveCapabilityRevision } from "./context-meta.js";
export { canonicalContext } from "./context-meta.js";
import { resourceContextStates } from "./resource-context.js";
import { requiredInstructionBudget } from "./context-policy.js";
import { measureContext } from "./context-meter.js";
import type { HandoffContextSelection } from "./session/handoff-context.js";

export interface ContextModelIdentity {
  provider: string; id: string; protocol: string; contextWindow: number; maxTokens: number;
  providerRevision?: string; historyCompatibility?: string;
  resourceId?: string;
  contextIdentity?: string;
  baseUrl?: string; profileId?: string; profileRevision?: number;
}
export interface ContextSelection {
  id: string; source: string; hash: string; role: string; layer: string; scope?: string;
  decision: "include" | "exclude"; reason: string; version?: string;
  eventId?: string; itemIndex?: number; sourceHash?: string;
  sources?: string[]; transformations?: string[];
  projection?: { eventId: string; full: Artifact; projected: Artifact; version: number };
}
export interface RequestContextSnapshot {
  version: 1; revision: string; contextRevision: string; purpose: string;
  mode: SessionMode | "unbound"; target: (Partial<SessionTarget> & { id: string }) | null;
  model: ContextModelIdentity; capabilityRevision: string; activationRevision: string | null;
  sourceCursor: { seq: number; hash: string };
  selection: ContextSelection[];
  resources: ReturnType<typeof resourceContextStates>;
  requiredBudget: ReturnType<typeof requiredInstructionBudget>;
  measurement: ReturnType<typeof measureContext>;
  handoffs: HandoffContextSelection[];
  view: ReturnType<typeof contextView>;
}
export interface PreparedRequestContext {
  snapshot: RequestContextSnapshot;
  reference: { eventId: string; revision: string; artifact: Artifact };
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
const nodeKey = (node: { eventId: string; itemIndex: number }) => `${node.eventId}:${node.itemIndex}`;
function nodeRole(item: Record<string, unknown>) {
  return typeof item.role === "string" ? item.role : item.type === "function_call_output" ? "tool" : "assistant";
}

/** Selection operates on captured Journal facts, never on framework conversation history. */
export function captureRequestContext(options: {
  events: readonly JournalEvent[]; contextEvents?: readonly JournalEvent[];
  prompt: ReturnType<typeof assemblePrompt>; model: ContextModelIdentity;
  purpose?: string; runId?: string; mode?: SessionMode; targetId?: string; sourceCursor?: { seq: number; hash: string };
}): RequestContextSnapshot {
  // Journal identities and item hashes describe their original JSON bytes.
  // Canonicalize the revision envelope, never the authority before validating it.
  const events = structuredClone([...options.events]), prompt = structuredClone(options.prompt), model = structuredClone(options.model);
  const binding = sessionBinding(events);
  const selectedEvents = options.contextEvents ? structuredClone([...options.contextEvents]) : events;
  const view = contextView(selectedEvents, prompt);
  const effective = events.findLast(event => event.type === "capabilities.effective" && (!options.runId || event.runId === options.runId))?.payload as { capabilityRevision?: string; tools?: string[]; excludedTools?: string[]; toolExclusions?: Array<{ name: string; reason: string }> } | undefined;
  const scope = binding?.target.root;
  const selection: ContextSelection[] = [
    { id: "snapshot:model", source: `${model.provider}:${model.id}`, hash: hash(JSON.stringify(canonicalContext(model))),
      role: "model-selection", layer: "model", scope, decision: "include", reason: "selected-model" },
    ...prompt.fragments.map((fragment, index) => ({ id: `instruction:${index}`, source: fragment.source, hash: fragment.hash,
      role: "instruction", layer: fragment.section ?? "instructions", scope: fragment.scope ?? scope, decision: "include" as const,
      reason: "effective-instruction", version: fragment.version, sources: fragment.sources, transformations: ["host-framing"] })),
    ...prompt.schemas.map((schema, index) => ({ id: `schema:${index}`, source: schema.name, hash: hash(JSON.stringify(canonicalContext(schema))),
      role: "tool-schema", layer: "tools", scope, decision: "include" as const, reason: "declared-tool" })),
  ];
  const declared = new Set(prompt.schemas.map(schema => schema.name));
  for (const item of prompt.excludedInstructions ?? []) selection.push({ id: `excluded-instruction:${hash(JSON.stringify(canonicalContext(item)))}`, source: item.source,
    hash: item.hash, role: "instruction", layer: item.section, scope: item.scope ?? scope, version: item.version,
    decision: "exclude", reason: item.reason });
  for (const name of [...new Set(effective?.tools ?? [])].sort()) if (!declared.has(name))
    selection.push({ id: `excluded-tool:${name}`, source: name, hash: hash(name), role: "tool-identity", layer: "tools", scope,
      decision: "exclude", reason: ["work", "create"].includes(prompt.profile.id) ? "caller-tool-filter" : "auxiliary-profile-isolation" });
  for (const name of [...new Set(effective?.excludedTools ?? [])].sort())
    selection.push({ id: `mode-excluded-tool:${name}`, source: name, hash: hash(name), role: "tool-identity", layer: "tools", scope, decision: "exclude", reason: "mode-filter" });
  for (const item of effective?.toolExclusions ?? []) if (!declared.has(item.name)) selection.push({ id: `revoked-tool:${item.name}`, source: item.name,
    hash: hash(item.name), role: "tool-identity", layer: "tools", scope, decision: "exclude", reason: `resource-${item.reason}` });
  const withdrawn = new Map(events.filter(event => event.type === "instruction.withdrawn" && (!options.runId || event.runId === options.runId)).map(event => [(event.payload as { source: string }).source, event]));
  for (const [source, event] of withdrawn) if (!prompt.fragments.some(fragment => fragment.source === source)) {
    const item = event.payload as { hash: string; sourceHash?: string; section?: string; scope?: string; version?: string; reason: string };
    selection.push({ id: `withdrawn-instruction:${event.eventId}`, source, hash: item.hash, sourceHash: item.sourceHash, role: "instruction",
      layer: item.section ?? "instructions", scope: item.scope, version: item.version, eventId: event.eventId, decision: "exclude", reason: `resource-${item.reason}` });
  }
  const original = contextView(events, prompt, true).nodes;
  const originalByKey = new Map(original.map(node => [nodeKey(node), node]));
  const selected = new Set(view.nodes.map(nodeKey));
  for (const [index, node] of view.nodes.entries()) {
    const prior = originalByKey.get(nodeKey(node));
    const nodeEvent = events.find(event => event.eventId === node.eventId);
    const projected = node.item.type === "function_call_output" && nodeEvent?.toolCallId
      ? events.findLast(event => event.type === "tool.projection" && event.toolCallId === nodeEvent.toolCallId) : undefined;
    const projection = projected && projected.payload as { full: Artifact; projected: Artifact; version: number };
    selection.push({ id: `history:${index}`, source: node.source, hash: node.hash, role: nodeRole(node.item),
      layer: node.source === "runtime:environment:v1" ? "environment" : "history", scope, eventId: node.eventId, itemIndex: node.itemIndex,
      decision: "include", reason: node.source === "compaction:summary" ? "accepted-compaction-checkpoint" : "selected-history",
      ...(prior && prior.hash !== node.hash ? { sourceHash: prior.hash } : {}),
      ...(projection ? { projection: { eventId: projected.eventId, full: projection.full, projected: projection.projected, version: projection.version }, sources: [`artifact:${projection.full.sha256}`, `artifact:${projection.projected.sha256}`] } : {}),
      ...((projection || prior && prior.hash !== node.hash) ? { transformations: [...(prior && prior.hash !== node.hash ? ["selected-data-framing"] : []), ...(projection ? ["bounded-tool-result"] : [])] } : {}) });
  }
  for (const node of original) if (!selected.has(nodeKey(node))) selection.push({ id: `excluded-history:${nodeKey(node)}`, source: node.source,
    hash: node.hash, role: nodeRole(node.item), layer: "history", scope, eventId: node.eventId, itemIndex: node.itemIndex,
    decision: "exclude", reason: options.contextEvents ? "explicit-context-selection" : "replaced-by-compaction-checkpoint" });
  const sourceCursor = options.sourceCursor ?? { seq: events.at(-1)?.seq ?? 0, hash: events.at(-1)?.hash ?? "" };
  const handoffs=[...new Map(events.filter(event=>event.type==='handoff.selection').map(event=>[(event.payload as HandoffContextSelection).handoffId,event.payload as HandoffContextSelection])).values()].map(handoff=>{
    const selectedNode=view.nodes.some(node=>node.source===`handoff:${handoff.handoffId}:v1`);
    const decision=selectedNode?'include' as const:'exclude' as const;
    const reason=selectedNode?handoff.reason:handoff.decision==='exclude'?handoff.reason:options.contextEvents?'explicit-context-selection':'represented-in-compaction-checkpoint';
    return {...handoff,decision,reason,references:handoff.references.map(reference=>({...reference,decision:selectedNode?reference.decision:'exclude' as const,reason:selectedNode?reference.reason:reason}))};
  });
  for(const handoff of handoffs){
    const selectedNode=view.nodes.some(node=>node.source===`handoff:${handoff.handoffId}:v1`);
    const decision=selectedNode?'include' as const:'exclude' as const;
    const reason=selectedNode?handoff.reason:handoff.decision==='exclude'?handoff.reason:options.contextEvents?'explicit-context-selection':'represented-in-compaction-checkpoint';
    selection.push({id:`handoff:${handoff.handoffId}`,source:`handoff:${handoff.handoffId}:v1`,hash:handoff.projectionHash??handoff.payloadHash,
      role:'historical-data',layer:'handoff',scope,eventId:handoff.receivedEventId,decision,reason,
      sources:[`artifact:${handoff.snapshot.sha256}`,`journal:${handoff.sourceSessionId}`],transformations:['confirmed-handoff-projection']});
    for(const reference of handoff.references)selection.push({id:reference.source,source:reference.source,hash:reference.projectedHash,
      sourceHash:reference.sourceHash,role:'quoted-reference',layer:'handoff',scope:reference.scope,eventId:reference.eventId,
      decision:selectedNode?reference.decision:'exclude',reason:selectedNode?reference.reason:reason,
      sources:[`artifact:${handoff.snapshot.sha256}`,`journal:${reference.sessionId}:${reference.eventId}`],transformations:['quoted-data-projection']});
    if(!handoff.sourceAvailable)selection.push({id:`handoff-source:${handoff.handoffId}`,source:`journal:${handoff.sourceSessionId}`,hash:handoff.payloadHash,
      role:'original-evidence',layer:'handoff',scope,decision:'exclude',reason:'source-session-evidence-unavailable'});
    for(const reference of handoff.references.filter(r=>!r.originalAvailable))selection.push({id:`unavailable:${reference.source}`,source:`journal:${reference.sessionId}:${reference.eventId}`,hash:reference.sourceHash,
      role:'original-evidence',layer:'handoff',scope:reference.scope,decision:'exclude',reason:'original-reference-evidence-unavailable'});
  }
  const content = { version: 1 as const, contextRevision: view.revision, purpose: options.purpose ?? prompt.profile.id,
    mode: binding?.mode ?? options.mode ?? "unbound" as const, target: binding?.target ?? (options.targetId ? { id: options.targetId } : null), model,
    activationRevision: effective?.capabilityRevision ?? null,
    capabilityRevision: effectiveCapabilityRevision(binding?.mode ?? options.mode ?? "unbound", effective?.capabilityRevision ?? null, prompt.schemas), selection, handoffs, view,
    resources: resourceContextStates(events, view, options.runId), requiredBudget: requiredInstructionBudget(prompt, model) };
  const measurement = measureContext(view, model, events, { mode: content.mode, targetId: content.target?.id, purpose: content.purpose, capabilityRevision: content.capabilityRevision });
  if (measurement.reservations?.availableInput !== undefined && measurement.totalTokens > measurement.reservations.availableInput)
    throw new Error(`上下文输入超过模型预算（估计 ${measurement.totalTokens} tokens，可用 ${measurement.reservations.availableInput}）；占用来源：${measurement.layers?.filter(layer => layer.tokens > 0).map(layer => `${layer.id}:${layer.tokens}`).join(', ')}。请选择可缩减资料、整理安全历史或切换模型。`);
  // Metadata-only Journal growth changes the cursor, not the selected request revision.
  const measured = { ...content, measurement };
  return immutable({ ...measured, sourceCursor: canonicalContext(sourceCursor), revision: hash(JSON.stringify(canonicalContext(measured))) });
}

export async function persistRequestContext(journal: Journal, links: Links, options: Omit<Parameters<typeof captureRequestContext>[0], "events" | "sourceCursor">): Promise<PreparedRequestContext> {
  journal.check();
  const snapshot = captureRequestContext({ mode: links.mode, targetId: links.targetId, ...options, events: journal.events.slice(0, journal.durableSeq),
    sourceCursor: { seq: journal.durableSeq, hash: journal.events.find(event => event.seq === journal.durableSeq)?.hash ?? "" } });
  const bytes = JSON.stringify(snapshot);
  if (journal.clean(bytes) !== bytes) throw new Error("Request context contains a configured credential; request not prepared");
  const artifact = await journal.artifact(bytes);
  const event = await journal.append("context.snapshot", { version: 1, revision: snapshot.revision, contextRevision: snapshot.contextRevision, purpose: snapshot.purpose,
    mode: snapshot.mode, targetId: snapshot.target?.id, model: snapshot.model, capabilityRevision: snapshot.capabilityRevision, artifact }, links);
  return immutable({ snapshot, reference: { eventId: event.eventId, revision: snapshot.revision, artifact } });
}
