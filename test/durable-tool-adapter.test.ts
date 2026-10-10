import { expect, it } from "vitest";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { Harness, createRegistry, defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import { durableTool } from "../src/pi/tool-adapter.js";
import { openJournalStorage } from "../src/pi/journal-storage.js";
import { recordedTool } from "../src/customization/execution.js";
import { temporary } from "./helpers.js";

it("executes a product tool behind native intent and retains product evidence before native publication", async () => {
  const { storage, journal } = await openJournalStorage(await temporary(), context);
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage(fauxToolCall("effect", {}, { id: "call-1" }), { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
  let calls = 0;
  const tool = durableTool(recordedTool({
    name: "effect", label: "Effect", description: "Record an effect", parameters: Type.Object({}),
    async execute(id, _args, signal) {
      calls++;
      expect(id).toBe("call-1");
      expect(signal?.aborted).toBe(false);
      const tasks = await storage.scanTasks({}, 100, undefined, context);
      expect(tasks.items.some(task => task.kind === "pi.tool" && "checkpoint" in task.state &&
        (task.state.checkpoint as { phase: string }).phase === "execute")).toBe(true);
      expect(journal.events.at(-1)?.type).toBe("tool.intent");
      expect(journal.events.at(-1)?.seq).toBe(journal.durableSeq);
      return { content: [{ type: "text", text: "effect complete" }], details: { count: calls } };
    },
  }, journal, {}));
  expect(tool.replay).toBe("unsafe");
  const registry = createRegistry(); registry.install(defineExtension({ name: "product", tools: [tool], hooks: [hook(ToolTask, { beforeTool: async (call, _api, invocation) => ({ arguments: await tool.prepareCall(call.id, call.arguments, invocation.abortSignal) }) })] }));
  const harness = await Harness.open(storage, { models, registry, settings: {
    compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, stream: { maxRetries: 0 }, toolExecution: "sequential",
  } }, context);
  try {
    const model = faux.getModel();
    const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
    await (await root.submit({ type: "input", content: "run" }, context)).wait(context);
    expect(calls, JSON.stringify(await storage.scanTasks({}, 100, undefined, context))).toBe(1);
    expect(journal.events.filter(event => event.type === "tool.completed")).toHaveLength(1);
    const entries = await root.entries({}, 100, undefined, context);
    expect(entries.items.some(entry => entry.kind === "pi.tool-result")).toBe(true);
  } finally { await harness.close(context); }
});
