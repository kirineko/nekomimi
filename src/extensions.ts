export { SDK_MODES, SDK_PROTOCOLS } from "./customization/capabilities.js";
export type { SdkMode } from "./customization/capabilities.js";
export { SDK_VERSION, CAPABILITIES } from "./customization/types.js";
export { CONTRACT_VERSIONS } from "./customization/contracts.js";
export type {
  Capability, ResourceIdentity, PackageSource, PackageResource, PackageManifest,
  PackageLock, ModelDefinition, ProviderInput, ProviderOutput, ProviderDefinition,
  StepOutcome, WorkflowContext, WorkflowDefinition, PanelDefinition, PanelContext, PanelModule,
  ExtensionAPI3, ExtensionFactory3, RpcIdentity, RpcEnvelope,
} from "./customization/contracts.js";
export type {
  Json,
  Content,
  ToolResult,
  Contribution,
  FormField,
  ExtensionManifest,
  ExtensionContext,
  ExtensionTool,
  ExtensionCommand,
  ExtensionAPI,
  ExtensionFactory,
  Hook,
  HookEvent,
  ResourceDescriptor,
  ResourceSnapshot,
} from "./customization/types.js";

export type { ThemeDefinition, UiSlot, UiAction, ViewOptions } from "./customization/ui-contract.js";
