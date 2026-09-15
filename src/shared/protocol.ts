/** Browser-safe transport types. No Node or runtime imports belong here. */
export const API_VERSION = 1;
export interface EvidenceRef {
  kind: "artifact";
  sha256: string;
  bytes: number;
  redacted?: boolean;
}
export interface Cursor {
  seq: number;
  hash: string;
}
export interface SessionInfo {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  runId?: string;
  error?: string;
}
export interface TimelineRow {
  id: string;
  seq: number;
  kind: "user" | "assistant" | "call" | "tool" | "status";
  title: string;
  text: string;
  status?: string;
  runId?: string;
  modelCallId?: string;
  attemptId?: string;
  toolCallId?: string;
  refs: EvidenceRef[];
  details?: unknown;
}
export interface Snapshot {
  version: 1;
  session: SessionInfo;
  cursor: Cursor;
  rows: TimelineRow[];
  before?: number;
  totalRows: number;
}
export interface Update {
  version: 1;
  cursor: Cursor;
  session: SessionInfo;
  rows: TimelineRow[];
}
export interface Receipt {
  version: 1;
  commandId: string;
  runId: string;
  status: string;
}
export interface Submit {
  version: 1;
  commandId: string;
  prompt: string;
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const validId = (value: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "invalid_input", "需要 JSON 对象");
  return value as Record<string, unknown>;
}
export function parseSubmit(value: unknown): Submit {
  const v = object(value);
  if (v.version !== API_VERSION)
    throw new ApiError(400, "version", "不支持的协议版本");
  if (
    typeof v.commandId !== "string" ||
    !validId(v.commandId) ||
    typeof v.prompt !== "string" ||
    !v.prompt.trim() ||
    v.prompt.length > 32000
  )
    throw new ApiError(400, "invalid_input", "任务内容或命令 ID 无效");
  return { version: 1, commandId: v.commandId, prompt: v.prompt };
}
export function integer(
  value: string | null,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 0 || n > max)
    throw new ApiError(400, "invalid_input", "分页参数无效");
  return n;
}
