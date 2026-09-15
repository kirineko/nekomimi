import { Journal, hash, id, type Links } from "./journal.js";
export interface RecordedOptions {
  fetch?: typeof globalThis.fetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
}
/** Protocol-independent request/response evidence. Parsers consume the exact captured stream. */
export class RecordedCall {
  readonly links: Links;
  constructor(
    readonly journal: Journal,
    links: Links,
  ) {
    this.links = { ...links, modelCallId: id() };
  }
  async attempt(
    options: RecordedOptions,
    metadata: Record<string, unknown>,
    signal?: AbortSignal,
    contextRevision?: string | number,
    parse?: (chunk: Uint8Array, final?: boolean) => void,
  ) {
    const value = new RecordedAttempt(
      this.journal,
      { ...this.links, attemptId: id() },
      options,
      signal,
      contextRevision,
      parse,
    );
    await this.journal.append("attempt.started", metadata, value.links);
    return value;
  }
}
export class RecordedAttempt {
  readonly started = Date.now();
  readonly abort = new AbortController();
  readonly timeout: AbortSignal;
  readonly signal: AbortSignal;
  bytes = 0;
  status?: number;
  firstByteMs?: number;
  streamError?: Error;
  constructor(
    private journal: Journal,
    readonly links: Links,
    private options: RecordedOptions,
    signal?: AbortSignal,
    private contextRevision?: string | number,
    private parse?: (chunk: Uint8Array, final?: boolean) => void,
  ) {
    this.timeout = AbortSignal.timeout(options.timeoutMs ?? 120000);
    this.signal = AbortSignal.any([
      this.abort.signal,
      this.timeout,
      journal.failure.signal,
      ...(signal ? [signal] : []),
    ]);
  }
  async finish(payload: Record<string, unknown>) {
    await this.journal.append(
      "attempt.finished",
      {
        httpStatus: this.status,
        bytes: this.bytes,
        firstByteMs: this.firstByteMs,
        elapsedMs: Date.now() - this.started,
        costEstimateAvailable: false,
        ...payload,
      },
      this.links,
    );
  }
  readonly fetch: typeof globalThis.fetch = async (url, init) => {
    this.journal.check();
    this.signal.throwIfAborted();
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
        contextRevision: this.contextRevision,
      },
      this.links,
    );
    this.journal.check();
    this.signal.throwIfAborted();
    const response = await (this.options.fetch ?? globalThis.fetch)(url, {
      ...init,
      signal: this.signal,
    });
    this.status = response.status;
    const headers = Object.fromEntries(
      ["content-type", "x-request-id", "retry-after"].flatMap((k) =>
        response.headers.has(k) ? [[k, response.headers.get(k)!]] : [],
      ),
    );
    await this.journal.append(
      "response.headers",
      { status: this.status, headers },
      this.links,
    );
    if (!response.body) return response;
    const reader = response.body.getReader();
    const onAbort = () => {
      void reader.cancel(this.signal.reason).catch(() => {});
    };
    this.signal.addEventListener("abort", onAbort, { once: true });
    if (this.signal.aborted) onAbort();
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
          this.links,
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
              this.signal.throwIfAborted();
              const next = await reader.read();
              if (next.done) {
                this.signal.removeEventListener("abort", onAbort);
                this.signal.throwIfAborted();
                const tail = await capture(new Uint8Array(), true);
                if (response.ok) this.parse?.(tail, true);
                if (tail.length) controller.enqueue(tail);
                controller.close();
                return;
              }
              this.firstByteMs ??= Date.now() - this.started;
              const remaining = Math.max(
                0,
                (this.options.maxResponseBytes ?? 16 * 1024 * 1024) -
                  this.bytes,
              );
              const kept = next.value.subarray(0, remaining);
              this.bytes += next.value.byteLength;
              const safe = await capture(kept);
              if (
                this.bytes > (this.options.maxResponseBytes ?? 16 * 1024 * 1024)
              )
                throw new Error("Response byte limit exceeded");
              if (!safe.length) continue;
              if (response.ok) this.parse?.(safe);
              controller.enqueue(safe);
              return;
            }
          } catch (e) {
            this.signal.removeEventListener("abort", onAbort);
            // Preserve the held suffix on EOF failures/cancellation, too.
            try {
              await capture(new Uint8Array(), true);
            } catch (captureError) {
              e = captureError;
            }
            this.streamError = e instanceof Error ? e : new Error(String(e));
            this.abort.abort(this.streamError);
            void reader.cancel(this.streamError).catch(() => {});
            controller.error(this.streamError);
          }
        },
        cancel: async (reason) => {
          this.signal.removeEventListener("abort", onAbort);
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
}
