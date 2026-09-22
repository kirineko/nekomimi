import { mkdir, rename, rm, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { Journal, readSession, readArtifact, artifactRefs, id } from "../journal.js";
import { contextView, assemblePrompt, unpairedCalls } from "../context.js";
import { exists } from "./resources.js";
/** Explicit protocol-neutral projection. Source events and bytes are retained, never replayed. */
export async function branchHistory(source: string, destination: string, workspace: string, omitReasoning: boolean) {
  source = await realpath(source);
  if (await exists(destination)) throw new Error("Branch destination must be new");
  const session = await readSession(source), canonical = await realpath(workspace);
  if ((session.events[0]?.payload as any)?.workspace !== canonical) throw new Error("Branch requires the original workspace");
  if (unpairedCalls(session.events).length) throw new Error("Resolve incomplete tool history before branching; unknown results cannot be invented");
  const view = contextView(session.events, assemblePrompt([]));
  const reasoning = view.nodes.filter(n => n.item.type === "reasoning");
  if (reasoning.length && !omitReasoning) throw new Error("Explicit consent to omit protocol-specific reasoning from the new request is required; original evidence remains preserved");
  const nodes = view.nodes.filter(n => n.item.type !== "reasoning");
  const calls = new Set<string>();
  for (const { item } of nodes) {
    if (item.type === "function_call") { if (typeof item.call_id !== "string" || calls.has(item.call_id)) throw new Error("Ambiguous branch tool call IDs"); calls.add(item.call_id); }
    else if (item.type === "function_call_output") { if (!calls.has(String(item.call_id))) throw new Error("Unpaired branch tool result"); }
    else if (!["user", "assistant"].includes(String(item.role))) throw new Error("Unsupported history item requires an explicit conversion");
  }
  const raw = JSON.stringify(session.events);
  if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new Error("Branch source event limit");
  const refs = [...new Map(session.events.flatMap(e => artifactRefs(e.payload)).map(ref => [ref.sha256, ref])).values()];
  if (refs.reduce((n, ref) => n + ref.bytes, 0) > 128 * 1024 * 1024) throw new Error("Branch evidence byte limit");
  const staging = destination + ".branch-" + id(); await mkdir(dirname(destination), { recursive: true });
  try {
    const journal = await Journal.open(staging);
    try {
      await journal.append("session.created", { workspace: canonical, model: "explicit-branch", baseUrl: "" });
      for (const ref of refs) await journal.artifact(await readArtifact(source, ref));
      const artifact = await journal.artifact(raw);
      await journal.append("branch.created", { sourceSessionId: session.events[0]?.sessionId, sourceRevision: view.revision, sourceEvents: artifact, sourceArtifacts: refs, omittedReasoning: reasoning.length, conversion: "canonical-dialogue-v1", sideEffectsReplayed: false });
      await journal.append("session.title", { title: "跨 Provider 历史分支", source: "branch" });
      for (const node of nodes) await journal.append("context.add", { source: `branch:${node.eventId}:${node.itemIndex}`, item: node.item, originalEventId: node.eventId, sourceEvents: artifact, conversion: "canonical-dialogue-v1" });
    } finally { await journal.close(); }
    await rename(staging, destination);
    return { directory: await realpath(destination), sourceRevision: view.revision, omittedReasoning: reasoning.length };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
