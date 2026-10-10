import { it, expect } from "vitest";
import { Type, createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Harness, createRegistry, defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import { bindToolPolicy, recordedTool, prepareToolCall } from "../src/customization/execution.js";
import { durableTool } from "../src/pi/tool-adapter.js";
import { openJournalStorage } from "../src/pi/journal-storage.js";
import { hash } from "../src/journal.js";
import { temporary } from "./helpers.js";

it.each(["direct", "durable"])("runs one product pipeline for %s and keeps observer failure separate", async route => {
  const { journal, storage } = await openJournalStorage(await temporary(), context);
  let preparations = 0, gates = 0, effects = 0, observers = 0;
  const parameters = Type.Object({ value: Type.Number() });
  const tool = bindToolPolicy(recordedTool({
    name: "count", label: "Count", description: "Count", parameters,
    prepareArguments(args) { preparations++; expect(typeof (args as {value:unknown}).value).toBe("string"); return { value: Number((args as {value:unknown}).value) }; },
    async execute(_id, args) { effects++; const value = (args as {value:number}).value; expect(value).toBe(7); return { content: [{ type: "text", text: "original" }], details: { value } }; },
  }, journal, {}), {
    revision: "capability-7",
    async before(_name, args) {
      gates++;
      const tasks = await storage.scanTasks({}, 100, undefined, context);
      expect(tasks.items.some(task => task.kind === "pi.tool" && "checkpoint" in task.state && (task.state.checkpoint as {phase:string}).phase === "execute")).toBe(false);
      args.value = 999; return undefined;
    },
    async after(_name, _args, result) { observers++; result.content.splice(0); throw new Error("observer failed"); },
  }, journal, {});
  // The registered schema is a fixed snapshot even if its source object later changes.
  Object.assign(parameters.properties.value, { minimum: 100 });
  let harness: Harness | undefined;
  try {
    if (route === "direct") {
      const result = await tool.execute("direct", { value: "7" });
      expect(result.content).toEqual([{ type: "text", text: "original" }]);
    } else {
      const models = createModels(), faux = fauxProvider({ tokensPerSecond: Infinity }); models.setProvider(faux.provider);
      faux.setResponses([fauxAssistantMessage(fauxToolCall("count", { value: "7" }), { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
      const native = durableTool(tool);
      const registry = createRegistry(); registry.install(defineExtension({ name: "fixture", tools: [native], hooks: [hook(ToolTask, { beforeTool: async (call, _api, invocation) => ({ arguments: await native.prepareCall(call.id, call.arguments, invocation.abortSignal) }) })] }));
      harness = await Harness.open(storage, { models, registry, settings: { compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, stream: { maxRetries: 0 } } }, context);
      const model = faux.getModel(), root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
      await (await root.submit({ type: "input", content: "count" }, context)).wait(context);
      const entries = await root.entries({}, 100, undefined, context);
      expect(entries.items.flatMap(entry => entry.model ?? []).find(message => message.role === "toolResult")?.content).toEqual([{ type: "text", text: "original" }]);
    }
    expect({ preparations, gates, effects, observers }).toEqual({ preparations: 1, gates: 1, effects: 1, observers: 1 });
    const intents = journal.events.filter(event => event.type === "tool.intent");
    expect(intents).toHaveLength(1);
    expect(intents[0]!.payload).toMatchObject({ args: { value: 7 }, schemaHash: hash(JSON.stringify(tool.parameters)), capabilityRevision: "capability-7" });
    expect(journal.events.filter(event => event.type === "tool.completed")).toHaveLength(1);
    expect(journal.events.filter(event => event.type === "tool.observer_error")).toHaveLength(1);
    expect(journal.events.some(event => event.type === "tool.execution_error")).toBe(false);
    await expect(tool.execute("invalid", { value: "bad" })).rejects.toThrow("Invalid tool arguments");
    expect(gates).toBe(1); expect(effects).toBe(1); expect(observers).toBe(1);
    expect(journal.events.filter(event => event.type === "tool.intent")).toHaveLength(1);
  } finally { if (harness) await harness.close(context); else await storage.close(context); }
});


it("consumes admission once and cancels before intent without executing", async () => {
  const { journal, storage } = await openJournalStorage(await temporary(), context);
  let effects = 0;
  const tool = recordedTool({ name: "effect", label: "Effect", description: "Effect", parameters: Type.Object({}), async execute() {
    effects++; return { content: [{ type: "text", text: "done" }], details: {} };
  } }, journal, {});
  try {
    const admitted = await prepareToolCall(tool, "once", {});
    await admitted.execute();
    await expect(admitted.execute()).rejects.toThrow("already been consumed");
    const cancelled = await prepareToolCall(tool, "cancel", {}), controller = new AbortController(); controller.abort();
    await expect(cancelled.execute(controller.signal)).rejects.toThrow();
    expect(effects).toBe(1);
    expect(journal.events.filter(event => event.type === "tool.intent")).toHaveLength(1);
  } finally { await storage.close(context); }
});
