import { ApiError } from "../shared/protocol.js";
import { mkdir, rename, rm, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { Journal, readSession, readArtifact, artifactRefs, id } from "../journal.js";
import { contextView, assemblePrompt, unpairedCalls } from "../context.js";
import { exists } from "./resources.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { inspectJournalFormat, openJournalStorage } from "../pi/journal-storage.js";
import { checkSessionTarget, createSessionBinding, creationHash, sessionBinding } from "../session/identity.js";
import { readScriptState } from "../codemode-state.js";
/** Explicit protocol-neutral projection. Source events and bytes are retained, never replayed. */
export async function branchHistory(source: string, destination: string, workspace: string, omitReasoning: boolean, sessionId = id(), options: { home?: string; commandId?: string } = {}) {
  source = await realpath(source);
  await inspectJournalFormat(source);
  const session = await readSession(source), canonical = await realpath(workspace);
  const original = sessionBinding(session.events);
  if (!original || original.target.root !== canonical) throw new Error("Branch requires the original workspace and mode identity");
  await checkSessionTarget(original, options.home);
  if (await exists(destination)) {
    const previous = await readSession(destination), binding = sessionBinding(previous.events);
    const branch = previous.events.find(event => event.type === 'branch.created')?.payload as { sourceSessionId?: string; omitReasoning?: boolean; sourceRevision: string; omittedReasoning: number } | undefined;
    if (!options.commandId || binding?.creation.commandId !== options.commandId || binding.sessionId !== sessionId || JSON.stringify(binding.target) !== JSON.stringify(original.target) || branch?.sourceSessionId !== original.sessionId || branch.omitReasoning !== omitReasoning) throw new ApiError(409, 'history_branch_conflict', 'Branch destination or command conflict');
    return { directory: await realpath(destination), sourceRevision: branch.sourceRevision, omittedReasoning: branch.omittedReasoning };
  }
  if (unpairedCalls(session.events).length) throw new ApiError(409, "history_branch_incomplete", "Resolve incomplete tool history before branching; unknown results cannot be invented");
  const view = contextView(session.events, assemblePrompt([]));
  const reasoning = view.nodes.filter(n => n.item.type === "reasoning");
  if (reasoning.length && !omitReasoning) throw new ApiError(409, "history_reasoning_consent", "Explicit consent to omit protocol-specific reasoning from the new request is required; original evidence remains preserved");
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
    const creation = { commandId: options.commandId ?? id(), mode: original.mode, target: { kind: original.target.kind, root: canonical, scope: original.target.scope, ...(original.target.host ? { host: original.target.host } : {}) } };
    const binding = await createSessionBinding(original.ownerWorkspace, sessionId, creation, creationHash("历史分支", creation), options.home);
    if (JSON.stringify(binding.target) !== JSON.stringify(original.target)) throw new Error("Branch target identity changed");
    const durableStorage = await openJournalStorage(staging, BACKGROUND_CONTEXT, {}, { workspace: original.ownerWorkspace, binding });
    const journal = durableStorage.journal;
    try {
      await journal.append("session.created", { workspace: canonical, ownerWorkspace: original.ownerWorkspace, model: "explicit-branch", baseUrl: "", binding });
      for (const ref of refs) await journal.artifact(await readArtifact(source, ref));
      const artifact = await journal.artifact(raw);
      await journal.append("branch.created", { sourceSessionId: original.sessionId, omitReasoning, sourceRevision: view.revision, sourceEvents: artifact, sourceArtifacts: refs, omittedReasoning: reasoning.length, conversion: "canonical-dialogue-v1", sideEffectsReplayed: false });
      const scriptState=await readScriptState(source,session.events);
      if(scriptState.eventId)await journal.append('codemode.state_seed',{version:1,state:await journal.artifact(JSON.stringify(scriptState.state)),sourceEventId:scriptState.eventId,sourceEvents:artifact,sideEffectsReplayed:false});
      await journal.append("session.title", { title: "跨 Provider 历史分支", source: "branch" });
      for (const node of nodes) await journal.append("context.add", { source: node.source === "runtime:environment:v1" ? node.source : `branch:${node.eventId}:${node.itemIndex}`, item: node.item, originalEventId: node.eventId, sourceEvents: artifact, conversion: "canonical-dialogue-v1" });
    } finally { await durableStorage.storage.close(BACKGROUND_CONTEXT); }
    await rename(staging, destination);
    return { directory: await realpath(destination), sourceRevision: view.revision, omittedReasoning: reasoning.length };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
