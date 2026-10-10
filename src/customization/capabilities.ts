export const SDK_CAPABILITIES = Object.freeze(["tools", "commands", "hooks", "state", "model", "ui", "follow-up", "providers", "workflows", "panels", "workspace-state", "themes", "views", "ui-draft", "ui-command", "ui-navigation", "ui-state"] as const);
export type Capability = (typeof SDK_CAPABILITIES)[number];

/** @deprecated Use SDK_CAPABILITIES. */
export const V2_CAPABILITIES = SDK_CAPABILITIES;

export const SDK_MODES = Object.freeze(["work", "create"] as const);
export type SdkMode = (typeof SDK_MODES)[number];
export const SDK_PROTOCOLS = Object.freeze({
  chat: Object.freeze(["responses", "chat-completions", "registered-adapter"] as const),
  classifier: Object.freeze(["typesafe-system-one"] as const),
  image: Object.freeze(["openrouter-images"] as const),
  mcp: Object.freeze(["stdio", "streamable-http"] as const),
});
