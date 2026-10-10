import { realpath } from "node:fs/promises";
import { Journal, hash, readArtifact, readSession, type Artifact, type JournalEvent, type JournalOptions } from "../journal.js";
import { ApiError, validId, type HandoffPreview, type HandoffReceipt, type SessionBinding } from "../shared/protocol.js";
import { sessionBinding } from "./identity.js";
import { handoffRevision } from "./handoff.js";

export type HandoffStage = "intent" | "target" | "received" | "committed";
export interface HandoffIntent {
  version: 1; handoffId: string; commandId: string; requestHash: string; payloadHash: string;
  sourceSessionId: string; targetSessionId: string; snapshot: Artifact;
}
/** Object ordering is not part of a command's semantic identity. */
export function handoffRequestHash(value: unknown): string {
  const stable = (item: any): any => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])])) : item;
  return hash(JSON.stringify(stable(value)));
}
export function handoffIntent(events: readonly JournalEvent[], commandId: string) {
  const matches = events.filter(event => event.type === "handoff.intent" && (event.payload as HandoffIntent).commandId === commandId);
  if (matches.length > 1) throw new ApiError(422, "handoff_identity", "交接意图重复，不能自动修复");
  return matches[0];
}
export async function readHandoffPayload(directory: string, intent: JournalEvent): Promise<HandoffPreview> {
  const value = intent.payload as HandoffIntent;
  const preview = JSON.parse((await readArtifact(directory, value.snapshot)).toString()) as HandoffPreview;
  const { payloadHash, ...payload } = preview;
  if (value.version !== 1 || payloadHash !== value.payloadHash || hash(JSON.stringify(payload)) !== payloadHash ||
      value.handoffId !== hash(JSON.stringify([value.sourceSessionId, value.commandId])) ||
      preview.source.sessionId !== value.sourceSessionId || preview.target.sessionId !== value.targetSessionId ||
      preview.grantsPermissions !== false || preview.createsTask !== false)
    throw new ApiError(422, "handoff_identity", "交接快照、身份或内容 hash 不一致");
  if (preview.delivery !== undefined && (preview.source.mode !== "create" || preview.target.mode !== "work" || !Array.isArray(preview.delivery) || !preview.delivery.length || preview.delivery.length > 8 ||
      preview.delivery.some(item => item.version !== 1 || item.grantsPermissions !== false || item.executesCommand !== false ||
        item.developmentTargetId !== preview.source.targetId || item.workTargetId !== preview.target.target.id || !["project", "user"].includes(item.scope))))
    throw new ApiError(422, "delivery_identity", "交付事实身份或权限边界无效");
  return preview;
}
export async function validateDeliveryReferences(directory: string, events: readonly JournalEvent[], binding: SessionBinding, handoffIds: readonly string[]) {
  if (handoffIds.length && binding.mode !== "work") throw new ApiError(403, "delivery_scope", "工作消费引用需要工作会话");
  for (const handoffId of handoffIds) {
    const received = events.find(event => event.type === "handoff.received" && event.handoffId === handoffId);
    if (!received) throw new ApiError(404, "delivery_reference", "该工作会话没有接收所选交付");
    const payload = await readHandoffPayload(directory, received);
    if (!payload.delivery?.length || JSON.stringify(payload.target) !== JSON.stringify(binding)) throw new ApiError(403, "delivery_scope", "交付引用不属于该工作目标");
  }
}
export function recordedHandoffReceipt(intent: JournalEvent, committed: JournalEvent): HandoffReceipt {
  const value = intent.payload as HandoffIntent, result = committed.payload as Omit<HandoffReceipt, "committedEventId">;
  if (result.version !== 1 || result.status !== "committed" || result.createsTask !== false || result.grantsPermissions !== false ||
      result.handoffId !== value.handoffId || result.payloadHash !== value.payloadHash || result.commandId !== value.commandId ||
      result.sourceSessionId !== value.sourceSessionId || result.targetSessionId !== value.targetSessionId || result.intentEventId !== intent.eventId)
    throw new ApiError(422, "handoff_identity", "交接收据与原意图不一致");
  return { ...result, committedEventId: committed.eventId };
}
/** Only durable metadata is reconciled. Never acquires resources, starts a scheduler or submits a task. */
export async function transferHandoff(options: {
  sourceDirectory: string; sourceSessionId: string; ownerWorkspace: string; commandId: string;
  payloadHash?: string; requestHash?: string; preview?: HandoffPreview; secrets?: string[]; journalOptions?: JournalOptions;
  ensureTarget: (preview: HandoffPreview) => Promise<{ directory: string; binding: SessionBinding }>;
  fault?: (stage: HandoffStage) => void | Promise<void>;
  validatePreview?: (preview: HandoffPreview) => Promise<void>;
}): Promise<HandoffReceipt> {
  if (!validId(options.commandId)) throw new ApiError(400, "handoff_command", "交接命令无效");
  const directory = await realpath(options.sourceDirectory), observed = await readSession(directory), original = sessionBinding(observed.events);
  if (!original || original.sessionId !== options.sourceSessionId || original.ownerWorkspace !== options.ownerWorkspace)
    throw new ApiError(403, "handoff_scope", "交接源身份不属于当前授权项目");
  const accepted = handoffIntent(observed.events, options.commandId);
  if (accepted) {
    const metadata = accepted.payload as HandoffIntent;
    if ((options.requestHash && options.requestHash !== metadata.requestHash) || (options.payloadHash && options.payloadHash !== metadata.payloadHash))
      throw new ApiError(409, "command_conflict", "同一交接命令内容不同");
    const completed = observed.events.filter(event => event.type === "handoff.committed" && (event.payload as HandoffReceipt).handoffId === metadata.handoffId);
    if (completed.length > 1) throw new ApiError(422, "handoff_identity", "交接确认重复");
    if (completed[0]) { await readHandoffPayload(directory, accepted); return recordedHandoffReceipt(accepted, completed[0]); }
  }
  const source = await Journal.open(directory, { ...options.journalOptions, secrets: options.secrets, sessionId: options.sourceSessionId });
  try {
    const binding = sessionBinding(source.events);
    if (!binding || binding.sessionId !== options.sourceSessionId || binding.ownerWorkspace !== options.ownerWorkspace)
      throw new ApiError(403, "handoff_scope", "交接源身份不属于当前授权项目");
    let intent = handoffIntent(source.events, options.commandId);
    let preview: HandoffPreview;
    if (intent) {
      const prior = intent.payload as HandoffIntent;
      if ((options.requestHash && options.requestHash !== prior.requestHash) || (options.payloadHash && options.payloadHash !== prior.payloadHash))
        throw new ApiError(409, "command_conflict", "同一交接命令内容不同");
      preview = await readHandoffPayload(source.directory, intent);
      const committed = source.events.filter(event => event.type === "handoff.committed" && (event.payload as HandoffReceipt).handoffId === prior.handoffId);
      if (committed.length > 1) throw new ApiError(422, "handoff_identity", "交接确认重复");
      if (committed[0]) return recordedHandoffReceipt(intent, committed[0]);
    } else {
      if (!options.preview || !options.requestHash || options.payloadHash !== options.preview.payloadHash)
        throw new ApiError(404, "handoff_missing", "没有已接受的交接意图；请先预览并明确确认");
      preview = options.preview;
      const { payloadHash, ...payload } = preview;
      if (hash(JSON.stringify(payload)) !== payloadHash || preview.source.sessionId !== binding.sessionId ||
          preview.source.targetId !== binding.target.id || preview.source.mode !== binding.mode ||
          preview.target.ownerWorkspace !== binding.ownerWorkspace || preview.target.mode === binding.mode ||
          preview.target.sessionId === binding.sessionId || preview.grantsPermissions !== false || preview.createsTask !== false)
        throw new ApiError(422, "handoff_identity", "交接预览身份或 hash 无效");
      if (JSON.stringify(handoffRevision(source.events)) !== JSON.stringify(preview.source.revision))
        throw new ApiError(409, "handoff_changed", "源版本已变化，请重新预览");
      await options.validatePreview?.(preview);
      const handoffId = hash(JSON.stringify([binding.sessionId, options.commandId]));
      const serialized = JSON.stringify(preview);
      if (source.clean(serialized) !== serialized) throw new ApiError(422, "handoff_credentials", "交接身份或输入仍含凭证，确认已阻止");
      intent = await source.append("handoff.intent", { version: 1, handoffId, commandId: options.commandId,
        requestHash: options.requestHash, payloadHash, sourceSessionId: binding.sessionId, targetSessionId: preview.target.sessionId,
        snapshot: await source.artifact(serialized) } satisfies HandoffIntent, { handoffId, mode: binding.mode, targetId: binding.target.id });
      await options.fault?.("intent");
    }
    const value = intent.payload as HandoffIntent;
    await options.validatePreview?.(preview);
    const target = await options.ensureTarget(preview);
    if (JSON.stringify(target.binding) !== JSON.stringify(preview.target)) throw new ApiError(409, "handoff_target", "目标创建身份已变化，不能接受原交接");
    await options.fault?.("target");
    const destination = await Journal.open(await realpath(target.directory), { ...options.journalOptions, secrets: options.secrets, sessionId: preview.target.sessionId });
    let received: JournalEvent;
    try {
      if (JSON.stringify(sessionBinding(destination.events)) !== JSON.stringify(preview.target))
        throw new ApiError(409, "handoff_target", "目标 Journal 身份与交接不一致");
      const prior = destination.events.filter(event => event.type === "handoff.received" && (event.payload as HandoffIntent).handoffId === value.handoffId);
      if (prior.length > 1) throw new ApiError(422, "handoff_identity", "目标接收记录重复");
      if (prior[0]) {
        const metadata = prior[0].payload as HandoffIntent;
        if (metadata.commandId !== value.commandId || metadata.payloadHash !== value.payloadHash || metadata.requestHash !== value.requestHash ||
            metadata.sourceSessionId !== value.sourceSessionId || metadata.targetSessionId !== value.targetSessionId)
          throw new ApiError(409, "command_conflict", "目标已接受不同内容的交接");
        await readHandoffPayload(destination.directory, prior[0]);
        received = prior[0];
      } else {
        const serialized = JSON.stringify(preview);
        if (destination.clean(serialized) !== serialized) throw new ApiError(422, "handoff_credentials", "目标交接输入含凭证，接收已阻止");
        received = await destination.append("handoff.received", { ...value, snapshot: await destination.artifact(serialized),
          sourceRevision: preview.source.revision, sourceIntentEventId: intent.eventId, createsTask: false, grantsPermissions: false },
          { handoffId: value.handoffId, mode: preview.target.mode, targetId: preview.target.target.id });
      }
      await options.fault?.("received");
    } finally { await destination.close(); }
    const committed = await source.append("handoff.committed", { version: 1, handoffId: value.handoffId, commandId: value.commandId,
      sourceSessionId: value.sourceSessionId, targetSessionId: value.targetSessionId, sourceRevision: preview.source.revision,
      payloadHash: value.payloadHash, intentEventId: intent.eventId, receivedEventId: received.eventId,
      status: "committed", createsTask: false, grantsPermissions: false } satisfies Omit<HandoffReceipt, "committedEventId">,
      { handoffId: value.handoffId, mode: binding.mode, targetId: binding.target.id });
    await options.fault?.("committed");
    return recordedHandoffReceipt(intent, committed);
  } finally { await source.close(); }
}
