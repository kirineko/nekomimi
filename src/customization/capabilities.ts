export const SDK_CAPABILITIES = ["tools", "commands", "hooks", "state", "model", "ui", "follow-up", "providers", "workflows", "panels", "workspace-state", "themes", "views", "ui-draft", "ui-command", "ui-navigation", "ui-state"] as const;
export type Capability = (typeof SDK_CAPABILITIES)[number];

/** @deprecated Use SDK_CAPABILITIES. */
export const V2_CAPABILITIES = SDK_CAPABILITIES;
