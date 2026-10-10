import { describe, it, expect } from "vitest";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { HarnessInspection, ConversationId, TaskId, SubmissionId } from "@earendil-works/pi-durable";
import { inspectRecovery, prepareExplicitContinuation } from "../src/pi/recovery.js";
import { Journal } from "../src/journal.js";
import { temporary } from "./helpers.js";

function fixture(kind = "pi.tool", scheduling: HarnessInspection["scheduling"] = "paused") {
  const order: string[] = [];
  const inspection: HarnessInspection = { scheduling, tasks: [{
    record: { id: 12 as TaskId<JsonValue>, conversationId: 1 as ConversationId, kind, version: 1,
      input: { callId: "unknown-call" }, background: false, abortRequested: false,
      state: { status: "pending", checkpoint: { phase: "execute", replay: "safe" } } },
    state: { kind: "ready", migrates: false },
  }], submissions: [{ id: 13 as SubmissionId, conversationId: 1 as ConversationId, requestId: "old-queued", type: "input", status: "queued" }] };
  const harness: Parameters<typeof inspectRecovery>[0] = {
    inspect: async () => { order.push("inspect"); return inspection; },
    abortTask: async id => { order.push(`abort-task:${id}`); return "marked"; },
    abortSubmission: async id => { order.push(`abort-submission:${id}`); return "aborted"; },
    waitForIdle: async () => { order.push("progress"); },
  };
  return { order, harness };
}
describe("Durable recovery gate", () => {
  it("only inspects when reading recovery, including replay-safe unknown tools", async () => {
    const { harness, order } = fixture();
    expect((await inspectRecovery(harness, context)).unknownTools).toEqual([
      { frameworkTaskId: 12, conversationId: 1, toolCallId: "unknown-call" },
    ]);
    expect(order).toEqual(["inspect"]);
  });
  it("persists unknown and withdraws queued input before marking old tasks and enabling progress", async () => {
    const journal = await Journal.open(await temporary());
    const { harness, order } = fixture();
    const progress = harness.waitForIdle;
    harness.waitForIdle = async c => {
      expect(journal.events.some(event => event.type === "tool.unknown" && event.seq <= journal.durableSeq)).toBe(true);
      await progress(c);
    };
    try {
      await prepareExplicitContinuation(harness, journal, context);
      expect(order).toEqual(["inspect", "abort-submission:13", "abort-task:12", "progress"]);
      await prepareExplicitContinuation(harness, journal, context);
      expect(journal.events.filter(event => event.type === "tool.unknown")).toHaveLength(1);
    } finally { await journal.close(); }
  });
  it.each(["custom.background", "custom.validation"])("does not run unverified custom abort handlers for %s", async kind => {
    const journal = await Journal.open(await temporary()); const { harness, order } = fixture(kind);
    try {
      await expect(prepareExplicitContinuation(harness, journal, context)).rejects.toThrow("verified cancellation adapter");
      expect(order).toEqual(["inspect"]);
      expect(journal.events).toHaveLength(0);
    } finally { await journal.close(); }
  });
  it("rejects an already enabled scheduler instead of racing recovery against dispatch", async () => {
    const journal = await Journal.open(await temporary()); const { harness, order } = fixture("pi.tool", "running");
    try {
      await expect(prepareExplicitContinuation(harness, journal, context)).rejects.toThrow("newly opened");
      expect(order).toEqual(["inspect"]);
    } finally { await journal.close(); }
  });
  it("does not enable scheduling when an unknown record cannot be committed", async () => {
    const journal = await Journal.open(await temporary(), { beforeIO: async op => { if (op === "append") throw new Error("disk full"); } });
    const { harness, order } = fixture();
    try {
      await expect(prepareExplicitContinuation(harness, journal, context)).rejects.toThrow("disk full");
      expect(order).toEqual(["inspect"]);
    } finally { await journal.close(); }
  });
  it("stops before another operation when cancellation arrives during recovery", async () => {
    const journal = await Journal.open(await temporary()); const { harness, order } = fixture();
    const controller = new AbortController();
    const abort = harness.abortSubmission;
    harness.abortSubmission = async (...args) => { const result = await abort(...args); controller.abort(new Error("cancelled")); return result; };
    try {
      await expect(prepareExplicitContinuation(harness, journal, context, controller.signal)).rejects.toThrow("cancelled");
      expect(order).toEqual(["inspect", "abort-submission:13"]);
    } finally { await journal.close(); }
  });
});
