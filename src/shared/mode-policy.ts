import { ApiError, type SessionMode } from "./protocol.js";

export const CREATION_TOOLS = new Set([
  "customization_validate", "customization_status", "customization_sdk", "customization_candidate",
  "customization_package", "resource_write", "customization_reload",
]);
export function modeAllows(mode: SessionMode, modes?: readonly SessionMode[]): boolean {
  return modes === undefined || modes.includes(mode);
}
export function validateModes(modes: unknown): asserts modes is SessionMode[] | undefined {
  if (modes !== undefined && (!Array.isArray(modes) || !modes.length || modes.length > 2 ||
      modes.some(mode => mode !== "work" && mode !== "create") || new Set(modes).size !== modes.length))
    throw new Error("Invalid capability modes");
}
/** HTTP host administration remains separate from ordinary command execution. */
export function creationAction(action: string): boolean {
  return action.startsWith("candidate-") || action.startsWith("package-") ||
    ["reload", "validate", "authorize-version", "user-writes"].includes(action);
}
export const modeDenial = (message: string) => new ApiError(403, "mode_permission", message);
