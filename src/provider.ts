import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import { stream as responsesStream } from "@earendil-works/pi-ai/api/openai-responses";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { Journal, hash, id, type Links } from "./journal.js";
import { contextView, type assemblePrompt, type WireItem } from "./context.js";

export interface ProviderOptions {
  apiKey: string;
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
      const modelCallId = id();
      const callLinks = { ...this.links, modelCallId };
      try {
        this.journal.check();
        options?.signal?.throwIfAborted();
        const view = contextView(this.journal.events, this.prompt);
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
          const attemptId = id();
          const links = { ...callLinks, attemptId };
          const started = Date.now();
          const abort = new AbortController();
          const timeout = AbortSignal.timeout(
            this.settings.timeoutMs ?? 120000,
          );
          const signal = AbortSignal.any([
            abort.signal,
            timeout,
            this.journal.failure.signal,
            ...(options?.signal ? [options.signal] : []),
          ]);
          let bytes = 0;
          let eventCount = 0;
          let status: number | undefined;
          let firstByteMs: number | undefined;
          let terminal: Record<string, unknown> | undefined;
          let terminalType: string | undefined;
          let streamError: Error | undefined;
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
          await this.journal.append(
            "attempt.started",
            {
              attempt,
              model: this.model.id,
              adapter: "pi-responses-0.85.1/harness-1",
            },
            links,
          );
          const captureFetch: typeof globalThis.fetch = async (url, init) => {
            this.journal.check();
            signal.throwIfAborted();
            if (typeof init?.body !== "string")
              throw new Error("Transport body must be frozen JSON text");
            const body = init.body;
            if (body !== this.journal.clean(body))
              throw new Error(
                "Request body contains a configured credential; request not sent",
              );
            if (Buffer.byteLength(body) > 32 * 1024 * 1024)
              throw new Error("Request byte limit exceeded");
            const request = await this.journal.artifact(body);
            await this.journal.append(
              "request.dispatched",
              {
                url: String(url),
                body: request,
                bodyHash: hash(body),
                contextRevision: view.revision,
              },
              links,
            );
            this.journal.check();
            signal.throwIfAborted();
            const response = await (this.settings.fetch ?? globalThis.fetch)(
              url,
              { ...init, signal },
            );
            status = response.status;
            const headers = Object.fromEntries(
              ["content-type", "x-request-id", "retry-after"].flatMap((k) =>
                response.headers.has(k) ? [[k, response.headers.get(k)!]] : [],
              ),
            );
            await this.journal.append(
              "response.headers",
              { status, headers },
              links,
            );
            if (!response.body) return response;
            const reader = response.body.getReader();
            const redactor = this.journal.streamRedactor();
            let capturedBytes = 0;
            const capture = async (chunk: Uint8Array, final = false) => {
              const safe = redactor.push(chunk, final);
              if (safe.bytes.length) {
                const artifact = await this.journal.artifact(safe.bytes);
                if (safe.redacted) artifact.redacted = true;
                await this.journal.append(
                  "response.chunk",
                  { artifact, offset: capturedBytes },
                  links,
                  false,
                );
                capturedBytes += safe.bytes.length;
                if (artifact.redacted)
                  throw new Error(
                    "Credential detected in response; evidence redacted and call stopped",
                  );
              }
              return safe.bytes;
            };
            const stream = new ReadableStream<Uint8Array>(
              {
                pull: async (controller) => {
                  try {
                    while (true) {
                      this.journal.check();
                      signal.throwIfAborted();
                      const next = await reader.read();
                      if (next.done) {
                        const tail = await capture(new Uint8Array(), true);
                        if (response.ok) parse(tail, true);
                        if (tail.length) controller.enqueue(tail);
                        controller.close();
                        return;
                      }
                      firstByteMs ??= Date.now() - started;
                      const remaining = Math.max(
                        0,
                        (this.settings.maxResponseBytes ?? 16 * 1024 * 1024) -
                          bytes,
                      );
                      const kept = next.value.subarray(0, remaining);
                      bytes += next.value.byteLength;
                      const safe = await capture(kept);
                      if (
                        bytes >
                        (this.settings.maxResponseBytes ?? 16 * 1024 * 1024)
                      )
                        throw new Error("Response byte limit exceeded");
                      if (!safe.length) continue;
                      if (response.ok) parse(safe);
                      controller.enqueue(safe);
                      return;
                    }
                  } catch (e) {
                    // Preserve the held suffix on EOF failures/cancellation, too.
                    try {
                      await capture(new Uint8Array(), true);
                    } catch (captureError) {
                      e = captureError;
                    }
                    streamError = e instanceof Error ? e : new Error(String(e));
                    abort.abort(streamError);
                    void reader.cancel(streamError).catch(() => {});
                    controller.error(streamError);
                  }
                },
                cancel: async (reason) => {
                  await reader.cancel(reason);
                  await capture(new Uint8Array(), true);
                },
              },
              { highWaterMark: 0 },
            );
            return new Response(stream, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          };
          const inner = responsesStream(this.model, piContext, {
            apiKey: this.settings.apiKey,
            signal,
            fetch: captureFetch,
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
            }),
          });
          for await (const event of inner)
            if (event.type !== "done" && event.type !== "error")
              output.push(event);
          let result = await inner.result();
          this.journal.check();
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
          await this.journal.append(
            "attempt.finished",
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
              firstByteMs,
              elapsedMs: Date.now() - started,
              error: result.errorMessage,
              costEstimateAvailable: false,
            },
            links,
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
              "context.add",
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
