import { describe, it, expect } from "vitest";
import { Journal, readArtifact, type Artifact } from "../src/journal.js";
import { executeRecordedModel, type ModelRequest } from "../src/pi/model-service.js";
import { temporary } from "./helpers.js";
import { RecordedCall } from "../src/recorded-call.js";

const request = (overrides: Partial<ModelRequest<unknown>> = {}): ModelRequest<unknown> => ({
  url: "http://127.0.0.1/model", body: '{"input":"fixed","tools":[]}', provider: "fixture", model: "fixture-chat",
  protocol: "fixture-json", purpose: "work", operation: "chat", contextRevision: "context-1",
  links: { runId: "run-1", frameworkTaskId: 9, conversationId: 1, mode: "work", targetId: "project-1" },
  decode: response => response.json(), ...overrides,
});
async function evidence(journal: Journal): Promise<string> {
  const chunks = journal.events.filter(event => event.type === "response.chunk");
  const bytes = await Promise.all(chunks.map(event => readArtifact(journal.directory, (event.payload as { artifact: Artifact }).artifact)));
  return Buffer.concat(bytes).toString();
}
describe("Durable recorded model service", () => {
  it("rejects a second dispatch using the same attempt identity", async () => {
    const journal = await Journal.open(await temporary()); let calls = 0;
    try {
      const attempt = await new RecordedCall(journal, {}).attempt({ fetch: async () => {
        calls++; return Response.json({ ok: true });
      } }, { purpose: "test" });
      const response = await attempt.fetch("http://127.0.0.1/model", { method: "POST", body: "{}" });
      await response.json();
      await expect(attempt.fetch("http://127.0.0.1/model", { method: "POST", body: "{}" })).rejects.toThrow("already dispatched");
      expect(calls).toBe(1);
      expect(journal.events.filter(event => event.type === "request.dispatched")).toHaveLength(1);
      await attempt.finish({ outcome: "completed" });
    } finally { await journal.close(); }
  });
  it("does not publish a value cancelled while the completed attempt is being committed", async () => {
    const controller = new AbortController();
    const journal = await Journal.open(await temporary(), { beforeIO: async operation => {
      if (operation === "sync" && journal.events.at(-1)?.type === "attempt.finished")
        controller.abort(new Error("cancelled during commit"));
    } });
    try {
      await expect(executeRecordedModel(journal, request({ signal: controller.signal,
        transport: { fetch: async () => Response.json({ answer: "complete" }) },
      }))).rejects.toThrow("cancelled during commit");
      const finished = journal.events.filter(event => event.type === "attempt.finished");
      expect(finished).toHaveLength(1);
      expect((finished[0]!.payload as { outcome: string }).outcome).toBe("completed");
      expect(finished[0]!.seq).toBe(journal.durableSeq);
    } finally { await journal.close(); }
  });
  it("records frozen request bytes and non-streaming responses with the framework task identity", async () => {
    const journal = await Journal.open(await temporary(), { secrets: ["fixture-key"] });
    try {
      const output = await executeRecordedModel(journal, request({ headers: { authorization: "Bearer fixture-key" }, transport: { fetch: async (_url, init) => {
        const event = journal.events.find(event => event.type === "request.dispatched")!;
        expect(event.seq).toBeLessThanOrEqual(journal.durableSeq);
        expect((await readArtifact(journal.directory, (event.payload as { body: Artifact }).body)).toString()).toBe(init!.body);
        expect(event.frameworkTaskId).toBe(9); expect(event.targetId).toBe("project-1");
        return Response.json({ answer: "complete" });
      } } }));
      expect(output.value).toEqual({ answer: "complete" });
      expect(await evidence(journal)).toBe('{"answer":"complete"}');
      expect(JSON.stringify(journal.events)).not.toContain("fixture-key");
      expect(journal.events.at(-1)?.type).toBe("attempt.finished");
      expect(journal.events.at(-1)!.seq).toBe(journal.durableSeq);
    } finally { await journal.close(); }
  });

  it("records each rate-limited attempt and does not retry transport errors of unknown outcome", async () => {
    const journal = await Journal.open(await temporary()); let calls = 0;
    try {
      const result = await executeRecordedModel(journal, request({ maxAttempts: 3, retryDelayMs: 0, transport: { fetch: async () => {
        calls++; return calls === 1 ? new Response("rate limited", { status: 429 }) : Response.json({ ok: true });
      } } }));
      expect(result.attempts).toBe(2);
      const attempts = journal.events.filter(event => event.type === "attempt.started");
      expect(new Set(attempts.map(event => event.attemptId)).size).toBe(2);
      expect(new Set(attempts.map(event => event.modelCallId)).size).toBe(1);
      let unknownCalls = 0;
      await expect(executeRecordedModel(journal, request({ maxAttempts: 3, transport: { fetch: async () => {
        unknownCalls++; throw new Error("connection lost after dispatch");
      } } }))).rejects.toThrow("connection lost");
      expect(unknownCalls).toBe(1);
    } finally { await journal.close(); }
  });

  it("does not retry after cancellation during backoff", async () => {
    const journal = await Journal.open(await temporary()); const controller = new AbortController(); let calls = 0;
    try {
      await expect(executeRecordedModel(journal, request({ signal: controller.signal, maxAttempts: 3, retryDelayMs: 1000,
        transport: { fetch: async () => { calls++; queueMicrotask(() => controller.abort(new Error("cancelled"))); return new Response("rate limited", { status: 429 }); } },
      }))).rejects.toThrow("cancelled");
      expect(calls).toBe(1);
    } finally { await journal.close(); }
  });

  it("applies disk backpressure before consuming additional raw chunks", async () => {
    let pause = false; let entered!: () => void; let release!: () => void;
    const blocked = new Promise<void>(resolve => entered = resolve);
    const resumed = new Promise<void>(resolve => release = resolve);
    const journal = await Journal.open(await temporary(), { beforeIO: async operation => {
      if (pause && operation === "artifact") { entered(); await resumed; }
    } });
    let reads = 0;
    try {
      const result = executeRecordedModel(journal, request({ decode: async response => {
        pause = true; return response.text();
      }, transport: { fetch: async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          reads++;
          if (reads <= 3) controller.enqueue(new TextEncoder().encode(`chunk-${reads}`));
          else controller.close();
        },
      }, { highWaterMark: 0 })) } }));
      await blocked;
      expect(reads).toBe(1);
      pause = false; release();
      expect((await result).value).toBe("chunk-1chunk-2chunk-3");
      expect(await evidence(journal)).toBe("chunk-1chunk-2chunk-3");
    } finally { release(); await journal.close(); }
  });

  it("rejects an early-return decoder without publishing model success", async () => {
    const journal = await Journal.open(await temporary());
    try {
      await expect(executeRecordedModel(journal, request({ decode: async response => {
        const reader = response.body!.getReader(); await reader.read(); return "premature";
      }, transport: { fetch: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("first")); },
      })) } }))).rejects.toThrow("complete response");
      expect((journal.events.at(-1)!.payload as { outcome: string }).outcome).toBe("failed");
    } finally { await journal.close(); }
  });

  it("rejects a response arriving after cancellation without another dispatch or successful outcome", async () => {
    const journal = await Journal.open(await temporary()); const controller = new AbortController(); let calls = 0;
    try {
      await expect(executeRecordedModel(journal, request({ signal: controller.signal, maxAttempts: 3,
        transport: { fetch: async () => {
          calls++; controller.abort(new Error("late response cancelled"));
          return Response.json({ answer: "too late" });
        } },
      }))).rejects.toThrow("late response cancelled");
      expect(calls).toBe(1);
      expect(journal.events.filter(event => event.type === "attempt.started")).toHaveLength(1);
      expect((journal.events.at(-1)!.payload as { outcome: string }).outcome).toBe("cancelled");
    } finally { await journal.close(); }
  });

  it("preserves evidence gaps and rejects secrets split across chunks", async () => {
    const journal = await Journal.open(await temporary(), { secrets: ["fixture-key"] });
    try {
      await expect(executeRecordedModel(journal, request({ decode: response => response.text(), transport: { fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("fixture-")); controller.enqueue(new TextEncoder().encode("key")); controller.close();
        },
      })) } }))).rejects.toThrow("Credential detected");
      expect(await evidence(journal)).toContain("[REDACTED]");
      expect(await evidence(journal)).not.toContain("fixture-key");
      await expect(executeRecordedModel(journal, request({ decode: response => response.text(), transport: { maxResponseBytes: 4,
        fetch: async () => new Response("too much response"),
      } }))).rejects.toThrow("byte limit");
    } finally { await journal.close(); }
  });
});
