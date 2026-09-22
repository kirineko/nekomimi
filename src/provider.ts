import { RecordedCall } from "./recorded-call.js";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import { stream as responsesStream } from "@earendil-works/pi-ai/api/openai-responses";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { Journal, type Links } from "./journal.js";
import { contextView, type assemblePrompt, type WireItem } from "./context.js";

export interface ProviderOptions {
  apiKey: string;
  providerProfile?: string;
  auxiliaryProfile?: string;
  namingProfile?: string;
  search?: import("./web-search.js").SearchSettings;
  purpose?: "session-title" | "extension";
  contextEvents?: import("./journal.js").JournalEvent[];
  model?: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxResponseEvents?: number;
  fetch?: typeof globalThis.fetch;
  retryDelayMs?: number;
}
export class ResponsesProvider {
  readonly model: Model<"openai-responses">;
  lastOutcome = "completed";
  private callIds = new Map<string, string>();
  constructor(
    private journal: Journal,
    private links: Links,
    private prompt: ReturnType<typeof assemblePrompt>,
    private settings: ProviderOptions,
  ) {
    const url = new URL(settings.baseUrl ?? "https://api.deepseek.com");
    if (url.username || url.password || url.search || url.hash)
      throw new Error(
        "baseUrl cannot contain credentials, query parameters, or a fragment",
      );
    this.model = {
      id: settings.model ?? "deepseek-flash",
      name: settings.model ?? "deepseek-flash",
      api: "openai-responses",
      provider: "deepseek",
      baseUrl: url.toString().replace(/\/$/, ""),
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: settings.maxOutputTokens ?? 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsDeveloperRole: false },
    };
  }
  wireCallId(callId: string): string {
    return this.callIds.get(callId) ?? callId.split("|")[0]!;
  }
  private error(message: string, aborted = false): AssistantMessage {
    return {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "deepseek",
      model: this.model.id,
      stopReason: aborted ? "aborted" : "error",
      errorMessage: this.journal.clean(message),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
  }
  readonly stream: StreamFn = (_model, piContext, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      const call = new RecordedCall(this.journal, this.links);
      const callLinks = call.links;
      try {
        this.journal.check();
        options?.signal?.throwIfAborted();
        const view = contextView(
          this.settings.contextEvents ?? this.journal.events,
          this.prompt,
        );
        await this.journal.append(
          "context.view",
          {
            revision: view.revision,
            artifact: await this.journal.artifact(JSON.stringify(view)),
          },
          callLinks,
        );
        const attempts = this.settings.maxAttempts ?? 2;
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
          throw new Error("maxAttempts must be 1..10");
        for (let attempt = 1; attempt <= attempts; attempt++) {
          this.journal.check();
          options?.signal?.throwIfAborted();
          let eventCount = 0;
          let terminal: Record<string, unknown> | undefined;
          let terminalType: string | undefined;
          let buffer = "";
          const decoder = new TextDecoder();
          const parse = (chunk: Uint8Array, final = false) => {
            buffer += decoder.decode(chunk, { stream: !final });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const data = frame
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).replace(/^ /, ""))
                .join("\n");
              if (!data) continue;
              eventCount++;
              if (eventCount > (this.settings.maxResponseEvents ?? 10000))
                throw new Error("Response event limit exceeded");
              const event = JSON.parse(data) as {
                type?: string;
                response?: Record<string, unknown>;
              };
              if (
                [
                  "response.completed",
                  "response.incomplete",
                  "response.failed",
                ].includes(event.type ?? "")
              ) {
                terminal = event.response;
                terminalType = event.type;
              }
            }
            if (final && buffer.trim())
              throw new Error("SSE ended with an incomplete frame");
          };
          const recorded = await call.attempt(this.settings, {
            purpose: this.settings.purpose ?? "task", protocol: "responses", attempt,
            model: this.model.id, adapter: "pi-responses-0.85.1/harness-1",
          }, options?.signal, view.revision, parse);
          const { signal, timeout, links } = recorded;
          const attemptId = links.attemptId!;
          const inner = responsesStream(this.model, piContext, {
            apiKey: this.settings.apiKey,
            signal,
            fetch: recorded.fetch,
            maxRetries: 0,
            maxTokens: this.model.maxTokens,
            onPayload: () => ({
              model: this.model.id,
              instructions: this.prompt.text,
              input: view.nodes.map((n) => n.item),
              tools: this.prompt.schemas,
              tool_choice: "auto",
              stream: true,
              max_output_tokens: this.model.maxTokens,
              ...(this.settings.purpose === "session-title"
                ? { reasoning: { effort: "none" } }
                : {}),
            }),
          });
          for await (const event of inner)
            if (event.type !== "done" && event.type !== "error")
              output.push(event);
          let result = await inner.result();
          this.journal.check();
          const { bytes, status, streamError } = recorded;
          const cancelled = options?.signal?.aborted === true;
          const completed =
            terminalType === "response.completed" &&
            ["stop", "toolUse"].includes(result.stopReason) &&
            !streamError &&
            !signal.aborted;
          this.lastOutcome = cancelled
            ? "cancelled"
            : terminalType === "response.incomplete"
              ? "incomplete"
              : completed
                ? "completed"
                : "failed";
          if (!completed)
            result = {
              ...result,
              stopReason: cancelled ? "aborted" : "error",
              errorMessage: this.journal.clean(
                streamError?.message ??
                  (timeout.aborted
                    ? "Model request timed out"
                    : (result.errorMessage ?? `Response ${this.lastOutcome}`)),
              ),
            };
          await recorded.finish(
            {
              status: this.lastOutcome,
              httpStatus: status,
              terminalType,
              response: terminal
                ? await this.journal.artifact(JSON.stringify(terminal))
                : undefined,
              usage: terminal?.usage,
              bytes,
              eventCount,

              error: result.errorMessage,
              costEstimateAvailable: false,
            },
          );
          if (completed) {
            const items = (terminal!.output ?? []) as WireItem[];
            const calls = items.filter((i) => i.type === "function_call");
            for (const call of result.content)
              if (call.type === "toolCall") {
                const source = calls.find(
                  (i) => i.call_id === call.id.split("|")[0],
                );
                if (!source)
                  throw new Error(
                    "Parsed tool call does not match original response evidence",
                  );
                this.callIds.set(call.id, String(source.call_id));
              }
            await this.journal.append(
              this.settings.purpose ? "auxiliary.response" : "context.add",
              { items, source: `response:${attemptId}` },
              links,
            );
            output.push({
              type: "done",
              reason: result.stopReason as "stop" | "toolUse",
              message: result,
            });
            output.end();
            return;
          }
          const retry =
            !signal.aborted &&
            !streamError &&
            attempt < attempts &&
            ([429, 500, 502, 503, 504].includes(status ?? 0) ||
              (status === undefined && bytes === 0));
          if (retry) {
            await this.journal.append(
              "attempt.retry",
              { nextAttempt: attempt + 1, reason: result.errorMessage },
              links,
            );
            await new Promise<void>((resolve, reject) => {
              const cancel = () => {
                clearTimeout(timer);
                reject(options?.signal?.reason ?? new Error("Cancelled"));
              };
              const timer = setTimeout(() => {
                options?.signal?.removeEventListener("abort", cancel);
                resolve();
              }, this.settings.retryDelayMs ?? 500);
              options?.signal?.addEventListener("abort", cancel, {
                once: true,
              });
              if (options?.signal?.aborted) cancel();
            });
            continue;
          }
          output.push({
            type: "error",
            reason: result.stopReason as "error" | "aborted",
            error: result,
          });
          output.end();
          return;
        }
      } catch (e) {
        this.lastOutcome = options?.signal?.aborted ? "cancelled" : "failed";
        const error = this.error(String(e), options?.signal?.aborted);
        output.push({
          type: "error",
          reason: error.stopReason as "error" | "aborted",
          error,
        });
        output.end();
      }
    })();
    return output;
  };
}
