import { Journal, hash, id, type JournalEvent } from "../journal.js";
import { assemblePrompt } from "../context.js";
import { promptData } from "../prompts.js";
import { ApiError, object, validId, type HandoffPreview, type SessionBinding, type DeliverySnapshot } from "../shared/protocol.js";
import { sessionBinding, createSessionBinding, creationHash, checkSessionTarget, parseSessionCreation } from "./identity.js";
import { createProvider } from "../customization/adapter-provider.js";
import type { CustomizationHost } from "../customization/host.js";
import type { ProviderOptions } from "../provider.js";

export interface HandoffObservation { directory: string; events: readonly JournalEvent[] }
export function cleanHandoff<T>(value: T, secrets: string[]): T {
  let raw = JSON.stringify(value);
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) raw = raw.split(secret).join("[REDACTED]");
  return JSON.parse(raw);
}
const text = (value: unknown, limit: number, required = false): string => {
  if (typeof value !== "string" || Buffer.byteLength(value) > limit || (required && !value.trim()))
    throw new ApiError(400, "handoff_input", "交接文本无效或超出大小限制");
  return value.trim();
};
export function handoffRevision(events: readonly JournalEvent[]) {
  const last = events.at(-1); if (!last) throw new ApiError(422, "session_identity", "交接源记录缺失");
  return { seq: last.seq, hash: last.hash };
}
/** Pure observation: no Journal writer, resource factories, model requests or session creation. */
export async function previewHandoff(options: {
  sourceSessionId: string; draft: unknown; ownerWorkspace: string; home?: string; secrets?: string[];
  observe: (sessionId: string) => Promise<HandoffObservation>;
  resolveDelivery?: (source: SessionBinding, target: SessionBinding, selections: unknown) => Promise<DeliverySnapshot[]>;
}): Promise<HandoffPreview> {
  const source = await options.observe(options.sourceSessionId), binding = sessionBinding(source.events);
  if (!binding || binding.sessionId !== options.sourceSessionId || binding.ownerWorkspace !== options.ownerWorkspace) throw new ApiError(403, "handoff_scope", "交接源不属于当前授权项目");
  await checkSessionTarget(binding, options.home);
  const draft = object(options.draft);
  if (draft.version !== 1) throw new ApiError(400, "handoff_input", "交接版本无效");
  const goal = text(draft.goal, 16384, true), summary = draft.summary === undefined ? "" : text(draft.summary, 32768);
  const constraints = draft.constraints === undefined ? [] : draft.constraints;
  if (!Array.isArray(constraints) || constraints.length > 16) throw new ApiError(400, "handoff_input", "交接约束无效");
  const target = object(draft.target); let destination: SessionBinding, creation: HandoffPreview["creation"];
  if (typeof target.sessionId === "string" && validId(target.sessionId) && target.creation === undefined) {
    const observed = await options.observe(target.sessionId), selected = sessionBinding(observed.events);
    if (!selected || selected.sessionId !== target.sessionId || selected.ownerWorkspace !== binding.ownerWorkspace) throw new ApiError(403, "handoff_scope", "交接目标不属于当前授权项目");
    destination = selected;
  } else if (target.sessionId === undefined && typeof target.title === "string") {
    const title = text(target.title, 400, true).slice(0, 100), input = parseSessionCreation(target.creation);
    const sessionId = hash(JSON.stringify([options.ownerWorkspace, input.commandId]));
    destination = await createSessionBinding(binding.ownerWorkspace, sessionId, input, creationHash(title, input), options.home);
    creation = { title, input };
  } else throw new ApiError(400, "handoff_target", "请选择目标会话或明确的新目标");
  if (destination.sessionId === binding.sessionId || destination.mode === binding.mode) throw new ApiError(400, "handoff_mode", "模式交接需要工作与创造两个独立会话");
  await checkSessionTarget(destination, options.home);
  const refs = draft.references ?? [];
  if (!Array.isArray(refs) || refs.length > 16) throw new ApiError(400, "handoff_reference", "交接引用无效");
  const references: HandoffPreview["references"] = [], seen = new Set<string>();
  for (const value of refs) {
    const ref = object(value);
    if (typeof ref.sessionId !== "string" || !validId(ref.sessionId) || typeof ref.eventId !== "string" || typeof ref.payloadHash !== "string")
      throw new ApiError(400, "handoff_reference", "交接引用身份无效");
    const observed = await options.observe(ref.sessionId), owner = sessionBinding(observed.events);
    if (!owner || owner.sessionId !== ref.sessionId || owner.ownerWorkspace !== binding.ownerWorkspace) throw new ApiError(403, "handoff_scope", "引用不属于目标可访问的项目");
    const event = observed.events.find(event => event.eventId === ref.eventId);
    if (!event || !["context.add", "tool.completed", "tool.failed", "recovery.tool_unknown", "compaction.completed", "handoff.received"].includes(event.type) || hash(JSON.stringify(event.payload)) !== ref.payloadHash)
      throw new ApiError(409, "handoff_reference", "引用缺失、类型不可交接或内容已变化");
    const key = `${ref.sessionId}:${ref.eventId}`;
    if (seen.has(key)) throw new ApiError(400, "handoff_reference", "交接引用重复");
    seen.add(key); references.push({ sessionId: ref.sessionId, eventId: event.eventId, payloadHash: ref.payloadHash, type: event.type, data: structuredClone(event.payload),
      origin:{mode:owner.mode,targetId:owner.target.id,scope:owner.target.scope,ownerWorkspace:owner.ownerWorkspace} });
  }
  if (draft.delivery !== undefined && !options.resolveDelivery) throw new ApiError(400, "delivery_unavailable", "该入口没有受控交付事实解析服务");
  const delivery = draft.delivery === undefined ? undefined : await options.resolveDelivery!(binding, destination, draft.delivery);
  const payload = cleanHandoff({ version: 1 as const, source: { sessionId: binding.sessionId, mode: binding.mode, targetId: binding.target.id, revision: handoffRevision(source.events) }, target: destination,
    ...(creation ? { creation } : {}), goal, constraints: constraints.map(value => text(value, 4096, true)), summary, references, ...(delivery ? { delivery } : {}),
    grantsPermissions: false as const, createsTask: false as const }, options.secrets ?? []);
  if (JSON.stringify(payload.target) !== JSON.stringify(destination) || (payload.creation && JSON.stringify(payload.creation) !== JSON.stringify(creation)))
    throw new ApiError(422, "handoff_identity", "目标身份不能包含凭证");
  for(const reference of payload.references)reference.dataHash=hash(JSON.stringify(reference.data));
  if (Buffer.byteLength(JSON.stringify(payload)) > 256 * 1024) throw new ApiError(413, "handoff_size", "交接选择过大，请减少引用");
  return { ...payload, payloadHash: hash(JSON.stringify(payload)) };
}

