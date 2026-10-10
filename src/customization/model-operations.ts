import type { ClassifierContext, ImagesContext } from "@earendil-works/pi-ai";
import { executeTypedModel, TypedModelError } from "../pi/typed-model.js";
import type { Journal, Links } from "../journal.js";
import type { ProviderOptions } from "../provider.js";
import type { Activation, CustomizationHost } from "./host.js";
import { ProviderProfiles } from "./provider-profiles.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ResourceAccess } from "./resource-access.js";
import type { ToolResult } from "./types.js";
import { estimateTokens } from "../context-meter.js";

export async function callModelOperation(host: CustomizationHost, activation: Activation, journal: Journal, links: Links, options: ProviderOptions, signal: AbortSignal,
  input: { operation: "classifier"; context: ClassifierContext; profile?: string } | { operation: "image"; context: ImagesContext; profile?: string }): Promise<ToolResult> {
  signal.throwIfAborted();
  const profiles = new ProviderProfiles(host.catalog.home), selected = await profiles.resolve(input.operation, input.profile);
  if (!selected) throw new Error(`Configure an explicit ${input.operation} model profile before calling it`);
  const provider = new ProviderRegistry(activation.extensions.flatMap(extension => extension.providers)).custom.get(selected.profile.providerId);
  if (!provider || provider.resource.id !== selected.profile.resourceId) throw new Error("Typed model provider is unavailable in this activation");
  const definition = provider.models.find(model => model.id === selected.profile.model && model.operation === input.operation);
  const protocol = input.operation === "classifier" ? "typesafe-system-one" : "openrouter-images";
  if (!definition || definition.protocol !== protocol) throw new Error("Typed model operation or protocol is unsupported");
  if (!selected.apiKey) throw new Error("Typed model credential is not configured");
  const access = await ResourceAccess.create(host.catalog, [provider.resource], !!links.workflowId);
  const revalidate = async () => {
    signal.throwIfAborted();
    await access.assert([provider.resource.id]);
    const current = await profiles.resolve(input.operation, input.profile);
    if (!current || JSON.stringify(current.profile) !== JSON.stringify(selected.profile) || current.apiKey !== selected.apiKey) throw new Error("Typed model configuration changed or credential revoked");
  };
  await revalidate();
  if (input.operation === "image" && !definition.capabilities.images && input.context.input.some(item => item.type === "image")) throw new Error("Selected image model does not support image input");
  const inputEstimate = estimateTokens(input.context);
  await journal.append("model.operation.budget", { operation: input.operation, provider: provider.id, model: definition.id, resourceRevision: provider.resource.hash, inputEstimate, method: "estimated", contextWindow: definition.contextWindow || null }, links);
  if (definition.contextWindow > 0 && inputEstimate >= definition.contextWindow) throw new Error("Typed model input exceeds the selected model context budget");
  const base = selected.profile.baseUrl.replace(/\/+$/, "");
  const common = { id: definition.id, name: definition.name, provider: provider.id, baseUrl: base, input: definition.capabilities.images ? ["text", "image"] as ("text" | "image")[] : ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const request = { apiKey: selected.apiKey, routing: selected.profile.routing, paths: selected.profile.paths.map(path => new URL(base + path).pathname), revision: provider.resource.hash, signal, links,
    transport: { fetch: options.fetch, timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes, beforeDispatch: async () => { await options.beforeDispatch?.(); await revalidate(); } } };
  try {
    const result = input.operation === "classifier"
      ? await executeTypedModel(journal, { ...request, operation: "classifier", model: { ...common, type: "classifier", api: "typesafe-system-one", contextWindow: definition.contextWindow }, context: input.context })
      : await executeTypedModel(journal, { ...request, operation: "image", model: { ...common, type: "image", api: "openrouter-images", output: ["text", "image"] }, context: input.context });
    // Only the model attempt owns usage. Tool/script parents carry evidence references, not another charge.
    const content = "output" in result.value ? result.value.output : [{ type: "text" as const, text: JSON.stringify(result.value.answers) }];
    return { content, details: JSON.parse(JSON.stringify({ operation: input.operation, ...result.evidence })) };
  } catch (error) {
    if (!(error instanceof TypedModelError)) throw error;
    return { content: [{ type: "text", text: error.message }], isError: true, details: JSON.parse(JSON.stringify(error.evidence)) };
  }
}
