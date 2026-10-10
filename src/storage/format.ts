import { lstat, mkdir, open, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { ApiError } from "../shared/protocol.js";

import { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from "../shared/versions.js";
export { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from "../shared/versions.js";
const MARKER = "nekomimi-format.json";
const marker = { product: "nekomimi", formatVersion: DATA_FORMAT_VERSION } as const;
export class IncompatibleFormatError extends ApiError {
  constructor(readonly path: string, reason?: string) {
    super(422, "incompatible_format", `${path} 格式不受支持${reason ? `（${reason}）` : ""}；请选择独立的新数据目录，旧文件不会迁移或覆盖`);
  }
}
/** The new runtime's default partition; explicit selections keep their exact path. */
export function newDataHome(selected?: string): string {
  return resolve(selected ?? join(homedir(), ".nekomimi", "v2"));
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** Admission precedes configuration interpretation, SDK imports, and candidate execution. */
export function requireNewContract(value: unknown, kind: "config" | "candidate" | "extension", path: string): void {
  const input = record(value);
  if (!input || (kind === "extension" ? input.sdkVersion !== SDK_CONTRACT_VERSION : input.formatVersion !== DATA_FORMAT_VERSION))
    throw new IncompatibleFormatError(path);
}
/** Read-only preflight. Never creates locks, repairs a Journal, or imports code. */
export async function inspectDataHome(selected: string): Promise<"missing" | "empty" | "supported"> {
  const path = resolve(selected);
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new IncompatibleFormatError(path, "Data directory symlink rejected");
    if (!stat.isDirectory()) throw new IncompatibleFormatError(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
  const entries = await readdir(path);
  if (!entries.length) return "empty";
  const file = join(path, MARKER);
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error("Invalid format marker");
    const value = record(JSON.parse(await readFile(file, "utf8")));
    if (value?.product !== marker.product || value.formatVersion !== marker.formatVersion) throw new Error("Invalid format marker");
  } catch { throw new IncompatibleFormatError(path); }
  return "supported";
}
const initializing = new Map<string, Promise<string>>();
/** Serialize concurrent in-process initialization; another process still fails closed on incomplete metadata. */
export async function prepareDataHome(selected: string): Promise<string> {
  const path = resolve(selected);
  const existing = initializing.get(path);
  if (existing) return existing;
  const pending = initializeDataHome(path);
  initializing.set(path, pending);
  try { return await pending; } finally { initializing.delete(path); }
}
/** Only an explicitly selected missing/empty partition may receive a new marker. */
async function initializeDataHome(path: string): Promise<string> {
  if (await inspectDataHome(path) === "supported") return path;
  await mkdir(path, { recursive: true, mode: 0o700 });
  // Recheck after directory creation; a concurrent old writer must not be adopted.
  const state = await inspectDataHome(path);
  if (state === "supported") return path;
  const file = join(path, MARKER);
  try {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(marker) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    const directory = await open(path, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await inspectDataHome(path);
  }
  return path;
}
