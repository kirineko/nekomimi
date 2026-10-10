import { assertPhysicalRouting } from "../model-routing.js";
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
export const defaultModel: ModelDefinition = { id: "deepseek-flash", operation: "chat", credentialRequired: true, name: "DeepSeek Flash", protocol: "responses", historyCompatibility: "deepseek-responses-v1", contextWindow: 1_000_000, maxOutputTokens: 131072, capabilities: { tools: true, images: true, reasoning: true } };
export function validateProvider(value: { id: string; models: ModelDefinition[] }) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(value.id) || value.id === "deepseek" || !Array.isArray(value.models) || !value.models.length || value.models.length > 128) throw new Error("Invalid or reserved Provider identity");
  const ids = new Set<string>();
  for (const model of value.models) {
    assertPhysicalRouting(model?.routing);
    if (!model || typeof model.id !== "string" || !model.id || model.id.length > 128 || ids.has(JSON.stringify([model.operation??"chat",model.id])) || typeof model.name !== "string" || !model.name || (typeof model.protocol !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/.test(model.protocol)) || typeof model.historyCompatibility !== "string" || !model.historyCompatibility || model.historyCompatibility.length > 128 || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 0 || !Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens < ((model.operation??"chat")==="chat"?1:0) || (model.contextWindow>0 && model.maxOutputTokens > model.contextWindow) || !model.capabilities || Object.keys(model.capabilities).some(c => !["tools", "images", "reasoning"].includes(c)) || ["tools", "images", "reasoning"].some(c => typeof model.capabilities[c as keyof ModelDefinition["capabilities"]] !== "boolean")) throw new Error("Invalid Provider model definition or unsupported protocol");
    if (!["chat","classifier","image"].includes(model.operation??"chat") || (model.credentialRequired!==undefined && typeof model.credentialRequired!=="boolean")) throw new Error("Invalid model operation or credential policy");
    ids.add(JSON.stringify([model.operation??"chat",model.id]));
  }
}
export class ProviderRegistry {
  readonly custom = new Map<string, RegisteredProvider>();
  constructor(providers: RegisteredProvider[]) {
    for (const provider of providers) { validateProvider(provider); if (this.custom.has(provider.id)) throw new Error(`Duplicate Provider identity: ${provider.id}`); this.custom.set(provider.id, {...provider,models:structuredClone(provider.models)}); }
  }
  catalog() { return [{ id: "deepseek", revision: "builtin-1", models: [structuredClone(defaultModel)] }, ...[...this.custom.values()].map(p => ({ id: p.id, resourceId: p.resource.id, revision: p.resource.hash, models: structuredClone(p.models).map(model=>({...model,operation:model.operation??"chat"})) }))]; }
}
