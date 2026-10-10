import { Value } from "typebox/value";
import type { RuntimeTool, RuntimeToolResult } from "../tool-contracts.js";
import { Journal, hash, type Links } from "../journal.js";
import { LIMITS } from "./resources.js";
import { saveToolProjection } from "../tool-result-projection.js";
export interface ToolPolicy {
  readonly revision: string;
  before(name: string, args: Record<string, unknown>): Promise<string | undefined>;
  revalidate?(name: string, args: Readonly<Record<string, unknown>>): Promise<void>;
  after(name: string, args: Record<string, unknown>, result: RuntimeToolResult & { isError?: boolean }): Promise<void>;
}
export interface PreparedToolCall {
  readonly arguments: Record<string, unknown>;
  execute(signal?: AbortSignal, onUpdate?: (result: RuntimeToolResult) => void): Promise<RuntimeToolResult>;
}
interface Binding {
  policy?: ToolPolicy;
  prepare(callId: string, args: unknown, signal?: AbortSignal): Promise<PreparedToolCall>;
}
const bindings = new WeakMap<RuntimeTool, Binding>();
/** Bound once per captured run; direct, SDK, and script callers use the same wrapper. */
export function bindToolPolicy(tool: RuntimeTool, policy: ToolPolicy, journal: Journal, parent: Links): RuntimeTool {
  const wrapped = bindings.has(tool) ? tool : recordedTool(tool, journal, parent);
  bindings.get(wrapped)!.policy = Object.freeze({ ...policy });
  return wrapped;
}
/** The native bridge prepares before its own intent, then consumes this exact admitted call. */
export function prepareToolCall(tool: RuntimeTool, callId: string, args: unknown, signal?: AbortSignal): Promise<PreparedToolCall> {
  const binding = bindings.get(tool);
  if (!binding) throw new Error("Tool must use the recorded execution pipeline");
  return binding.prepare(callId, args, signal);
}
export class ReportedToolError extends Error {
  constructor(message:string,readonly result:RuntimeToolResult & {isError:true}) { super(message); }
}
function freezeSchema<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeSchema(child); Object.freeze(value); }
  return value;
}
/** A shared preparation, durable intent, executor and observational result boundary. */
export function recordedTool(tool: RuntimeTool, journal: Journal, parent: Links, metadata: Record<string, unknown> = {}): RuntimeTool {
  const name = tool.name;
  const parameters = freezeSchema(structuredClone(tool.parameters));
  const prepareArguments = tool.prepareArguments?.bind(tool);
  const executor = tool.execute.bind(tool);
  const capturedMetadata = structuredClone(metadata);
  const schemaHash = hash(JSON.stringify(parameters));
  const binding: Binding = {
    async prepare(toolCallId, args, signal) {
      return journal.withLinks({ ...parent, toolCallId }, async () => {
        const links = journal.links(), policy = binding.policy;
        signal?.throwIfAborted(); journal.check();
        let prepared: Record<string, unknown>;
        try {
          const candidate: unknown = structuredClone(prepareArguments ? prepareArguments(args) : args);
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !Value.Check(parameters, candidate)) throw new Error("Invalid tool arguments");
          prepared = candidate as Record<string, unknown>;
          const reason = await policy?.before(name, structuredClone(prepared));
          if (reason) throw new Error(reason);
        } catch (error) {
          await journal.append("tool.blocked", { name, message: journal.clean(String(error)), schemaHash, capabilityRevision: policy?.revision }, links);
          throw error;
        }
        let consumed = false;
        return {
          arguments: freezeSchema(structuredClone(prepared)),
          execute: (executionSignal, onUpdate) => journal.withLinks(links, async () => {
            if (consumed) throw new Error("Prepared tool call has already been consumed");
            consumed = true;
            const activeSignal = signal && executionSignal ? AbortSignal.any([signal, executionSignal]) : signal ?? executionSignal;
            journal.check(); activeSignal?.throwIfAborted();
            const observe = async (result: RuntimeToolResult & { isError?: boolean }) => {
              try { await policy?.after(name, structuredClone(prepared), structuredClone(result)); }
              catch (error) { journal.check(); await journal.append("tool.observer_error", { name, message: journal.clean(String(error)) }, links); }
            };
            const revalidate = async (phase: "before-intent" | "before-execute") => {
              try { await policy?.revalidate?.(name, freezeSchema(structuredClone(prepared))); }
              catch (error) {
                await journal.append("tool.blocked", { name, message: journal.clean(String(error)), reason: "execution-revalidation", phase, schemaHash, capabilityRevision: policy?.revision }, links);
                if (phase === "before-execute") await journal.append("tool.execution_error", { name, message: journal.clean(String(error)), unknown: false, effect: "not-dispatched" }, links);
                throw error;
              }
              journal.check(); activeSignal?.throwIfAborted();
            };
            await revalidate("before-intent");
            await journal.append("tool.intent", { name, args: prepared, schemaHash, capabilityRevision: policy?.revision, ...capturedMetadata }, links);
            journal.check(); activeSignal?.throwIfAborted();
            await revalidate("before-execute");
            try {
              const value = await executor(toolCallId, structuredClone(prepared), activeSignal, onUpdate);
              const raw = JSON.stringify(value), size = Buffer.byteLength(raw);
              if (size > LIMITS.result) {
                await journal.append("tool.evidence_gap", { bytes: size, limit: LIMITS.result }, links);
                throw new Error("Tool result evidence limit exceeded; result not fully retained");
              }
              const safe = JSON.parse(journal.clean(raw)) as RuntimeToolResult & {isError?:boolean};
              const artifact = await journal.artifact(JSON.stringify(safe));
              await journal.append("tool.completed", { name, artifact, ...capturedMetadata }, links);
              const projected = await saveToolProjection(journal, safe, artifact);
              if (safe.isError) throw new ReportedToolError(`Tool reported an error: ${projected.content.filter(item => item.type === "text").map(item => item.text).join("\n")}\n[Full result: artifact:${artifact.sha256}]`, {...projected,isError:true});
              await observe(projected);
              return projected;
            } catch (error) {
              journal.check();
              if (/RPC.*evidence.*limit/i.test(String(error))) await journal.append("tool.evidence_gap", { reason: String(error), limit: LIMITS.result }, links);
              await journal.append("tool.execution_error", { name, message: journal.clean(String(error)), unknown: !(error instanceof ReportedToolError) }, links);
              await observe({ content: [{ type: "text", text: journal.clean(String(error)) }], details: {}, isError: true });
              throw error;
            }
          }),
        };
      });
    },
  };
  const wrapped: RuntimeTool = { ...tool, parameters, async execute(callId, args, signal, onUpdate) {
    return (await binding.prepare(callId, args, signal)).execute(signal, onUpdate);
  } };
  bindings.set(wrapped, binding);
  return wrapped;
}
