import type { ModelDefinition, ProviderInput, ProviderOutput } from "./contracts.js";
import type { ProcessContext } from "./process.js";
import type { Resource } from "./resources.js";
export interface RegisteredProvider {
  id: string;
  models: ModelDefinition[];
  resource: Resource;
  abort(): Promise<void>;
  serialize(input: ProviderInput, context: ProcessContext): Promise<{ body: import("./types.js").Json; path: string }>;
  parse(input: { requestId: string; sequence: number; chunk: string; final: boolean }, context: ProcessContext): Promise<ProviderOutput | null>;
}
export const defaultModel: ModelDefinition = { id: "deepseek-flash", name: "DeepSeek Flash", protocol: "responses", historyCompatibility: "deepseek-responses-v1", contextWindow: 1_000_000, maxOutputTokens: 4096, capabilities: { tools: true, images: true, reasoning: true } };
export function validateProvider(value: { id: string; models: ModelDefinition[] }) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(value.id) || value.id === "deepseek" || !Array.isArray(value.models) || !value.models.length || value.models.length > 128) throw new Error("Invalid or reserved Provider identity");
  const ids = new Set<string>();
  for (const model of value.models) {
    if (!model || typeof model.id !== "string" || !model.id || model.id.length > 128 || ids.has(model.id) || typeof model.name !== "string" || !model.name || (typeof model.protocol !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/.test(model.protocol)) || typeof model.historyCompatibility !== "string" || !model.historyCompatibility || model.historyCompatibility.length > 128 || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1 || !Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens < 1 || model.maxOutputTokens > model.contextWindow || !model.capabilities || Object.keys(model.capabilities).some(c => !["tools", "images", "reasoning"].includes(c)) || ["tools", "images", "reasoning"].some(c => typeof model.capabilities[c as keyof ModelDefinition["capabilities"]] !== "boolean")) throw new Error("Invalid Provider model definition or unsupported protocol");
    ids.add(model.id);
  }
}
export class ProviderRegistry {
  readonly custom = new Map<string, RegisteredProvider>();
  constructor(providers: RegisteredProvider[]) {
    for (const provider of providers) { validateProvider(provider); if (this.custom.has(provider.id)) throw new Error(`Duplicate Provider identity: ${provider.id}`); this.custom.set(provider.id, provider); }
  }
  catalog() { return [{ id: "deepseek", revision: "builtin-1", models: [defaultModel] }, ...[...this.custom.values()].map(p => ({ id: p.id, resourceId: p.resource.id, revision: p.resource.hash, models: p.models }))]; }
}
