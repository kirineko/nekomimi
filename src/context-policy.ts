import { estimateTokens, inputBudget, type ContextModel } from "./context-meter.js";
import type { assemblePrompt } from "./context.js";
export const CONTEXT_POLICY = Object.freeze({ version: 1, directoryBytes: 4096, pageBytes: 12000, pageEntries: 32, descriptionBytes: 256, requiredBytes: 131072 });
export function shortContextText(text: string, bytes: number) {
  if (Buffer.byteLength(text) <= bytes) return text;
  let result = Buffer.from(text).subarray(0, bytes).toString("utf8");
  if (result.endsWith("\ufffd")) result = result.slice(0, -1);
  return result;
}
export interface ContextDirectoryPage<T> {
  version: number; revision: string; total: number; offset: number; items: T[]; omitted: number; next?: number; byteLimit: number;
}
export function contextDirectory<T extends { id: string }>(entries: T[], revision: string, options: { offset?: number; limit?: number; bytes?: number; accept?: (page: ContextDirectoryPage<T>) => boolean } = {}) {
  const offset = options.offset ?? 0, limit = options.limit ?? CONTEXT_POLICY.pageEntries, bytes = options.bytes ?? CONTEXT_POLICY.pageBytes;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > entries.length || !Number.isSafeInteger(limit) || limit < 1 || limit > CONTEXT_POLICY.pageEntries)
    throw new Error("Resource catalog offset or limit invalid");
  const ordered = [...entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), items: T[] = [];
  const envelope = () => ({ version: 1, revision, total: ordered.length, offset, items, omitted: ordered.length - offset - items.length,
    next: offset + items.length < ordered.length ? offset + items.length : undefined, byteLimit: bytes });
  for (const entry of ordered.slice(offset, offset + limit)) {
    items.push(entry);
    if (Buffer.byteLength(JSON.stringify(envelope())) > bytes || options.accept && !options.accept(envelope())) { items.pop(); break; }
  }
  if (!items.length && offset < ordered.length) throw new Error("One resource descriptor exceeds the catalog byte budget");
  return envelope();
}
/** Mandatory guidance is never shortened to make a request fit. */
export function requiredInstructionBudget(prompt: ReturnType<typeof assemblePrompt>, model: ContextModel) {
  const required = prompt.fragments.filter(fragment => fragment.section === "rules" || fragment.section === "policy");
  const bytes = required.reduce((size, fragment) => size + Buffer.byteLength(fragment.text), 0), tokens = estimateTokens(required.map(fragment => fragment.text));
  const available = model.contextWindow > 0 ? inputBudget(model).available : undefined;
  const result = { version: CONTEXT_POLICY.version, bytes, tokens, byteLimit: CONTEXT_POLICY.requiredBytes, available,
    sources: required.map(fragment => ({ source: fragment.source, hash: fragment.hash, scope: fragment.scope, bytes: Buffer.byteLength(fragment.text) })) };
  if (bytes > CONTEXT_POLICY.requiredBytes || available !== undefined && tokens > available)
    throw new Error(`强制规则和模式指导超过请求预算（${bytes} bytes，估计 ${tokens} tokens）；来源：${required.map(fragment => fragment.source).join(", ")}。请缩小规则范围或选择适当模型；规则未被截断。`);
  return result;
}
