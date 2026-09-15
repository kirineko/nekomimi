import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, realpath, lstat, readFile } from "node:fs/promises";
import { hash, atomicFile } from "../journal.js";
export const userHome = (home?: string) =>
  resolve(home ?? join(homedir(), ".nekomimi"));
export async function directory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink())
    throw new Error("Data directory symlink rejected");
  return realpath(path);
}
export async function workspacePaths(workspace: string, home?: string) {
  const canonical = await realpath(workspace);
  const base = await directory(userHome(home));
  const parent = await directory(join(base, "workspaces"));
  const root = await directory(join(parent, hash(canonical)));
  const meta = join(root, "workspace.json");
  try {
    if (JSON.parse(await readFile(meta, "utf8")).workspace !== canonical)
      throw new Error("Workspace identity mismatch");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    await atomicFile(
      meta,
      JSON.stringify({ version: 1, workspace: canonical }),
    );
  }
  return {
    home: base,
    workspace: canonical,
    root,
    sessions: await directory(join(root, "sessions")),
    deleting: await directory(join(root, "deleting")),
  };
}
