import type { ThemeDefinition, UiSlot, UiAction, ViewOptions } from "./ui-contract.js";
import type { ExtensionAPI, ExtensionContext, Json, Contribution } from "./types.js";
import type { Capability } from "./capabilities.js";
export interface ResourceIdentity {
  packageId?: string;
  resourceId: string;
  revision: string;
  stateNamespace: string;
}
export type PackageSource = { kind: "local"; path: string } | { kind: "npm"; name: string; version: string; registry: string } | { kind: "git"; url: string; commit: string };
export interface PackageResource {
  name: string;
  kind: "extension" | "skill" | "rule" | "mcp" | "provider" | "workflow" | "panel";
  entry: string;
  ruleScope?: { root: string; include: string[] };
}
export interface PackageManifest {
  manifestVersion: 1;
  name: string;
  version: string;
  sdkVersion: 1 | 2;
  requiredCapabilities: Capability[];
  resources: PackageResource[];
  files?: string[];
  dependencies: Record<string, string>;
}
export interface PackageLock {
  version: 1;
  lockVersion: 1;
  id: string;
  scope: "project" | "user";
  packageId: string;
  manifest: PackageManifest;
  source: PackageSource;
  revision: string;
  integrity: string;
  dependencies: Record<string, { name: string; version: string; integrity: string; url: string }>;
  files: Record<string, string>;
  grants: string[];
  trusted?: boolean;
  previous?: string;
  ruleBindings: Record<string, { workspace: string; root: string; include: string[] }>;
}
export interface ModelDefinition {
  id: string;
  name: string;
  protocol: "responses" | "chat-completions" | string;
  historyCompatibility: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: { tools: boolean; images: boolean; reasoning: boolean };
}
export interface ProviderInput { model: ModelDefinition; instructions: string; history: Json[]; tools: Json[]; maxOutputTokens: number }
/** rawItems preserve native protocol evidence; contextItems are an explicitly sourced canonical projection. */
export interface ProviderOutput { rawItems: Json[]; contextItems: Json[]; projection: { content: Array<{ type: "text"; text: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, Json> }> }; terminal: "completed" | "failed"; usage?: Json; toolEvidence?: Record<string, { itemIndex: number; callIdPath: string; namePath: string; argumentsPath: string }> }
export interface ProviderDefinition {
  id: string;
  models: ModelDefinition[];
  serialize(input: ProviderInput): Promise<{ body: Json; path: string }>;
  parse(input: { requestId: string; sequence: number; chunk: string; final: boolean }): Promise<ProviderOutput | null>;
}
export type StepOutcome = { kind: "next"; step: string; input: Json } | { kind: "wait"; step: string; input: Json; form: Contribution } | { kind: "complete"; output: Json };
export interface WorkflowContext extends ExtensionContext {
  readonly workflowId: string;
  readonly stepId: string;
  readonly attemptId: string;
  workspaceState: {
    get(key: string, schemaVersion: number): Promise<{ revision: number; value: Json } | undefined>;
    set(key: string, schemaVersion: number, expectedRevision: number, value: Json): Promise<number>;
  };
}
export interface WorkflowDefinition {
  id: string;
  schemaVersion: number;
  inputSchema: Record<string, Json>;
  entry: string;
  steps: Record<string, { transitions: string[]; execute(input: Json, ctx: WorkflowContext): Promise<StepOutcome> }>;
  triggers?: Array<{ kind: "command" | "run-completed" | "tool-completed"; name?: string }>;
}
export interface PanelDefinition {
  id: string;
  uiVersion: 1;
  entry: string;
  slot: "sidebar" | "result" | UiSlot;
  title?: string;
  order?: number;
  match?: ViewOptions["match"];
  propsSchema: Record<string, Json>;
  actions: string[];
  fallback: string;
  renderer?: string;
  theme?: Partial<Record<"background" | "foreground" | "accent" | "border", string>>;
  themes?: Record<string, Partial<Record<"background" | "foreground" | "accent" | "border", string>>>;
}
export interface PanelContext {
  props: Json;
  subscribe?(handler: (state: Json) => void): () => void;
  onThemeChange?(handler: (theme: Json) => void): () => void;
  request(action: "workflow.state" | "workflow.answer" | "workflow.cancel" | UiAction, value?: Json): Promise<Json>;
}
export interface PanelModule { mount(root: HTMLElement, context: PanelContext): void | (() => void) | Promise<void | (() => void)>;
}
export interface ExtensionAPI2 extends ExtensionAPI {
  registerProvider(provider: ProviderDefinition): void;
  registerWorkflow(workflow: WorkflowDefinition): void;
  registerPanel(panel: PanelDefinition): void;
  registerTheme(theme: ThemeDefinition): void;
  registerView(view: PanelDefinition & ViewOptions): void;
}
export type ExtensionFactory2 = (api: ExtensionAPI2) => void | Promise<void>;
export interface RpcIdentity {
  protocolVersion: 1;
  instanceId: string;
  packageId?: string;
  resourceId: string;
  revision: string;
}
export interface RpcEnvelope extends RpcIdentity {
  sequence: number;
  callId: string;
  runId?: string;
  workflowId?: string;
  stepId?: string;
  kind: "request" | "response";
  method?: string;
  parentCallId?: string;
  value?: Json;
  error?: string;
}
