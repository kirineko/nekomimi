import { hash, type JournalEvent } from './journal.js';
import { canonicalContext, contextMeasurementIdentity } from './context-meta.js';
import { sessionBinding } from './session/identity.js';
import type { contextView } from './context.js';
import type { ContextModel } from './context-meter.js';

/** Identity of the source projection, independent of navigation and auxiliary attempts. */
export function compactionSource(events: JournalEvent[], view: ReturnType<typeof contextView>, model: ContextModel, protocol: string) {
  const binding = sessionBinding(events), identity = contextMeasurementIdentity(view, events);
  const source = canonicalContext({ version: 1, sessionId: events[0]?.sessionId ?? null, contextRevision: view.revision,
    mode: binding?.mode ?? identity.mode, target: binding?.target ?? null, model: { ...model, protocol },
    capabilityRevision: identity.capabilityRevision });
  return { ...source, hash: hash(JSON.stringify(source)) };
}

/** Preserve unresolved facts as data even if the model omits them from its prose. */
export function compactionJournalFacts(events: JournalEvent[]) {
  const unknown = new Map<string, JournalEvent>(), waiting = new Map<string, JournalEvent>(), handoffs = new Map<string, JournalEvent>();
  for (const event of events) {
    const payload = event.payload as Record<string, any>;
    if (event.toolCallId && event.type === 'tool.intent') unknown.set(event.toolCallId, event);
    if (event.toolCallId && ['tool.completed','tool.result','tool.failed'].includes(event.type)) unknown.delete(event.toolCallId);
    if (event.type === 'recovery.tool_unknown') unknown.set(event.toolCallId ?? String(payload.item?.call_id ?? event.eventId), event);
    if (event.type === 'tool.execution_error' && payload.unknown) unknown.set(event.toolCallId ?? event.eventId, event);
    if (event.type === 'interaction.opened') waiting.set(String(payload.id), event);
    if (['interaction.answered','interaction.cancelled'].includes(event.type)) waiting.delete(String(payload.id));
    if (['handoff.intent','handoff.received','handoff.committed'].includes(event.type)) handoffs.set(String(payload.handoffId), event);
  }
  const reference = (event: JournalEvent) => ({ eventId: event.eventId, hash: event.hash, type: event.type });
  return {
    unknown: [...unknown.values()].map(event => ({ ...reference(event), toolCallId: event.toolCallId,
      name:(event.payload as any).name,callId:(event.payload as any).item?.call_id,
      state: 'UNKNOWN', repeatsAuthorized: false })),
    pendingAuthorization: [...waiting.values()].map(event => ({ ...reference(event), data: event.payload })),
    handoffs: [...handoffs.values()].map(event => { const payload=event.payload as any; return { ...reference(event),
      handoffId: payload.handoffId, sourceSessionId: payload.sourceSessionId ?? payload.source?.sessionId,
      targetSessionId: payload.targetSessionId ?? payload.target?.sessionId, payloadHash: payload.payloadHash,
      phase: event.type, grantsPermissions: false }; }),
  };
}
