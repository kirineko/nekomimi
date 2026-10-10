import { join } from "node:path";
import { mkdir, realpath, lstat, readFile } from "node:fs/promises";
import { hash, atomicFile } from "../journal.js";
import { newDataHome, prepareDataHome, requireNewContract, DATA_FORMAT_VERSION } from "./format.js";
export const userHome = (home?: string) =>
  newDataHome(home);
export async function directory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink())
    throw new Error("Data directory symlink rejected");
  return realpath(path);
}
export async function workspacePaths(workspace: string, home?: string) {
  const canonical = await realpath(workspace);
  const base = await prepareDataHome(userHome(home));
  const parent = await directory(join(base, "workspaces"));
  const root = await directory(join(parent, hash(canonical)));
  const meta = join(root, "workspace.json");
  try {
    const identity = JSON.parse(await readFile(meta, "utf8"));
    requireNewContract(identity, "config", meta);
    if (identity.version !== 2 || identity.workspace !== canonical)
      throw new Error("Workspace identity mismatch");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    await atomicFile(
      meta,
      JSON.stringify({ version: 2, formatVersion: DATA_FORMAT_VERSION, workspace: canonical }),
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