/** Separate recorded preparation; successful output still requires a new user confirmation. */
export async function prepareHandoffSummary(options: {
  directory: string; preview: HandoffPreview; commandId: string; host: CustomizationHost; settings: ProviderOptions;
  secrets: string[]; signal: AbortSignal; validate: () => Promise<void>;
}) {
  if (!validId(options.commandId)) throw new ApiError(400, "handoff_command", "摘要命令无效");
  const { preview, signal } = options; signal.throwIfAborted(); await options.validate();
  const runId = id(), links = { runId, mode: preview.source.mode, targetId: preview.source.targetId };
  const journal = await Journal.open(options.directory, { secrets: options.secrets }); let acquired = false;
  try {
    const started = journal.events.find(event => event.type === "handoff.summary.started");
    if (started) {
      if ((started.payload as any).payloadHash !== preview.payloadHash || (started.payload as any).commandId !== options.commandId)
        throw new ApiError(409, "command_conflict", "同一摘要命令内容不同");
      const completed = journal.events.find(event => event.type === "handoff.summary.completed");
      if (completed) return { preparationId: journal.sessionId, ...(completed.payload as { summary: string; payloadHash: string }), requiresConfirmation: true as const };
      throw new ApiError(409, "handoff_preparation", "摘要任务已开始且未完成，不能自动重跑；请查看原证据或使用新命令");
    }
    await journal.append("handoff.summary.started", { commandId: options.commandId, payloadHash: preview.payloadHash, input: await journal.artifact(JSON.stringify(preview)), source: preview.source, target: preview.target }, links);
    const activation = await options.host.acquire(); acquired = true; signal.throwIfAborted();
    const provider = await createProvider(options.host, activation, journal, links, assemblePrompt([], [], "handoff"), {
      ...options.settings, purpose: "handoff", maxAttempts: 1, maxOutputTokens: Math.min(options.settings.maxOutputTokens ?? 2048, 4096),
      beforeRequest: options.validate,
      contextEvents: [{ ...journal.events[0]!, type: "context.add", payload: { source: "handoff:selected-data", item: { role: "user", content: promptData({ goal: preview.goal, constraints: preview.constraints, selectedReferences: preview.references, existingSummary: preview.summary, destinationMode: preview.target.mode, delivery: preview.delivery }) } } }],
    });
    const result = await (await provider.stream(provider.model, { messages: [] }, { signal })).result();
    signal.throwIfAborted(); await options.validate();
    const summary = journal.clean(result.content.filter(item => item.type === "text").map(item => item.text).join(""));
    if (result.stopReason !== "stop" || result.content.some(item => item.type === "toolCall") || !summary.trim() || Buffer.byteLength(summary) > 32768)
      throw new ApiError(422, "handoff_summary", "摘要结果无效，未交接或执行任何工具");
    const artifact = await journal.artifact(summary);
    const committed = await journal.appendIf("handoff.summary.completed", { summary, payloadHash: preview.payloadHash, artifact, requiresConfirmation: true }, () => !signal.aborted, links);
    signal.throwIfAborted();
    if (!committed) throw new ApiError(409, "handoff_changed", "摘要结果未提交");
    return { preparationId: journal.sessionId, summary, payloadHash: preview.payloadHash, artifact, requiresConfirmation: true as const };
  } catch (error) {
    journal.check(); await journal.append(signal.aborted ? "handoff.summary.cancelled" : "handoff.summary.failed", { error: journal.clean(String(error)) }, links); throw error;
  } finally { try { await journal.close(); } finally { if (acquired) await options.host.release(); } }
}
