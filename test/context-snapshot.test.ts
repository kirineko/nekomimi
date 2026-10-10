import { expect, it } from "vitest";
import { join } from "node:path";
import { assemblePrompt, contextView, type ToolDefinition } from "../src/context.js";
import { captureRequestContext } from "../src/context-snapshot.js";
import { ResponsesProvider } from "../src/provider.js";
import { run } from "../src/runtime.js";
import { Journal, hash, readSession, readArtifact } from "../src/journal.js";
import { temporary, key, response, textItem } from "./helpers.js";
import { sessionBinding } from "../src/session/identity.js";
const definition = (name: string): ToolDefinition => ({ source: `fixture:${name}:v1`, snippet: name, guidance: [],
  tool: { name, label: name, description: name, parameters: { type: "object", properties: { value: { type: "string" } } }, execute: async () => ({ content: [], details: {} }) } });
async function fixture() {
  const workspace = await temporary(), home = await temporary();
  const result = await run({ workspace, home, session: join(await temporary(), "session"), apiKey: key, prompt: "original user input", fetch: async () => response([textItem()]) });
  expect(result.status).toBe("completed"); return { workspace, home, result, events: (await readSession(result.session)).events };
}
it("captures stable registration order, all identities, excluded dependencies and deep copies without freezing inputs", async () => {
  const f = await fixture(), a = definition("a"), b = definition("b");
  const instructions = [{ source: "fixture:excluded", text: "MUST_NOT_INJECT", requiresTools: ["absent"] }, { source: "fixture:rule", text: "scoped rule", scope: "src/" }];
  const model = { id: "model", provider: "fixture", protocol: "responses", contextWindow: 10000, maxTokens: 100 };
  const first = captureRequestContext({ events: f.events, prompt: assemblePrompt([b, a], instructions, "work"), model, runId: f.result.runId });
  const second = captureRequestContext({ events: f.events, prompt: assemblePrompt([a, b], [...instructions].reverse(), "work"), model, runId: f.result.runId });
  expect(first).toEqual(second); expect(first).toMatchObject({ mode: "work", target: sessionBinding(f.events)!.target, model });
  expect(first.capabilityRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(first.selection).toContainEqual(expect.objectContaining({ source: "fixture:excluded", hash: hash("MUST_NOT_INJECT"), decision: "exclude", reason: "tool-dependency-unavailable" }));
  expect(first.view.prompt.text).not.toContain("MUST_NOT_INJECT"); expect(Object.isFrozen(first.view.nodes[0]!.item)).toBe(true);
  expect(Object.isFrozen(model)).toBe(false); model.id = "changed"; instructions[1]!.text = "changed rule";
  expect(first.model.id).toBe("model"); expect(first.view.prompt.text).not.toContain("changed rule");
});
it("records original excluded nodes and the accepted summary without editing their source history", async () => {
  const f = await fixture(), journal = await Journal.open(f.result.session), prompt = assemblePrompt([], [], "work");
  try {
    const before = structuredClone(journal.events), original = contextView(journal.events, prompt).nodes, prefix = original.slice(0, 2), summary = "已完成早期任务；工具状态仍为 UNKNOWN";
    const checkpoint = await journal.append("compaction.completed", { version: 1, references: prefix.map(({ eventId, itemIndex, hash }) => ({ eventId, itemIndex, hash })), summary, summaryHash: hash(summary) });
    const snapshot = captureRequestContext({ events: journal.events, prompt, runId: f.result.runId,
      model: { provider: "fixture", id: "model", protocol: "responses", contextWindow: 10000, maxTokens: 100 } });
    expect(snapshot.view.checkpoint).toBe(checkpoint.eventId);
    expect(snapshot.selection).toContainEqual(expect.objectContaining({ eventId: checkpoint.eventId, source: "compaction:summary", decision: "include", reason: "accepted-compaction-checkpoint" }));
    for (const node of prefix) expect(snapshot.selection).toContainEqual(expect.objectContaining({ eventId: node.eventId, itemIndex: node.itemIndex, hash: node.hash, decision: "exclude", reason: "replaced-by-compaction-checkpoint" }));
    expect(journal.events.slice(0, before.length)).toEqual(before);
  } finally { await journal.close(); }
});
it.each(["append", "sync", "watermark.write", "watermark.rename"])("snapshot %s failure prevents all dispatch", async point => {
  const f = await fixture(); let armed = false, fired = false, calls = 0;
  const journal = await Journal.open(f.result.session, { beforeIO: async operation => { if (armed && !fired && operation === point) { fired = true; throw new Error("snapshot fault"); } } });
  try {
    const before = journal.durableSeq, provider = new ResponsesProvider(journal, { runId: f.result.runId }, assemblePrompt([], [], "work"), { apiKey: key, fetch: async () => { calls++; return response([textItem()]); } });
    armed = true; const result = await provider.stream(provider.model, { messages: [] }).result();
    expect(fired).toBe(true); expect(result.stopReason).toBe("error"); expect(calls).toBe(0); expect(journal.durableSeq).toBe(before);
  } finally { await journal.close(); }
});
it.each(["append", "sync", "watermark.write", "watermark.rename"])("transform %s failure prevents dispatch after successful preparation", async point => {
  const f = await fixture(); let armed = false, fired = false, calls = 0;
  const journal = await Journal.open(f.result.session, { beforeIO: async operation => {
    const type = journal.events.at(-1)?.type;
    if (armed && !fired && operation === point && (point === "append" ? type === "attempt.started" : type === "request.transform")) { fired = true; throw new Error("transform fault"); }
  } });
  try {
    const provider = new ResponsesProvider(journal, { runId: f.result.runId }, assemblePrompt([], [], "work"), { apiKey: key, fetch: async () => { calls++; return response([textItem()]); } });
    const prepared = await provider.prepare(); armed = true;
    const result = await provider.stream(provider.model, { messages: [], productContext: prepared }).result();
    expect(fired).toBe(true); expect(result.stopReason).toBe("error"); expect(calls).toBe(0);
    expect(journal.events.filter(event => event.seq <= journal.durableSeq && event.type === "request.dispatched" && (event.payload as any).contextSnapshot?.eventId === prepared.reference.eventId)).toHaveLength(0);
  } finally { await journal.close(); }
});
it("consumes prepared values after prompt, model and Journal changes and links the exact body to selections", async () => {
  const f = await fixture(), journal = await Journal.open(f.result.session); let body: any, calls = 0, preparations = 0;
  try {
    const prompt = assemblePrompt([definition("write")], [{ source: "fixture:instruction", text: "CAPTURED_INSTRUCTION" }], "work");
    const provider = new ResponsesProvider(journal, { runId: f.result.runId }, prompt, { apiKey: key, beforeRequest: async () => { preparations++; }, fetch: async (_url, init) => { calls++; body = JSON.parse(String(init!.body)); return response([textItem()]); } });
    const prepared = await provider.prepare();
    prompt.text = "LATE_INSTRUCTION"; prompt.schemas[0]!.description = "LATE_SCHEMA"; provider.model.id = "late-model";
    await journal.append("context.add", { source: "user", item: { role: "user", content: "LATE_USER_INPUT" } });
    const result = await provider.stream(provider.model, { messages: [], productContext: prepared }).result(); expect(result.stopReason).toBe("stop");
    expect(calls).toBe(1); expect(preparations).toBe(1); expect(body.model).toBe(prepared.snapshot.model.id);
    expect(body.instructions).toBe(prepared.snapshot.view.prompt.text); expect(JSON.stringify(body)).not.toMatch(/LATE_(?:INSTRUCTION|SCHEMA|USER_INPUT)|late-model/);
    const dispatch = journal.events.findLast(event => event.type === "request.dispatched")!, transform = journal.events.findLast(event => event.type === "request.transform")!;
    expect(dispatch.payload).toMatchObject({ contextSnapshot: prepared.reference }); expect(transform.payload).toMatchObject({ contextSnapshot: prepared.reference, outputHash: (dispatch.payload as any).bodyHash });
    const ids = new Set(prepared.snapshot.selection.map(item => item.id));
    for (const mapping of (transform.payload as any).mapping) expect(mapping.inputs.every((id: string) => ids.has(id))).toBe(true);
    const stored = JSON.parse((await readArtifact(journal.directory, prepared.reference.artifact)).toString()); expect(stored).toEqual(prepared.snapshot);
    const rejected = await provider.stream(provider.model, { messages: [], productContext: prepared }).result(); expect(rejected.stopReason).toBe("error"); expect(calls).toBe(1);
  } finally { await journal.close(); }
});
it("the formal Durable hook prepares exactly one snapshot per generation and publishes its native task identity", async () => {
  const f = await fixture(), snapshots = f.events.filter(event => event.type === "context.snapshot"); expect(snapshots).toHaveLength(1);
  const snapshot = snapshots[0]!, attempt = f.events.find(event => event.type === "attempt.started")!, dispatch = f.events.find(event => event.type === "request.dispatched")!;
  expect(snapshot.frameworkTaskId).toBe(attempt.frameworkTaskId); expect(snapshot.frameworkTaskId).toBeTruthy();
  expect(attempt.payload).toMatchObject({ contextSnapshot: { eventId: snapshot.eventId } }); expect(dispatch.payload).toMatchObject({ contextSnapshot: { eventId: snapshot.eventId } });
  expect(snapshot.seq).toBeLessThan(attempt.seq); expect(f.events.filter(event => event.type === "context.view")).toHaveLength(1);
});
