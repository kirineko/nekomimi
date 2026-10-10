import type { ClassifierContext, ClassifierResult, AssistantImages, ImageModel, ClassifierModel } from "@earendil-works/pi-ai";
import { classify } from "@earendil-works/pi-ai/api/typesafe-system-one";
import { generateImages } from "@earendil-works/pi-ai/api/openrouter-images";
import { Journal, type Artifact, type Links } from "../journal.js";
import { RecordedCall, type RecordedOptions, type RecordedAttempt } from "../recorded-call.js";
import { assertPhysicalRouting } from "../model-routing.js";

type TypedRequest =
  | { operation: "classifier"; model: ClassifierModel<"typesafe-system-one">; context: ClassifierContext }
  | { operation: "image"; model: ImageModel<"openrouter-images">; context: { input: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> } };
export type TypedModelRequest = TypedRequest & {
  apiKey: string; routing?: "physical"; paths: readonly string[]; signal?: AbortSignal;
  links: Links; revision: string; transport?: RecordedOptions;
};
export interface TypedUsage {
  input: number | null; output: number | null; cost: null;
}
export interface TypedModelEvidence {
  modelCallId: string; attemptId?: string; result: Artifact;
  usage: TypedUsage; attachments: Array<{ index: number; mimeType: string; artifact: Artifact }>;
}
export class TypedModelError extends Error {
  constructor(message: string, readonly evidence: TypedModelEvidence) { super(message); }
}
const count = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Public Pi operation adapters, with one host-owned attempt and no implicit retry or fallback. */
export async function executeTypedModel(journal: Journal, request: TypedModelRequest) {
  assertPhysicalRouting(request.routing);
  journal.check(); request.signal?.throwIfAborted();
  if (!request.apiKey.trim()) throw new Error("Model credential is not configured");
  if (request.operation === "classifier" ? request.model.api !== "typesafe-system-one" : request.model.api !== "openrouter-images")
    throw new Error("Unsupported typed model protocol");
  const captured = structuredClone({ model: request.model, context: request.context, paths: request.paths });
  const base = new URL(captured.model.baseUrl);
  if (base.username || base.password || base.search || base.hash || !["http:", "https:"].includes(base.protocol)) throw new Error("Invalid model endpoint");
  const signal = AbortSignal.any([journal.failure.signal, ...(request.signal ? [request.signal] : [])]);
  const call = new RecordedCall(journal, request.links);
  const metadata = { operation: request.operation, purpose: request.operation, provider: captured.model.provider, model: captured.model.id, protocol: captured.model.api, adapterRevision: "pi-typed-model-1", routing: "physical" };
  journal.registerSecret(request.apiKey);
  let attempt: RecordedAttempt | undefined, rawUsage: Record<string, unknown> | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (attempt) throw new Error("Typed model attempted an implicit retry");
    signal.throwIfAborted();
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !captured.paths.includes(url.pathname)) throw new Error("Typed model endpoint is outside the authorized paths");
    attempt = await call.attempt({ ...request.transport }, metadata, signal, request.revision);
    const response = await attempt.fetch(url.href, { ...init, redirect: "error" });
    // Drain once through the recorded transport before allowing the adapter to interpret it.
    const body = await response.text();
    try { const parsed = JSON.parse(body); if (parsed?.usage && typeof parsed.usage === "object" && !Array.isArray(parsed.usage)) rawUsage = parsed.usage; } catch { /* Adapter owns malformed-response diagnostics. */ }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const options = { apiKey: request.apiKey, signal, fetch, maxRetries: 0, timeoutMs: request.transport?.timeoutMs ?? 120000 };
  let value: ClassifierResult | AssistantImages;
  try {
    value = request.operation === "classifier"
      ? await classify(captured.model as ClassifierModel<"typesafe-system-one">, captured.context as ClassifierContext, options)
      : await generateImages(captured.model as ImageModel<"openrouter-images">, captured.context as Extract<TypedRequest, { operation: "image" }>["context"], options);
  } catch (error) {
    // Public adapters normally return an error stopReason; preserve unexpected adapter failures too.
    if (attempt && !journal.failure.signal.aborted) await attempt.finish({ ...metadata, outcome: signal.aborted ? "cancelled" : "failed", error: journal.clean(String(error)) });
    throw error;
  }
  const usage: TypedUsage = { input: count(rawUsage?.input_tokens ?? rawUsage?.prompt_tokens), output: count(rawUsage?.output_tokens ?? rawUsage?.completion_tokens), cost: null };
  let invalidAnswer: string | undefined;
  if (value.stopReason === "stop" && "answers" in value) {
    const questions = (captured.context as ClassifierContext).questions;
    const probability = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
    for (const [id, answer] of Object.entries(value.answers)) {
      const question = questions[id];
      if (!question || question.type !== answer.type ||
        (answer.type === "bool" && !probability(answer.probability)) ||
        (answer.type === "score" && (!Number.isFinite(answer.score) || !probability(answer.confidence))) ||
        (answer.type === "choice" && question.type === "choice" && (!Object.hasOwn(question.criteria, answer.choice) || !probability(answer.confidence) || Object.entries(answer.probabilities).some(([key, p]) => !Object.hasOwn(question.criteria, key) || !probability(p))))) invalidAnswer = "Invalid classifier answer";
    }
  }
  // Catalog prices are not yet a verified contract. Never expose Pi's synthetic zero cost.
  const { usage: _adapterUsage, ...answer } = value;
  const result = await journal.artifact(JSON.stringify({ ...answer, usage }));
  const attachments: TypedModelEvidence["attachments"] = [];
  if ("output" in value) for (const [index, item] of value.output.entries()) {
    if (item.type === "image") attachments.push({ index, mimeType: item.mimeType, artifact: await journal.artifact(Buffer.from(item.data, "base64")) });
  }
  const evidence: TypedModelEvidence = { modelCallId: call.links.modelCallId!, ...(attempt ? { attemptId: attempt.links.attemptId } : {}), result, usage, attachments };
  const error = value.stopReason !== "stop" ? value.errorMessage ?? `Model stopped: ${value.stopReason}` : !attempt?.responseComplete ? "Model response incomplete" : invalidAnswer;
  await journal.append("model.operation.result", { ...metadata, ...evidence, stopReason: value.stopReason, cancelled: signal.aborted }, attempt?.links ?? call.links);
  if (attempt) await attempt.finish({ ...metadata, outcome: signal.aborted ? "cancelled" : error ? "failed" : "completed", usage, result, ...(error ? { error: journal.clean(error) } : {}) });
  if (signal.aborted) throw new TypedModelError("Model operation cancelled", evidence);
  if (error) throw new TypedModelError(journal.clean(error), evidence);
  return { value: { ...answer, usage }, evidence };
}
