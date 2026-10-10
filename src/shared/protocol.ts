export interface ContextOccupancy {
  revision:string; model:string; provider:string; contextWindow?:number;
  systemTokens:number; toolsTokens:number; messageTokens:number; totalTokens:number;
  method:'estimated'|'calibrated'; imageEstimate?:boolean; anchor?:string;
  policyVersion?:number; mode?:string; targetId?:string; purpose?:string; capabilityRevision?:string;
  reservations?:{output:number;safety?:number;toolResults?:number;availableInput?:number;pressureThreshold?:number;capacity:'known'|'unknown'};
  layers?:Array<{id:string;category:'system'|'tools'|'messages';tokens:number;estimatedTokens:number;adjustmentTokens:number;sources:Array<{source:string;hash:string;scope?:string;eventId?:string}>}>;
  exclusions?:Array<{source:string;hash:string;reason:string;scope?:string;eventId?:string}>;
  sampledInputTokens?:number; heuristicTokens?:number;
}
/** Browser-safe transport types. No Node or runtime imports belong here. */
export const API_VERSION = 1;
export type SessionMode = "work" | "create";
export interface TargetHost {
  id: string;
  build: string;
  sdkVersion: number;
  dataFormatVersion: number;
}
export interface SessionTarget {
  id: string;
  kind: "project" | "extension" | "core";
  root: string;
  rootIdentity: { device: string; inode: string };
  scope: "project" | "user";
  host?: TargetHost;
  coreCandidate?: { id: string; sourceRevision: string };
}
/** Immutable identity owned by the session Journal, independent of a route. */
export interface SessionBinding {
  version: 1;
  sessionId: string;
  mode: SessionMode;
  ownerWorkspace: string;
  target: SessionTarget;
  creation: { commandId: string; payloadHash: string };
}
export interface SessionCreation {
  commandId: string;
  mode: SessionMode;
  target?: { kind: "project" | "extension" | "core"; root: string; scope?: "project" | "user"; host?: TargetHost };
}
export interface HandoffDraft {
  version: 1;
  goal: string;
  constraints?: string[];
  summary?: string;
  target: { sessionId: string } | { title: string; creation: SessionCreation };
  references?: Array<{ sessionId: string; eventId: string; payloadHash: string }>;
  delivery?: DeliverySelection[];
}
export interface DeliverySelection {
  resourceId: string;
  revision: string;
  candidateId?: string;
  type?: string;
  localId?: string;
  usage: string;
}
export interface DeliveryEvidence {
  verification?: import("./customization-lifecycle.js").VerificationResult;
  status?: import("./customization-lifecycle.js").VerificationResult["status"];
  check?: string;
  environment?: import("./customization-lifecycle.js").VerificationEnvironment;
  origin: "development" | "work";
  eventId: string;
  seq: number;
  hash: string;
  stage: string;
  revision: string;
  host: string;
  passed?: boolean;
  at: string;
}
export interface DeliverySnapshot {
  creation?: import("./customization-lifecycle.js").CustomizationOrigin;
  version: 1;
  resourceId: string;
  revision: string;
  contentHash: string;
  candidateId?: string;
  candidateRevision?: string;
  name: string;
  kind: string;
  type: string;
  localId?: string;
  scope: "project" | "user";
  usage: string;
  developmentTargetId: string;
  workTargetId: string;
  host: TargetHost;
  developmentActiveRevision?: string;
  workResourceId?: string;
  workActiveRevision?: string;
  phase: "awaiting-delivery" | "authorization" | "unavailable" | "available" | "awaiting-application" | "applied";
  entries: string[];
  missing: string[];
  required: string[];
  evidence: DeliveryEvidence[];
  applied: boolean;
  executesCommand: false;
  grantsPermissions: false;
}
export interface HandoffPreview {
  version: 1;
  source: { sessionId: string; mode: SessionMode; targetId: string; revision: Cursor };
  target: SessionBinding;
  creation?: { title: string; input: SessionCreation };
  goal: string;
  constraints: string[];
  summary: string;
  references: Array<{ sessionId: string; eventId: string; payloadHash: string; type: string; data: unknown;
    dataHash?: string; origin?: { mode: SessionMode; targetId: string; scope: string; ownerWorkspace: string } }>;
  delivery?: DeliverySnapshot[];
  payloadHash: string;
  grantsPermissions: false;
  createsTask: false;
}
export interface HandoffReceipt {
  version: 1;
  handoffId: string;
  commandId: string;
  sourceSessionId: string;
  targetSessionId: string;
  sourceRevision: Cursor;
  payloadHash: string;
  intentEventId: string;
  receivedEventId: string;
  committedEventId: string;
  status: "committed";
  createsTask: false;
  grantsPermissions: false;
}
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
export interface Diagnostic {
  version: 1;
  id: string;
  timestamp: string;
  sessionId?: string;
  runId?: string;
  attemptId?: string;
  seq?: number;
  durableSeq?: number;
  operation: string;
  category: "storage" | "background";
  code?: string;
  syscall?: string;
  platform: string;
  nodeVersion: string;
}
export interface SessionInfo {
  binding?: SessionBinding;
  targetState?: "available" | "unavailable";
  targetError?: string;
  diagnostic?: Diagnostic;
  naming?: boolean;
  namingRunId?: string;
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  activityAt?: string | null;
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
  context?: ContextOccupancy;
  compacting?: boolean;
  version: 1;
  session: SessionInfo;
  cursor: Cursor;
  rows: TimelineRow[];
  before?: number;
  after?: number;
  totalRows: number;
}
export interface Update {
  context?: ContextOccupancy;
  compacting?: boolean;
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
  handoffIds?: string[];
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
  if (v.mode !== undefined || v.target !== undefined || v.ownerWorkspace !== undefined)
    throw new ApiError(409, "session_identity", "会话模式或目标不可原地改变，请新建会话或交接");
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
  const handoffIds = parseHandoffIds(v.handoffIds);
  return { version: 1, commandId: v.commandId, prompt: v.prompt, ...(handoffIds?.length ? { handoffIds } : {}) };
}
export function parseHandoffIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8 || value.some(item => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item)) || new Set(value).size !== value.length)
    throw new ApiError(400, "delivery_reference", "交付引用无效或重复");
  return [...value].sort();
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

export interface SessionPage {
  sessions: SessionInfo[];
  next?: number;
  listRevision: string;
}
export interface CommandSuggestion {
  id: string;
  kind: "builtin" | "extension" | "workflow" | "skill";
  name: string;
  description: string;
  source: string;
  insertText: string;
}
export interface CommandCatalog {
  revision: string;
  ready: boolean;
  commands: CommandSuggestion[];
}
