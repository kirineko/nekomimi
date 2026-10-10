import type { Context } from "@earendil-works/chord";
import type { Harness, HarnessInspection, TaskId } from "@earendil-works/pi-durable";
import { Journal } from "../journal.js";

type RecoveryHarness = Pick<Harness, "inspect" | "abortTask" | "abortSubmission" | "waitForIdle">;
export interface UnknownTool {
  readonly frameworkTaskId: number;
  readonly conversationId: number;
  readonly toolCallId: string;
}
export interface RecoveryView {
  readonly inspection: HarnessInspection;
  readonly unknownTools: readonly UnknownTool[];
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** Observation never calls a progress-enabling Harness operation. */
export async function inspectRecovery(harness: RecoveryHarness, context: Context): Promise<RecoveryView> {
  const inspection = await harness.inspect(context);
  const unknownTools = inspection.tasks.flatMap(({ record }) => {
    const checkpoint = "checkpoint" in record.state ? object(record.state.checkpoint) : undefined;
    const input = object(record.input);
    if (record.kind !== "pi.tool" || checkpoint?.phase !== "execute") return [];
    if (typeof input?.callId !== "string") throw new Error("Invalid recovered tool identity");
    return [{ frameworkTaskId: record.id, conversationId: record.conversationId, toolCallId: input.callId }];
  });
  return { inspection, unknownTools };
}
/** Call only after a new explicit user command, before accepting its input into the scheduler. */
export async function prepareExplicitContinuation(
  harness: RecoveryHarness,
  journal: Journal,
  context: Context,
  signal?: AbortSignal,
): Promise<RecoveryView> {
  const check = () => { journal.check(); signal?.throwIfAborted(); };
  check();
  const view = await inspectRecovery(harness, context);
  // A custom abort handler may have effects. Never start unverified code merely to restore a session.
  const supported = new Set(["pi.generation", "pi.tool", "pi.compaction"]);
  if (view.inspection.tasks.some(task => !supported.has(task.record.kind)))
    throw new Error("Recovery of custom Durable tasks requires a verified cancellation adapter");
  if (view.inspection.scheduling !== "paused" || view.inspection.tasks.some(task => task.state.kind === "running"))
    throw new Error("Recovery requires an idle, newly opened Durable harness");
  for (const tool of view.unknownTools) {
    check();
    if (!journal.events.some(event => event.type === "tool.unknown" && object(event.payload)?.frameworkTaskId === tool.frameworkTaskId)) {
      const prior = journal.events.find(event => event.frameworkTaskId === tool.frameworkTaskId && event.toolCallId === tool.toolCallId);
      await journal.append("tool.unknown", { ...tool, reason: "result-not-committed" }, {
        toolCallId: tool.toolCallId, frameworkTaskId: tool.frameworkTaskId, conversationId: tool.conversationId,
        runId: prior?.runId, modelCallId: prior?.modelCallId, attemptId: prior?.attemptId, parentToolCallId: prior?.parentToolCallId,
      });
    }
  }
  // Withdraw previously queued inputs before enabling any progress operation.
  for (const submission of view.inspection.submissions) {
    if (submission.status !== "queued") continue;
    check();
    await harness.abortSubmission(submission.id, context, submission.conversationId);
  }
  // abortTask marks do not enable scheduling; root.abort(), submit(), and wait methods do.
  for (const task of view.inspection.tasks) {
    check();
    await harness.abortTask(task.record.id as TaskId, context);
  }
  check();
  await harness.waitForIdle(context);
  check();
  return view;
}
