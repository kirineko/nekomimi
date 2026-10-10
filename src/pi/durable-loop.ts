import { createModels, createProvider, type Api, type Model, type AssistantMessage, type ImageContent, type ToolCall, type ToolResultMessage } from "@earendil-works/pi-ai";
import { Harness, createRegistry, defineExtension, hook, GenerationTask, ToolTask, type Storage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Journal, Links } from "../journal.js";
import type { Json } from "../customization/types.js";
import type { RuntimeTool, RuntimeToolResult } from "../tool-contracts.js";
import type { RecordedModelStream } from "./model-stream.js";
import { durableTool } from "./tool-adapter.js";
import { durableContext } from "./task-context.js";
import { prepareExplicitContinuation } from "./recovery.js";
import type { PreparedRequestContext } from "../context-snapshot.js";

type Event = { type: "tool_execution_start"; toolName: string; args: unknown; toolCallId: string }
  | { type: "message_end"; message: AssistantMessage | ToolResultMessage }
  | { type: "turn_end" | "tool_execution_end" | "agent_end" };
type ProductCall = Omit<ToolCall, "arguments"> & { arguments: Record<string, Json> };
const productCall = (call: ToolCall): ProductCall => structuredClone(call) as ProductCall;
interface Options {
  storage: Storage;
  journal: Journal;
  signal?: AbortSignal;
  initialState: { model: Model<Api>; systemPrompt: string; tools: RuntimeTool[] };
  streamFn: RecordedModelStream;
  prepareRequest?(): Promise<PreparedRequestContext>;
  afterModelResponse?(message: AssistantMessage): Promise<void>;
  beforeToolCall(input: { assistantMessage: AssistantMessage; toolCall: ProductCall }): Promise<{ block: boolean; reason: string; terminate?: boolean } | undefined>;
  afterToolCall(input: { toolCall: ProductCall; result: RuntimeToolResult }): Promise<unknown>;
  prepareNextTurn(): Promise<unknown>;
}
/** Product events are published only after the corresponding native commit is durable. */
export async function createDurableLoop(options: Options) {
  const { journal } = options;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const context = durableContext(journal, BACKGROUND_CONTEXT, signal);
  const state: { messages: AssistantMessage[]; errorMessage?: string } = { messages: [] };
  const listeners: Array<(event: Event) => Promise<void>> = [];
  const emit = async (event: Event) => { for (const listener of listeners) await listener(event); };
  let tail = Promise.resolve();
  let projectionError: unknown;
  let latest: AssistantMessage | undefined;
  let generationLinks: Links = {};
  let preparedRequest: PreparedRequestContext | undefined;
  const toolCauses = new Map<string, Links>();
  let recovering = true;
  const fail = (error: unknown) => {
    projectionError ??= error;
    state.errorMessage ??= error instanceof Error ? error.message : String(error);
    controller.abort(error);
  };
  const stream: RecordedModelStream = (selected, input, request) => {
    journal.check(); signal.throwIfAborted();
    if (projectionError) throw projectionError;
    // Product cancellation must reach the transport synchronously, before the
    // asynchronous native task-abort transaction has finished.
    const requestSignal = request?.signal ? AbortSignal.any([signal, request.signal]) : signal;
    return journal.withLinks(generationLinks, () => options.streamFn(selected, { ...input, productContext: preparedRequest }, { ...request, signal: requestSignal }));
  };
  const models = createModels();
  const model = options.initialState.model;
  models.setProvider(createProvider({
    id: model.provider, models: [model],
    auth: { apiKey: { name: "Recorded product transport", resolve: async () => ({ auth: {} }) } },
    api: {
      stream: (selected, input, request) => stream(selected, { messages: [...input.messages] }, { signal: request?.signal }),
      streamSimple: (selected, input, request) => stream(selected, { messages: [...input.messages] }, { signal: request?.signal }),
    },
  }));
  const registry = createRegistry();
  const adapters = new Map(options.initialState.tools.map(tool => [tool.name, durableTool(tool)]));
  registry.install(defineExtension({ name: "nekomimi", tools: options.initialState.tools.map(tool => {
    const native = adapters.get(tool.name)!;
    return { ...native, async execute(args, api, invocation) {
      journal.check(); invocation.abortSignal?.throwIfAborted();
      return journal.withLinks({ ...toolCauses.get(api.callId), frameworkTaskId: api.taskId, conversationId: api.conversationId, toolCallId: api.callId }, async () => {
        await emit({ type: "tool_execution_start", toolName: tool.name, args, toolCallId: api.callId });
        return native.execute(args, api, invocation);
      });
    } };
  }), hooks: [
    hook(GenerationTask, {
      async beforeRequest(_request, api) {
        generationLinks = { frameworkTaskId: api.taskId, conversationId: api.conversationId };
        await tail;
        if (projectionError) throw projectionError;
        journal.check(); signal.throwIfAborted();
        preparedRequest = await journal.withLinks(generationLinks, async () => options.prepareRequest?.());
        journal.check(); signal.throwIfAborted();
        // The stream consumes exactly this product snapshot; native history is not another input authority.
        return { messages: [] };
      },
      async afterResponse(message, api) {
        latest = message;
        const attempt = journal.events.findLast(event => event.type === "attempt.finished" && event.frameworkTaskId === api.taskId);
        for (const part of message.content) if (part.type === "toolCall")
          toolCauses.set(part.id, { modelCallId: attempt?.modelCallId, attemptId: attempt?.attemptId });
        try {
          await journal.withLinks({ ...generationLinks, modelCallId: attempt?.modelCallId, attemptId: attempt?.attemptId }, () => options.afterModelResponse?.(message));
        } catch (error) { fail(error); throw error; }
      },
      async afterTools() {
        if (recovering) return;
        await tail;
        if (projectionError) throw projectionError;
        try { await options.prepareNextTurn(); } catch (error) { fail(error); throw error; }
        await emit({ type: "turn_end" });
      },
    }),
    hook(ToolTask, {
      async beforeTool(call, api, invocation) {
        if (recovering || !latest) return { block: "No current completed model response" };
        const decision = await journal.withLinks({ ...toolCauses.get(call.id), frameworkTaskId: api.taskId, conversationId: api.conversationId, toolCallId: call.id }, () => options.beforeToolCall({ assistantMessage: latest!, toolCall: productCall(call) }));
        if (decision?.block) return { block: decision.reason };
        const adapter = adapters.get(call.name);
        if (!adapter) return { block: "Tool unavailable" };
        const args = await journal.withLinks({ ...toolCauses.get(call.id), frameworkTaskId: api.taskId, conversationId: api.conversationId, toolCallId: call.id }, () => adapter.prepareCall(call.id, call.arguments, invocation.abortSignal));
        return { arguments: args };
      },
      async afterTool(call, result, api) {
        if (recovering) return;
        try { await journal.withLinks({ ...toolCauses.get(call.id), frameworkTaskId: api.taskId, conversationId: api.conversationId, toolCallId: call.id }, () => options.afterToolCall({ toolCall: productCall(call), result: { content: result.content ?? [], details: result.details } })); }
        catch (error) { fail(error); throw error; }
        return undefined;
      },
    }),
  ] }));
  const harness = await Harness.open(options.storage, { models, registry, settings: {
    compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, stream: { maxRetries: 0 }, toolExecution: "sequential",
  } }, context);
  try {
    await prepareExplicitContinuation(harness, journal, context, signal);
    recovering = false;
    const root = await harness.root(context);
    await root.configure({ model: { provider: model.provider, modelId: model.id } }, context);
    const unsubscribe = harness.subscribeCommits(publication => {
      tail = tail.then(async () => {
        for (const change of publication.changes) {
          if (change.type === "entry") for (const message of change.value.model ?? []) {
            if (message.role === "assistant") { state.messages.push(message); await emit({ type: "message_end", message }); }
            if (message.role === "toolResult") { await journal.withLinks({ ...toolCauses.get(message.toolCallId), frameworkTaskId: change.value.byTaskId, conversationId: change.value.conversationId, toolCallId: message.toolCallId }, async () => { await emit({ type: "message_end", message }); await emit({ type: "tool_execution_end" }); }); }
          }
          if (change.type === "task" && change.value.state.status === "terminal") {
            const outcome = change.value.state.outcome;
            if (outcome.status === "faulted") state.errorMessage = outcome.error.message;
          }
        }
      }).catch(fail);
    });
    return {
      state,
      subscribe(listener: (event: Event) => Promise<void>) { listeners.push(listener); },
      abort() { controller.abort(new Error("Run cancelled")); },
      async prompt(text: string, images?: ImageContent[]) {
        try {
          const submission = await root.submit({ type: "input", content: images?.length ? [{ type: "text", text }, ...images] : text }, context);
          await submission.wait(context);
          await root.waitForIdle(context);
          await tail;
          if (projectionError) throw projectionError;
          if (state.errorMessage) throw new Error(state.errorMessage);
          await emit({ type: "agent_end" });
        } catch (error) {
          // Join native cancellation and its committed results before the product run terminal.
          if (!journal.failure.signal.aborted) await root.abort(BACKGROUND_CONTEXT);
          await tail;
          throw error;
        }
      },
      async close() {
        try { if (!journal.failure.signal.aborted) await root.abort(BACKGROUND_CONTEXT); await tail; }
        finally { unsubscribe(); await harness.close(BACKGROUND_CONTEXT); }
      },
    };
  } catch (error) { await harness.close(BACKGROUND_CONTEXT); throw error; }
}
export type DurableLoop = Awaited<ReturnType<typeof createDurableLoop>>;
