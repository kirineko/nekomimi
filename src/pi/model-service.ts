import { assertPhysicalRouting } from "../model-routing.js";
import { Journal, type Links } from "../journal.js";
import { RecordedCall, retryableModelStatus, type RecordedOptions } from "../recorded-call.js";

export type ModelOperation = "chat" | "classifier" | "image";
export type ModelPurpose = "work" | "create" | "compaction" | "session-title" | "handoff" | "extension";
export interface ModelRequest<T> {
  readonly routing?: "physical";
  readonly url: string;
  /** Serialization is finished before admission; the transport sends exactly these bytes. */
  readonly body: string;
  readonly headers?: HeadersInit;
  readonly provider: string;
  readonly model: string;
  readonly protocol: string;
  readonly purpose: ModelPurpose;
  readonly operation: ModelOperation;
  readonly contextRevision: string | number;
  readonly links: Links;
  readonly signal?: AbortSignal;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly transport?: RecordedOptions;
  readonly decode: (response: Response) => Promise<T>;
}
export interface ModelResult<T> {
  readonly value: T;
  readonly modelCallId: string;
  readonly attemptId: string;
  readonly attempts: number;
}
function check(journal: Journal, signal?: AbortSignal): void {
  journal.check(); signal?.throwIfAborted();
}
async function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(signal.reason); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
/** Protocol adapters use this transport; Durable generations and auxiliary operations share one evidence entry. */
export async function executeRecordedModel<T>(journal: Journal, request: ModelRequest<T>): Promise<ModelResult<T>> {
  assertPhysicalRouting(request.routing);
  check(journal, request.signal);
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error("Invalid model transport URL");
  if (typeof request.body !== "string") throw new Error("Model body must be frozen JSON text");
  const maxAttempts = request.maxAttempts ?? 1;
  const retryDelay = request.retryDelayMs ?? 1000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || !Number.isFinite(retryDelay) || retryDelay < 0)
    throw new Error("Invalid model retry budget");
  // Own every mutable input before asynchronous persistence. Decoder is an adapter-owned function.
  const body = request.body;
  const decode = request.decode;
  const headers = new Headers(request.headers);
  const transport = { ...request.transport };
  const metadata = { provider: request.provider, model: request.model, protocol: request.protocol,
    purpose: request.purpose, operation: request.operation, adapterRevision: "durable-recorded-model-1" };
  const revision = request.contextRevision;
  const signal = AbortSignal.any([journal.failure.signal, ...(request.signal ? [request.signal] : [])]);
  const call = new RecordedCall(journal, { ...request.links });
  for (let index = 1; index <= maxAttempts; index++) {
    check(journal, signal);
    const attempt = await call.attempt(transport, { ...metadata, attempt: index }, signal, revision);
    let finished = false;
    try {
      const response = await attempt.fetch(url.href, { method: "POST", headers, body });
      if (!response.ok) {
        // Drain error responses through raw evidence, including non-streaming HTTP errors.
        await response.arrayBuffer();
        check(journal, attempt.signal);
        await attempt.finish({ outcome: "http-error", ...metadata });
        finished = true;
        if (retryableModelStatus(response.status) && index < maxAttempts) {
          await journal.append("attempt.retry", { nextAttempt: index + 1, reason: `HTTP ${response.status}` }, call.links);
          await delay(retryDelay, signal);
          continue;
        }
        throw new Error(`Model HTTP ${response.status}`);
      }
      const value = await decode(response);
      // A decoder that leaves raw evidence incomplete cannot publish a successful model result.
      if (response.body && !response.bodyUsed) await response.arrayBuffer();
      if (!attempt.responseComplete) throw new Error("Model decoder did not consume the complete response");
      check(journal, attempt.signal);
      await attempt.finish({ outcome: "completed", ...metadata });
      finished = true;
      // The network attempt may finish while cancellation arrives during its durable commit.
      // Preserve that fact, but do not publish its value into a cancelled generation.
      check(journal, signal);
      return { value, modelCallId: call.links.modelCallId!, attemptId: attempt.links.attemptId!, attempts: index };
    } catch (error) {
      try { await attempt.cancelResponse(error); } catch (cleanupError) { error = cleanupError; }
      // Capture dispatch/read/parse/abort failure once; unknown transport errors are never retried automatically.
      if (!finished && !journal.failure.signal.aborted) {
        await attempt.finish({ outcome: signal.aborted ? "cancelled" : "failed", error: journal.clean(String(error)), ...metadata });
      }
      throw error;
    }
  }
  throw new Error("Model retry budget exhausted");
}
