import { it, expect } from "vitest";
import { Type } from "typebox";
import { Journal } from "../src/journal.js";
import { RecordedCall } from "../src/recorded-call.js";
import { recordedTool } from "../src/customization/execution.js";
import { temporary } from "./helpers.js";

it("captures separate concurrent scopes before writer queuing and does not leak between Journals", async () => {
  const journal = await Journal.open(await temporary());
  const other = await Journal.open(await temporary());
  try {
    await Promise.all([1, 2, 3].map(frameworkTaskId => journal.withLinks({ frameworkTaskId, conversationId: 1 }, async () => {
      await Promise.resolve();
      await journal.append("first", { owner: frameworkTaskId });
      await journal.appendIf("second", { owner: frameworkTaskId }, () => true);
      await other.append("unrelated", {});
    })));
    expect(journal.events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(journal.events.map(e => e.eventId)).size).toBe(6);
    for (const event of journal.events) expect(event.frameworkTaskId).toBe((event.payload as { owner: number }).owner);
    expect(other.events.every(e => e.frameworkTaskId === undefined)).toBe(true);
    await journal.append("outside", {});
    expect(journal.events.at(-1)?.frameworkTaskId).toBeUndefined();
  } finally { await journal.close(); await other.close(); }
});

it("retains native owner and immediate tool ancestry through nested execution and model capture", async () => {
  const journal = await Journal.open(await temporary());
  const child = recordedTool({ name: "child", label: "Child", description: "Child", parameters: Type.Object({}), async execute() {
    await journal.append("effect", {});
    const call = new RecordedCall(journal, { runId: "run" });
    await Promise.resolve();
    await journal.append("model.fixture", {}, call.links);
    return { content: [{ type: "text", text: "done" }], details: {} };
  } }, journal, { runId: "run" });
  const parent = recordedTool({ name: "parent", label: "Parent", description: "Parent", parameters: Type.Object({}), async execute() {
    return child.execute("child-call", {});
  } }, journal, { runId: "run" });
  try {
    await journal.withLinks({ frameworkTaskId: 19, conversationId: 1, modelCallId: "parent-model", attemptId: "parent-attempt" }, () => parent.execute("parent-call", {}));
    for (const event of journal.events) expect(event.frameworkTaskId).toBe(19);
    const childEvents = journal.events.filter(e => e.toolCallId === "child-call");
    expect(childEvents.filter(e => e.type !== "model.fixture").every(e => e.parentToolCallId === "parent-call")).toBe(true);
    const model = childEvents.find(e => e.type === "model.fixture")!;
    expect(model.parentToolCallId).toBe("child-call");
    expect(model.parentModelCallId).toBe("parent-model");
    expect(model.parentAttemptId).toBe("parent-attempt");
    expect(model.modelCallId).not.toBe("parent-model");
    expect(model.attemptId).toBeUndefined();
    expect(journal.events.filter(e => e.type === "tool.intent")).toHaveLength(2);
    expect(journal.events.filter(e => e.type === "tool.completed")).toHaveLength(2);
    expect(journal.durableSeq).toBe(journal.events.length);
  } finally { await journal.close(); }
});

it("stops dispatch when the active Journal loses its writer lease", async () => {
  const { rm } = await import("node:fs/promises");
  const directory = await temporary();
  const journal = await Journal.open(directory, { lockStaleMs: 2000 });
  let effects = 0;
  const tool = recordedTool({ name: "effect", label: "Effect", description: "Effect", parameters: Type.Object({}), async execute() {
    effects++;
    return { content: [{ type: "text", text: "done" }], details: {} };
  } }, journal, {});
  try {
    await rm(`${journal.directory}.lock`, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("lease loss was not observed")), 4000);
      journal.failure.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    await expect(tool.execute("forbidden", {})).rejects.toThrow();
    expect(effects).toBe(0);
    expect(journal.events.some(event => event.type === "tool.intent")).toBe(false);
  } finally { await journal.close(); }
});

it("cancels an in-flight model and returns failed when its writer lease is compromised", async () => {
  const { rm, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { run } = await import("../src/runtime.js");
  const { key } = await import("./helpers.js");
  const workspace = await temporary(), session = join(workspace, "session");
  let requests = 0;
  const result = await run({ workspace, session, prompt: "wait", apiKey: key, journalOptions: { lockStaleMs: 2000 }, fetch: async (_url, init) => {
    requests++;
    await rm(`${session}.lock`, { recursive: true });
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("lease cancelled request")), { once: true }));
  } });
  expect(result.status).toBe("failed");
  expect(requests).toBe(1);
  expect(await readFile(join(session, "journal.jsonl"), "utf8")).not.toContain('"type":"tool.intent"');
});

it("keeps concurrent recorded response streams attached to their own task and attempt", async () => {
  const { executeRecordedModel } = await import("../src/pi/model-service.js");
  const { readArtifact } = await import("../src/journal.js");
  const journal = await Journal.open(await temporary());
  let entered = 0, release!: () => void;
  const both = new Promise<void>(resolve => { release = resolve; });
  try {
    const results = await Promise.all([41, 42].map(frameworkTaskId => journal.withLinks({ frameworkTaskId, conversationId: 1 }, () => executeRecordedModel(journal, {
      url: "http://fixture.invalid/model", body: JSON.stringify({ frameworkTaskId }), provider: "fixture", model: "fixture", protocol: "text", purpose: "work", operation: "chat", contextRevision: "fixture", links: {}, decode: response => response.text(),
      transport: { fetch: async () => {
        if (++entered === 2) release();
        await both;
        let index = 0;
        return new Response(new ReadableStream({ async pull(controller) {
          await Promise.resolve();
          if (index === 2) controller.close();
          else controller.enqueue(new TextEncoder().encode(`${frameworkTaskId}:${index++};`));
        } }));
      } },
    }))));
    expect(results.map(result => result.value)).toEqual(["41:0;41:1;", "42:0;42:1;"]);
    expect(new Set(results.map(result => result.modelCallId)).size).toBe(2);
    expect(new Set(results.map(result => result.attemptId)).size).toBe(2);
    for (const event of journal.events.filter(event => event.type === "response.chunk")) {
      const bytes = await readArtifact(journal.directory, (event.payload as {artifact: import("../src/journal.js").Artifact}).artifact);
      expect(bytes.toString()).toContain(String(event.frameworkTaskId));
      expect(event.attemptId).toBe(results[event.frameworkTaskId === 41 ? 0 : 1]!.attemptId);
    }
    expect(new Set(journal.events.map(event => event.seq)).size).toBe(journal.events.length);
  } finally { await journal.close(); }
});
