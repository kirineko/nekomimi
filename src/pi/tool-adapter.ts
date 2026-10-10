import { Type } from "typebox";
import { prepareToolCall, type PreparedToolCall } from "../customization/execution.js";
import type { JsonValue } from "@earendil-works/chord";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { RuntimeTool } from "../tool-contracts.js";

function details(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    if (seen.has(value)) throw new Error("Cyclic tool details");
    seen.add(value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error("Sparse tool details");
    const result = value.map(item => details(item, seen));
    seen.delete(value);
    return result;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, JsonValue> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) throw new Error("Tool details cannot contain accessors");
      if (descriptor.value !== undefined) Object.defineProperty(result, key, { value: details(descriptor.value, seen), enumerable: true });
    }
    seen.delete(value);
    return result;
  }
  throw new Error("Tool details must be JSON values");
}

/** Native intent precedes execute; product recordedTool retains the external result evidence. */
export function durableTool(tool: RuntimeTool): ToolRegistration & { prepareCall(callId: string, args: unknown, signal?: AbortSignal): Promise<Record<string, JsonValue>> } {
  const pending = new Map<string, PreparedToolCall>();
  return {
    async prepareCall(callId, args, signal) {
      if (pending.has(callId)) throw new Error("Duplicate tool preparation");
      const call = await prepareToolCall(tool, callId, args, signal);
      pending.set(callId, call);
      return call.arguments as Record<string, JsonValue>;
    },
    name: tool.name,
    description: tool.description,
    // Product schemas remain in the recorded Provider declaration. Native tasks carry an opaque argument object.
    // The common product pipeline prepares and validates the actual schema exactly once for every caller.
    parameters: Type.Object({}, { additionalProperties: true }),
    replay: "unsafe",
    executionMode: "sequential",
    async execute(args, api, context) {
      context.abortSignal?.throwIfAborted();
      const call = pending.get(api.callId);
      pending.delete(api.callId);
      if (!call || JSON.stringify(call.arguments) !== JSON.stringify(args)) throw new Error("Tool admission missing or arguments changed after admission");
      const result = await call.execute(context.abortSignal);
      return {
        content: result.content,
        details: result.details === undefined ? null : details(result.details),
        ...(result.usage ? { usage: result.usage } : {}),
        ...((result.terminate || result.addedToolNames?.length) ? { control: {
          ...(result.terminate ? { terminate: true as const } : {}),
          ...(result.addedToolNames?.length ? { addTools: result.addedToolNames } : {}),
        } } : {}),
      };
    },
  };
}
