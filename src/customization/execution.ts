import { Value } from "typebox/value";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Journal, type Links } from "../journal.js";
import { LIMITS } from "./resources.js";
class ReportedToolError extends Error {}
/** The same durable intent boundary is used by built-ins and external tools. */
export function recordedTool(
  tool: AgentTool,
  journal: Journal,
  parent: Links,
  metadata: Record<string, unknown> = {},
): AgentTool {
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const links = { ...parent, toolCallId };
      signal?.throwIfAborted();
      journal.check();
      if (!Value.Check(tool.parameters, args))
        throw new Error("Invalid tool arguments");
      await journal.append(
        "tool.intent",
        { name: tool.name, args, ...metadata },
        links,
      );
      journal.check();
      signal?.throwIfAborted();
      try {
        const value = await tool.execute(toolCallId, args, signal, onUpdate);
        const raw = JSON.stringify(value);
        const size = Buffer.byteLength(raw);
        if (size > LIMITS.result) {
          await journal.append(
            "tool.evidence_gap",
            { bytes: size, limit: LIMITS.result },
            links,
          );
          throw new Error(
            "Tool result evidence limit exceeded; result not fully retained",
          );
        }
        const artifact = await journal.artifact(raw);
        await journal.append(
          "tool.completed",
          { name: tool.name, artifact, ...metadata },
          links,
        );
        if ((value as { isError?: boolean }).isError) {
          throw new ReportedToolError(`Tool reported an error: ${raw.slice(0, LIMITS.projection)}\n[Full result: artifact:${artifact.sha256}]`);
        }
        if (size <= LIMITS.projection) return value;
        return {
          content: [
            {
              type: "text",
              text: `${raw.slice(0, LIMITS.projection)}\n[Truncated. Read artifact:${artifact.sha256} for full result.]`,
            },
          ],
          details: { artifact, truncated: true },
        } as AgentToolResult<unknown>;
      } catch (e) {
        journal.check();
        if (/RPC.*evidence.*limit/i.test(String(e))) await journal.append("tool.evidence_gap", { reason: String(e), limit: LIMITS.result }, links);
        await journal.append(
          "tool.execution_error",
          { name: tool.name, message: journal.clean(String(e)), unknown: !(e instanceof ReportedToolError) },
          links,
        );
        throw e;
      }
    },
  };
}
