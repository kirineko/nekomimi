import { lstat, realpath, readdir, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { spawn } from "node:child_process";
import { hash } from "../journal.js";
import { ApiError } from "../shared/protocol.js";
export interface FileEntry {
  path: string;
  name: string;
  type: "directory" | "file" | "unavailable";
}
export async function workspacePath(
  root: string,
  input: string,
  directory = false,
) {
  if (input.includes("\0") || input.length > 8192)
    throw new ApiError(400, "path", "路径无效");
  const canonicalRoot = await realpath(root);
  const inside = (path: string) => {
    const r = relative(canonicalRoot, path);
    return (
      r !== ".." &&
      !r.startsWith("../") &&
      !r.startsWith("..\\") &&
      !isAbsolute(r)
    );
  };
  const candidate = resolve(canonicalRoot, input);
  if (!inside(candidate)) throw new ApiError(403, "path", "路径不在项目内");
  try {
    const target = await realpath(candidate);
    if (!inside(target)) throw new ApiError(403, "path", "符号链接指向项目外");
    const info = await lstat(target);
    if (!(directory ? info.isDirectory() : info.isFile()))
      throw new ApiError(
        400,
        "path",
        directory ? "目标不是目录" : "只能打开普通文件",
      );
    return target;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(404, "path", "文件不存在或无权访问，请刷新");
  }
}
export async function listFiles(
  root: string,
  path = ".",
  hidden = false,
  cursor?: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  root = await realpath(root);
  const target = await workspacePath(root, path, true);
  // Keep tree identities logical; real paths are only used for validation.
  const logical = resolve(root, path);
  const ancestors = new Set([root]);
  let parent = root;
  for (const part of relative(root, logical).split(sep).filter(Boolean)) {
    parent = resolve(parent, part);
    const canonical = await workspacePath(root, parent, true);
    if (ancestors.has(canonical))
      throw new ApiError(403, "directory_cycle", "目录链接指向祖先，无法展开");
    ancestors.add(canonical);
  }
  const info = await stat(target);
  const stamp = hash(`${target}:${hidden}:${info.mtimeMs}:${info.ctimeMs}`);
  let offset = 0;
  if (cursor) {
    const [revision, value] = cursor.split(":");
    offset = Number(value);
    if (
      revision !== stamp ||
      !/^\d+$/.test(value ?? "") ||
      !Number.isSafeInteger(offset)
    )
      throw new ApiError(409, "directory_changed", "目录已变化，请刷新");
  }
  const all = (await readdir(target, { withFileTypes: true }))
    .filter((e) => hidden || !e.name.startsWith("."))
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name, "en"),
    );
  const entries: FileEntry[] = [];
  for (const e of all.slice(offset, offset + 200)) {
    signal?.throwIfAborted();
    const child = relative(root, resolve(logical, e.name));
    let type: FileEntry["type"] = e.isDirectory()
      ? "directory"
      : e.isFile()
        ? "file"
        : "unavailable";
    if (e.isSymbolicLink()) {
      try {
        const canonical = await workspacePath(root, child, true);
        type = ancestors.has(canonical) ? "unavailable" : "directory";
      } catch {
        try {
          await workspacePath(root, child);
          type = "file";
        } catch {}
      }
    }
    entries.push({ name: e.name, path: process.platform === "win32" ? child.replace(/\\/g, "/") : child, type });
  }
  const after = await stat(target);
  if (stamp !== hash(`${target}:${hidden}:${after.mtimeMs}:${after.ctimeMs}`))
    throw new ApiError(409, "directory_changed", "目录已变化，请刷新");
  return {
    entries,
    next: offset + 200 < all.length ? `${stamp}:${offset + 200}` : undefined,
  };
}
/** Paths are arguments/environment data, never interpolated shell source. */
export function openerCommand(path: string, platform = process.platform) {
  if (platform === "darwin")
    return { command: "/usr/bin/open", args: [path], env: process.env };
  if (platform === "win32")
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; $p=New-Object System.Diagnostics.ProcessStartInfo; $p.FileName=$env:NEKOMIMI_OPEN_FILE; $p.UseShellExecute=$true; [System.Diagnostics.Process]::Start($p) | Out-Null",
      ],
      env: { ...process.env, NEKOMIMI_OPEN_FILE: path },
    };
  return { command: "xdg-open", args: [path], env: process.env };
}
export async function defaultOpen(path: string) {
  const { command, args, env } = openerCommand(path);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "ignore", shell: false });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("默认程序启动超时"));
    }, 10000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("无法启动默认程序"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error("默认程序打开失败，请检查文件关联或桌面环境"));
    });
  });
}
export class WorkspaceFiles {
  private pending = new Map<string, Promise<{ status: string }>>();
  constructor(
    readonly root: string,
    private opener = defaultOpen,
  ) {}
  async open(input: string) {
    const path = await workspacePath(this.root, input);
    const prior = this.pending.get(path);
    if (prior) return prior;
    const next = (async () => {
      if ((await workspacePath(this.root, input)) !== path)
        throw new ApiError(409, "path", "文件路径已变化");
      try {
        await this.opener(path);
      } catch (e) {
        throw new ApiError(422, "open_failed", String(e));
      }
      return { status: "requested" };
    })();
    this.pending.set(path, next);
    try {
      return await next;
    } finally {
      this.pending.delete(path);
    }
  }
}
