import type { JournalEvent } from "./journal.js";
import type { contextView } from "./context.js";
export interface ContextResource {
  id: string; kind: string; name: string; revision: string; scope: string; status: string; source: string;
  modeAllowed: boolean; description?: string; descriptionHash?: string; descriptionTruncated?: boolean;
  sourceHash?: string; sourceTruncated?: boolean;
  present?: boolean; accessReason?: string; currentRevision?: string;
}
export function resourceContextStates(events: readonly JournalEvent[], view: ReturnType<typeof contextView>, runId?: string) {
  const catalog = events.findLast(event => event.type === "resources.context" && (!runId || event.runId === runId))?.payload as { items?: ContextResource[] } | undefined;
  const subjects = new Map((catalog?.items ?? []).map(resource => [resource.id, resource]));
  const catalogIds = new Set(subjects.keys());
  const reads = events.filter(event => ["skill.loaded", "resource.read", "rule.loaded"].includes(event.type));
  for (const event of reads) {
    const value = event.payload as any;
    if (value.resourceId && !catalogIds.has(value.resourceId)) subjects.set(value.resourceId, {
      id: value.resourceId, kind: event.type === "skill.loaded" ? "skill" : event.type === "rule.loaded" ? "rule" : "resource",
      name: value.name ?? value.path ?? value.resourceId, revision: value.resourceRevision ?? value.hash, scope: value.scope ?? "unknown",
      status: "historical", source: value.source, modeAllowed: false,
    });
  }
  return [...subjects.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(resource => {
    const history = reads.filter(event => (event.payload as any).resourceId === resource.id);
    const injections = history.flatMap(event => {
      const value = event.payload as any;
      // Rules retain a stable source while their contents change. Only the
      // latest read for that source can explain the currently selected text.
      const latest = reads.findLast(candidate => (candidate.payload as any).source === value.source);
      const instructions = latest === event ? view.prompt.fragments.filter(fragment => fragment.source === value.source) : [];
      // A skill tool result is only a loading receipt; its body lives in the
      // current instruction fragment, never in that historical receipt.
      const results = event.type === "skill.loaded" ? [] : view.nodes.filter(node => event.toolCallId && node.item.type === "function_call_output"
        && events.find(candidate => candidate.eventId === node.eventId)?.toolCallId === event.toolCallId);
      const identity = { readEventId: event.eventId, resourceRevision: value.resourceRevision, contentHash: value.hash };
      return [...instructions.map(fragment => ({ ...identity, via: "instruction", hash: fragment.hash, source: fragment.source })),
        ...results.map(node => ({ ...identity, via: "tool-result", hash: node.hash, source: node.source, eventId: node.eventId }))];
    });
    const loadedNow = history.some(event => event.runId === runId && (event.payload as any).resourceRevision === resource.revision);
    const effective = resource.status === "enabled" && resource.modeAllowed || resource.status === "historical" && resource.kind === "rule" && loadedNow && injections.some(injection => injection.via === "instruction");
    return { ...resource, discoverable: resource.present !== false && resource.status !== "historical" && resource.modeAllowed, read: history.length > 0,
      effective,
      injected: injections.length > 0, injections,
      historical: history.some(event => event.runId !== runId || (event.payload as any).resourceRevision !== resource.revision || !effective
        || resource.currentRevision !== undefined && resource.currentRevision !== resource.revision),
      reads: history.map(event => ({ eventId: event.eventId, runId: event.runId, hash: (event.payload as any).hash,
        revision: (event.payload as any).resourceRevision, scope: (event.payload as any).scope, artifact: (event.payload as any).artifact })) };
  });
}
