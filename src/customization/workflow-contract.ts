import type { WorkflowDefinition, WorkflowContext, StepOutcome } from "./contracts.js";
import type { ProcessContext } from "./process.js";
import type { Resource } from "./resources.js";
import type { Json } from "./types.js";
export interface WorkflowDescriptor extends Omit<WorkflowDefinition, "steps"> { steps: Record<string, { transitions: string[] }> }
export interface RegisteredWorkflow extends WorkflowDescriptor {
  resource: Resource;
  execute(step: string, input: Json, context: ProcessContext & WorkflowContext): Promise<StepOutcome>;
}
export function validateWorkflow(value: WorkflowDescriptor) {
  const name = (v: unknown) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,47}$/.test(v);
  if (!value || !name(value.id) || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 1 || !value.inputSchema || value.inputSchema.type !== "object" || !value.steps || typeof value.steps !== "object" || Array.isArray(value.steps) || !Object.hasOwn(value.steps, value.entry) || !Object.keys(value.steps).length || Object.keys(value.steps).length > 64) throw new Error("Invalid workflow definition");
  for (const [step, spec] of Object.entries(value.steps)) if (!name(step) || !spec || !Array.isArray(spec.transitions) || spec.transitions.length > 64 || spec.transitions.some(t => !Object.hasOwn(value.steps, t))) throw new Error("Invalid workflow step/transition");
  if (value.triggers && (!Array.isArray(value.triggers) || value.triggers.length > 16 || value.triggers.some(t => !["command", "run-completed", "tool-completed"].includes(t.kind) || (t.name !== undefined && !name(t.name))))) throw new Error("Invalid workflow trigger");
}
