import { CustomizationHost } from "./customization/host.js";
import { CustomRun } from "./customization/run.js";
import type { Interactions } from "./customization/interactions.js";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import { Journal, id, type JournalOptions } from "./journal.js";
import { CoreTools, type ToolOptions } from "./tools.js";
import type { ProviderOptions } from "./provider.js";
import { createProvider } from "./customization/adapter-provider.js";
import { assemblePrompt, unpairedCalls, type Instruction } from "./context.js";

export interface RunOptions extends ProviderOptions {
  workspace: string;
  home?: string;
  customization?: CustomizationHost;
  interactions?: Interactions;
  session: string;
  prompt: string;
  instructions?: Instruction[];
  images?: ImageContent[];
  tools?: string[];
  signal?: AbortSignal;
  journalOptions?: JournalOptions;
  toolOptions?: ToolOptions;
  maxTurns?: number;
  /** Web command acknowledgment occurs under the writer lock, before any model dispatch. */
  command?: {
    id: string;
    payloadHash: string;
    runId: string;
    onAccepted: (runId: string) => void;
  };
  /** Best-effort, coalesced UI observer; the Journal remains complete even if this consumer is slow. */
  onProgress?: (value: {
    type: string;
    seq: number;
    durableSeq: number;
  }) => unknown;
}
export interface RunResult {
  session: string;
  sessionId: string;
  runId: string;
  status: string;
  text: string;
  durableSeq: number;
  error?: string;
}
export async function run(options: RunOptions): Promise<RunResult> {
  if (!options.prompt.trim()) throw new Error("Prompt must not be empty");
  const runId = options.command?.runId ?? id();
  const host = options.customization ?? new CustomizationHost(options.workspace, options.home);
  const activation = await host.acquire();
  let journal: Journal;
  try { journal = await Journal.open(options.session, {
    ...options.journalOptions,
    diagnosticRunId: runId,
    secrets: [...(options.journalOptions?.secrets ?? []), options.apiKey, ...activation.mcp.flatMap(m => m.secrets)],
  }); } catch (e) { await host.release(); if (!options.customization) await host.close(); throw e; }
  const controller = new AbortController();
  const runSignal = AbortSignal.any([controller.signal, journal.failure.signal, ...(options.signal ? [options.signal] : [])]);
  const custom = new CustomRun(host, activation, journal, runId, runSignal, options, options.interactions);
  let agent: Agent | undefined;
  const notify = (() => {
    let pending: { type: string; seq: number; durableSeq: number } | undefined;
    let active = false;
    return (type: string) => {
      pending = {
        type,
        seq: journal.events.length,
        durableSeq: journal.durableSeq,
      };
      if (active || !options.onProgress) return;
      active = true;
      void (async () => {
        try {
          while (pending) {
            const value = pending;
            pending = undefined;
            try {
              await options.onProgress!(value);
            } catch {}
          }
        } finally {
          active = false;
        }
      })();
    };
  })();
  try {
    await host.workflows.recover(journal);
    const tools = await CoreTools.create(
      options.workspace,
      journal,
      { runId },
      { ...options.toolOptions, search: { apiKey: options.apiKey, fetch: options.fetch, settings: options.search, ...options.toolOptions?.search } },
    );
    const existing = journal.events.find((e) => e.type === "session.created")
      ?.payload as
      | { workspace: string; model: string; baseUrl: string }
      | undefined;
    const model = options.model ?? "deepseek-flash";
    const baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(
      /\/$/,
      "",
    );
    const { realpath } = await import("node:fs/promises");
    const workspace = await realpath(options.workspace);
    if (existing && existing.workspace !== workspace)
      throw new Error("Resume requires the original workspace");
    if (!existing)
      await journal.append("session.created", { workspace, model, baseUrl });
    if (!journal.events.some((e) => e.type === "session.title"))
      await journal.append(
        "session.title",
        {
          title: options.prompt.replace(/\s+/g, " ").trim().slice(0, 60),
          source: "first-prompt",
        },
        { runId },
      );
    if (options.command) {
      const command = options.command;
      const prior = journal.events.find(
        (e) =>
          e.type === "command.accepted" &&
          (e.payload as { commandId?: string }).commandId === command.id,
      );
      if (prior)
        throw new Error(
          "Command already accepted; inspect its existing receipt",
        );
      await journal.append(
        "command.accepted",
        { commandId: command.id, payloadHash: command.payloadHash },
        { runId },
      );
      command.onAccepted(runId);
    }
    // Closing protocol pairs is bookkeeping, never a tool retry or invented reasoning.
    for (const call of unpairedCalls(journal.events)) {
      const intended = journal.events.some(
        (e) =>
          e.type === "tool.intent" &&
          e.toolCallId?.split("|")[0] === call.call_id,
      );
      await journal.append(
        "recovery.tool_unknown",
        {
          source: "recovery:interrupted-run",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: intended
              ? "The prior tool operation has an UNKNOWN result after interruption. Inspect the workspace; do not assume it failed or automatically repeat it."
              : "This tool was NOT EXECUTED before interruption.",
          },
        },
        { runId },
      );
    }
    await custom.initialize(tools.definitions());
    const definitions = custom.definitions.filter((d) => !options.tools || options.tools.includes(d.tool.name));
    custom.definitions.splice(0, custom.definitions.length, ...definitions);
    if (
      options.tools?.some(
        (name) => !definitions.some((d) => d.tool.name === name),
      )
    )
      throw new Error("Unknown tool name");
    const prompt = assemblePrompt(definitions, [...(options.instructions ?? []), ...custom.instructions]);
    const refreshPrompt = () => Object.assign(prompt, assemblePrompt(definitions, [...(options.instructions ?? []), ...custom.instructions]));
    const provider = await createProvider(host, activation, journal, { runId }, prompt, options);
    await journal.append(
      "run.started",
      {
        workspace,
        model: provider.model.id,
        baseUrl: provider.model.baseUrl,
        provider: provider.model.provider,
        promptManifest: prompt.fragments,
        resourceRevision: activation.revision,
        tools: definitions.map((d) => d.tool.name),
      },
      { runId },
    );
    const input = [
      { type: "input_text", text: options.prompt },
      ...(options.images ?? []).map((i) => ({
        type: "input_image",
        image_url: `data:${i.mimeType};base64,${i.data}`,
      })),
    ];
    await journal.append(
      "context.add",
      { source: "user", item: { role: "user", content: input } },
      { runId },
    );
    let turns = 1;
    agent = new Agent({
      initialState: {
        model: provider.model,
        systemPrompt: prompt.text,
        tools: definitions.map((d) => d.tool),
      },
      streamFn: provider.stream,
      toolExecution: "sequential",
      beforeToolCall: async ({ assistantMessage, toolCall }) => {
        journal.check();
        options.signal?.throwIfAborted();
        if (
          assistantMessage.stopReason !== "toolUse" ||
          provider.lastOutcome !== "completed"
        )
          return {
            block: true,
            reason: "The response was not completed; tool execution is blocked",
            terminate: true,
          };
        const reason = await custom.checkRules(toolCall.name, toolCall.arguments) ?? await custom.hook('beforeTool', { tool: toolCall.name, args: toolCall.arguments });
        refreshPrompt();
        if (reason) return { block: true, reason };
      },
      afterToolCall: async ({ toolCall, result }) => {
        await custom.hook('afterTool', { tool: toolCall.name, args: toolCall.arguments, result: result as import('./customization/types.js').ToolResult });
        refreshPrompt(); return undefined;
      },
      prepareNextTurn: async () => {
        journal.check();
        if (++turns > (options.maxTurns ?? 32))
          throw new Error("Run turn limit exceeded");
        refreshPrompt();
        return undefined;
      },
    });
    const abort = () => agent?.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    journal.failure.signal.addEventListener("abort", abort, { once: true });
    agent.subscribe(async (event) => {
      journal.check();
      if (event.type === "tool_execution_start")
        await journal.append(
          "tool.requested",
          {
            name: event.toolName,
            args: event.args,
            wireCallId: provider.wireCallId(event.toolCallId),
          },
          { runId, toolCallId: event.toolCallId },
        );
      if (event.type === "message_end" && event.message.role === "toolResult") {
        const m = event.message;
        const content = m.content.map((c) =>
          c.type === "image"
            ? {
                type: "input_image",
                image_url: `data:${c.mimeType};base64,${c.data}`,
              }
            : { type: "input_text", text: c.text },
        );
        await journal.append(
          m.isError ? "tool.failed" : "tool.result",
          {
            item: {
              type: "function_call_output",
              call_id: provider.wireCallId(m.toolCallId),
              output: content,
            },
            details: m.details,
            source: `tool:${m.toolName}`,
          },
          { runId, toolCallId: m.toolCallId },
        );
      }
      if (["turn_end", "tool_execution_end", "agent_end"].includes(event.type))
        notify(event.type);
    });
    let error: string | undefined;
    let commandText: string | undefined;
    try {
      options.signal?.throwIfAborted();
      const reason = await custom.hook('beforeRun');
      if (reason) throw new Error(reason);
      const command = await custom.command(options.prompt);
      refreshPrompt();
      if (command.handled) {
        await journal.append('extension.command_result', { text: command.text }, { runId });
        commandText = command.text;
      } else await agent.prompt(command.text, options.images);
      while (custom.followups.length) {
        runSignal.throwIfAborted();
        const followup = custom.followups.shift()!;
        if (++turns > (options.maxTurns ?? 32)) throw new Error('Run turn limit exceeded');
        await journal.append('context.add', { source: 'extension:follow-up', item: { role: 'user', content: [{ type: 'input_text', text: followup }] } }, { runId });
        refreshPrompt(); await agent.prompt(followup);
      }
      await custom.hook('afterRun');
    } catch (e) {
      error = journal.clean(String(e));
    } finally {
      options.signal?.removeEventListener("abort", abort);
      journal.failure.signal.removeEventListener("abort", abort);
    }
    const final = agent.state.messages
      .filter((m) => m.role === "assistant")
      .at(-1) as AssistantMessage | undefined;
    error ??= agent.state.errorMessage ?? final?.errorMessage;
    const status = options.signal?.aborted
      ? "cancelled"
      : journal.failure.signal.aborted || error
        ? provider.lastOutcome === "incomplete"
          ? "incomplete"
          : "failed"
        : provider.lastOutcome;
    const text = commandText ??
      final?.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") ?? "";
    if (!journal.failure.signal.aborted)
      await journal.append(
        "run.finished",
        { status, error, text: journal.clean(text) },
        { runId },
      );
    notify("run.finished");
    if (status === "completed" && !journal.failure.signal.aborted)
      await host.workflows.observe(journal, activation, "run-completed", undefined, options);
    return {
      session: journal.directory,
      sessionId: journal.sessionId,
      runId,
      status,
      text: journal.clean(text),
      error,
      durableSeq: journal.durableSeq,
    };
  } finally {
    controller.abort(new Error('Run ended'));
    try { await journal.close(); }
    finally {
      try { await host.release(); }
      finally { if (!options.customization) await host.close(); }
    }
  }
}
