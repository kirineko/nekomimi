import { realpath, stat } from "node:fs/promises";
import { resolve, isAbsolute, dirname, basename, join } from "node:path";
import { hash, Journal, type JournalEvent } from "../journal.js";
import { workspacePaths } from "../storage/paths.js";
import { hostIdentity } from "../customization/sdk.js";
import { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from "../shared/versions.js";
import { checkDevelopmentTarget } from "./target.js";
import { ApiError, object, validId, type SessionBinding, type SessionCreation, type SessionTarget, type TargetHost } from "../shared/protocol.js";

export function parseSessionCreation(value: unknown): SessionCreation {
  const input = object(value);
  if (typeof input.commandId !== "string" || !validId(input.commandId) || !["work", "create"].includes(String(input.mode)))
    throw new ApiError(400, "session_identity", "创建命令或模式无效");
  let target: SessionCreation["target"];
  if (input.target !== undefined) {
    const t = object(input.target);
    if (!["project", "extension", "core"].includes(String(t.kind)) || typeof t.root !== "string" || !isAbsolute(t.root) || t.root.includes("\0") ||
        (t.scope !== undefined && !["project", "user"].includes(String(t.scope))))
      throw new ApiError(400, "target", "目标参数无效");
    target = { kind: t.kind as SessionTarget["kind"], root: resolve(t.root), scope: (t.scope ?? "project") as SessionTarget["scope"] };
    if (t.host !== undefined) {
      const h = object(t.host);
      if (typeof h.id !== "string" || !/^[a-f0-9]{64}$/.test(h.id) || typeof h.build !== "string" || !/^[a-f0-9]{64}$/.test(h.build) ||
          h.sdkVersion !== SDK_CONTRACT_VERSION || h.dataFormatVersion !== DATA_FORMAT_VERSION)
        throw new ApiError(422, "host_version", "目标宿主契约不匹配");
      target.host = { id: h.id, build: h.build, sdkVersion: h.sdkVersion, dataFormatVersion: h.dataFormatVersion };
    }
  }
  if (input.mode === "create" && (!target || target.kind === "project"))
    throw new ApiError(400, "target", "创造会话需要明确的独立开发目标");
  if (input.mode === "work" && target && (target.kind !== "project" || target.scope !== "project" || target.host))
    throw new ApiError(400, "target", "工作会话需要项目目标");
  return { commandId: input.commandId, mode: input.mode as SessionCreation["mode"], ...(target ? { target } : {}) };
}

export async function currentTargetHost(): Promise<TargetHost> {
  const host = await hostIdentity();
  return { id: hash(host.entry), build: host.build, sdkVersion: SDK_CONTRACT_VERSION, dataFormatVersion: DATA_FORMAT_VERSION };
}
function targetId(target: Omit<SessionTarget, "id">): string {
  return hash(JSON.stringify({ kind: target.kind, root: target.root, identity: target.rootIdentity, scope: target.scope, host: target.host, coreCandidate: target.coreCandidate }));
}
export function creationHash(title: string, input: SessionCreation): string {
  return hash(JSON.stringify({ title: title.trim().slice(0, 100) || "新会话", ...parseSessionCreation(input) }));
}
export async function createSessionBinding(ownerWorkspace: string, sessionId: string, input: SessionCreation, payloadHash: string, home?: string): Promise<SessionBinding> {
  input = parseSessionCreation(input);
  const owner = await realpath(ownerWorkspace);
  let root: string;
  try { root = await realpath(input.target?.root ?? owner); }
  catch { throw new ApiError(422, "target_unavailable", "目标目录不可用，不能回退到服务工作目录"); }
  if (input.mode === "work" && root !== owner)
    throw new ApiError(403, "target_scope", "工作目标不属于当前授权项目");
  if (input.mode === "create" && root === owner)
    throw new ApiError(422, "target_scope", "创造任务需要独立开发目录");
  const st = await stat(root, { bigint: true });
  if (!st.isDirectory()) throw new ApiError(422, "target_unavailable", "目标必须是目录");
  const host = input.mode === "create" ? await currentTargetHost() : undefined;
  if (input.target?.host && JSON.stringify(input.target.host) !== JSON.stringify(host))
    throw new ApiError(409, "host_changed", "目标宿主身份或构建已变化，请重新选择");
  const identity = { device: String(st.dev), inode: String(st.ino) };
  const captured = { kind: input.target?.kind ?? "project" as const, root, rootIdentity: identity, scope: input.target?.scope ?? "project" as const, ...(host ? { host } : {}) };
  const target: SessionTarget = { id: targetId(captured), ...captured };
  if (input.mode === "create") {
    const candidate = await checkDevelopmentTarget(target, owner, home);
    if (candidate) { target.coreCandidate = candidate; target.id = targetId(target); }
  }
  return { version: 1, sessionId, mode: input.mode, ownerWorkspace: owner, target, creation: { commandId: input.commandId, payloadHash } };
}
export function sessionBinding(events: readonly JournalEvent[]): SessionBinding | undefined {
  const first = (events.find(event => event.type === "durable.session")?.payload as { binding?: SessionBinding } | undefined)?.binding;
  const created = (events.find(event => event.type === "session.created")?.payload as { binding?: SessionBinding } | undefined)?.binding;
  const binding = created ?? first;
  if (!binding) return undefined; // Older observations remain readable; they cannot execute.
  if (first && created && JSON.stringify(first) !== JSON.stringify(created)) throw new ApiError(422, "session_identity", "会话创建身份不一致");
  if (binding.version !== 1 || typeof binding.sessionId !== "string" || !validId(binding.sessionId) || typeof binding.ownerWorkspace !== "string" || resolve(binding.ownerWorkspace) !== binding.ownerWorkspace || !["work", "create"].includes(binding.mode) ||
      !binding.target || typeof binding.target.root !== "string" || !/^[a-f0-9]{64}$/.test(binding.target.id) ||
      resolve(binding.target.root) !== binding.target.root || !["project", "user"].includes(binding.target.scope) ||
      !binding.target.rootIdentity || !/^\d+$/.test(binding.target.rootIdentity.device) || !/^\d+$/.test(binding.target.rootIdentity.inode) ||
      !binding.creation || typeof binding.creation.commandId !== "string" || !validId(binding.creation.commandId) || !/^[a-f0-9]{64}$/.test(binding.creation.payloadHash))
    throw new ApiError(422, "session_identity", "会话身份无效");
  if (events.filter(event => event.type === "session.created").length > 1) throw new ApiError(422, "session_identity", "会话身份不可改写");
  if (events[0]?.sessionId !== binding.sessionId) throw new ApiError(422, "session_identity", "会话记录与创建身份不一致");
  if ((binding.mode === "work" && (binding.target.kind !== "project" || binding.target.root !== binding.ownerWorkspace)) ||
      (binding.mode === "create" && (!["extension", "core"].includes(binding.target.kind) || !binding.target.host || binding.target.root === binding.ownerWorkspace)))
    throw new ApiError(422, "session_identity", "会话模式与目标不一致");
  if (binding.target.id !== targetId(binding.target)) throw new ApiError(422, "session_identity", "目标身份摘要不一致");
  if (binding.target.host) parseSessionCreation({ commandId: binding.creation.commandId, mode: binding.mode, target: binding.target });
  return structuredClone(binding);
}
export async function checkSessionTarget(binding: SessionBinding, home?: string): Promise<void> {
  if (binding.target.kind === 'core' && !binding.target.coreCandidate) throw new ApiError(422, 'core_candidate', '核心会话缺少已登记候选基线，请明确建立新的候选会话');
  try {
    const canonical = await realpath(binding.target.root), st = await stat(canonical, { bigint: true });
    if (!st.isDirectory() || canonical !== binding.target.root || String(st.dev) !== binding.target.rootIdentity.device || String(st.ino) !== binding.target.rootIdentity.inode)
      throw new Error("Target identity changed");
  } catch { throw new ApiError(422, "target_unavailable", "原目标目录已丢失或被替换，任务已阻止；请明确选择新目标会话"); }
  if (binding.mode === "create") await checkDevelopmentTarget(binding.target, binding.ownerWorkspace, home);
}

/** Canonicalize a not-yet-created destination without creating directories. */
export async function canonicalSessionDirectory(path: string): Promise<string> {
  let ancestor = resolve(path); const missing: string[] = [];
  for (;;) {
    try { return join(await realpath(ancestor), ...missing); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
      missing.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
}
/** Explicit headless creation commands share the workspace creation namespace. */
export async function headlessCreation(binding: SessionBinding, location: string, home: string | undefined, secret: string, committed = false): Promise<SessionBinding> {
  const paths = await workspacePaths(binding.ownerWorkspace, home);
  const catalog = await Journal.open(join(paths.root, "session-catalog"), { secrets: [secret] });
  try {
    if (!catalog.events.length) await catalog.append("session.catalog", { formatVersion: 2, workspace: paths.workspace });
    const root = catalog.events[0]?.payload as { formatVersion?: number; workspace?: string };
    if (catalog.events[0]?.type !== "session.catalog" || root.formatVersion !== 2 || root.workspace !== paths.workspace)
      throw new ApiError(422, "session_identity", "会话创建注册日志格式不受支持");
    const prior = catalog.events.find(event => event.type === "session.create.intent" && (event.payload as { commandId?: string }).commandId === binding.creation.commandId);
    const accepted = prior?.payload as { binding: SessionBinding; payloadHash: string; location?: string } | undefined;
    if (accepted && (accepted.payloadHash !== binding.creation.payloadHash || accepted.location !== location))
      throw new ApiError(409, "command_conflict", "同一创建命令的模式、目标或会话位置不同");
    const selected = accepted?.binding ?? binding;
    if (catalog.events.some(event => event.type === "session.deleted" && (event.payload as { sessionId?: string }).sessionId === selected.sessionId))
      throw new ApiError(410, "session_deleted", "创建命令对应的会话已删除");
    if (catalog.clean(JSON.stringify(selected)) !== JSON.stringify(selected)) throw new ApiError(422, "session_identity", "会话身份不能包含凭证");
    if (!prior) await catalog.append("session.create.intent", { commandId: binding.creation.commandId, payloadHash: binding.creation.payloadHash, binding, location }, { mode: binding.mode, targetId: binding.target.id });
    if (committed && !catalog.events.some(event => event.type === "session.create.committed" && (event.payload as { sessionId?: string }).sessionId === selected.sessionId))
      await catalog.append("session.create.committed", { commandId: selected.creation.commandId, payloadHash: selected.creation.payloadHash, sessionId: selected.sessionId }, { mode: selected.mode, targetId: selected.target.id });
    return structuredClone(selected);
  } finally { await catalog.close(); }
}
