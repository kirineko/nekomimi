/** Public, JSON-based contracts. No runtime/framework objects cross this boundary. */
export const SDK_VERSION = 1 as const;
export const CAPABILITIES = [
  "tools",
  "commands",
  "hooks",
  "state",
  "model",
  "ui",
  "follow-up",
  "providers",
  "workflows",
  "workspace-state",
  "panels",
] as const;
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type ResourceKind = "extension" | "skill" | "rule" | "mcp" | "doc" | "provider" | "workflow" | "panel";
export interface ResourceDescriptor {
  id: string;
  kind: ResourceKind;
  name: string;
  source: string;
  scope: "project" | "user" | "builtin";
  hash: string;
  status:
    | "available"
    | "enabled"
    | "disabled"
    | "untrusted"
    | "shadowed"
    | "error";
  description?: string;
  error?: string;
  shadowedBy?: string;
}
export interface ResourceSnapshot {
  version: 1;
  revision: string;
  resources: ResourceDescriptor[];
}
export interface ExtensionManifest {
  name: string;
  sdkVersion: number;
  entry: string;
  requiredCapabilities?: string[];
}
export interface ToolResult {
  content: Content[];
  details?: Json;
  isError?: boolean;
}
export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
export interface FormField {
  name: string;
  label: string;
  required?: boolean;
  options?: string[];
}
export interface Contribution {
  kind: "status" | "card" | "form" | "panel";
  panelId?: string;
  props?: Json;
  title: string;
  text?: string;
  fields?: FormField[];
}
export interface ExtensionContext {
  readonly workspace: string;
  readonly signal: AbortSignal;
  readonly resourceId: string;
  callTool(name: string, args: Record<string, Json>): Promise<ToolResult>;
  model(prompt: string): Promise<string>;
  state: {
    get(key: string, version: number): Promise<Json | undefined>;
    set(key: string, version: number, value: Json): Promise<void>;
  };
  ui(value: Contribution): Promise<Json>;
  contribute(text: string): Promise<void>;
  followUp(prompt: string): void;
  reload(): { id: string; status: string };
}
export interface ExtensionTool {
  name: string;
  description: string;
  parameters: { type: "object" } & Record<string, Json>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute(
    args: Record<string, Json>,
    ctx: ExtensionContext,
  ): Promise<ToolResult>;
}
export interface ExtensionCommand {
  description: string;
  handler(args: string, ctx: ExtensionContext): Promise<string | void>;
}
export type Hook = "beforeRun" | "beforeTool" | "afterTool" | "afterRun";
export interface HookEvent {
  tool?: string;
  args?: Record<string, Json>;
  result?: ToolResult;
}
export interface ExtensionAPI {
  registerTool(tool: ExtensionTool): void;
  registerCommand(name: string, command: ExtensionCommand): void;
  on(
    event: Hook,
    handler: (
      event: HookEvent,
      ctx: ExtensionContext,
    ) => Promise<void | { block: string }>,
  ): void;
  onDispose(handler: () => Promise<void> | void): void;
}
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;
export function checkManifest(value: unknown): ExtensionManifest {
  const m = value as ExtensionManifest;
  if (
    !m ||
    typeof m.name !== "string" ||
    !/^[a-z][a-z0-9-]{0,47}$/.test(m.name) ||
    ![1, 2].includes(m.sdkVersion) ||
    typeof m.entry !== "string"
  )
    throw new Error("Invalid extension manifest or unsupported sdkVersion");
  if (
    m.requiredCapabilities !== undefined &&
    (!Array.isArray(m.requiredCapabilities) ||
      m.requiredCapabilities.some(
        (c) => !(CAPABILITIES as readonly string[]).includes(c),
      ))
  )
    throw new Error(
      `Unsupported capabilities: ${JSON.stringify(m.requiredCapabilities)}`,
    );
  return m;
}
