import {
  readdir,
  realpath,
  readFile,
  cp,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import lockfile from "proper-lockfile";
import {
  readSession,
  readArtifact,
  artifactRefs,
  hash,
  atomicFile,
  id,
} from "../journal.js";
import { validId } from "../shared/protocol.js";
import type { workspacePaths } from "./paths.js";
type Paths = Awaited<ReturnType<typeof workspacePaths>>;
export interface Migration {
  source: string;
  id: string;
  status: string;
  message?: string;
}
async function noLinks(path: string): Promise<void> {
  if ((await lstat(path)).isSymbolicLink()) throw new Error("符号链接不能迁移");
  if ((await lstat(path)).isDirectory())
    for (const name of await readdir(path)) await noLinks(join(path, name));
}
export async function migrate(
  paths: Paths,
  execute = false,
  legacyHome = join(homedir(), ".deepy-harness"),
) {
  const release = await lockfile.lock(paths.root, {
    retries: { retries: 20, minTimeout: 25, maxTimeout: 100 },
  });
  try {
    return await migrateLocked(paths, execute, legacyHome);
  } finally {
    await release();
  }
}
async function migrateLocked(paths: Paths, execute: boolean, legacyHome: string) {
  const results: Migration[] = [];
  const registry = join(paths.root, "migrations.json");
  let records: Record<string, string> = {};
  try {
    records = JSON.parse(await readFile(registry, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  for (const [label, root] of [
    ["workspace", join(paths.workspace, ".harness", "sessions")],
    ["legacy", join(legacyHome, "sessions")],
  ] as const) {
    let names: string[];
    try {
      if ((await realpath(root)) !== root)
        throw new Error("旧目录包含符号链接");
      names = await readdir(root);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        results.push({
          source: label,
          id: "",
          status: "error",
          message: "旧目录不可访问",
        });
      continue;
    }
    for (const name of names.filter(validId)) {
      const source = join(root, name),
        target = join(paths.sessions, name),
        key = `${label}:${name}`;
      let release: (() => Promise<void>) | undefined;
      let temp: string | undefined;
      try {
        await noLinks(source);
        release = await lockfile.lock(source, { retries: 0 });
        const snapshot = await readSession(source);
        if (
          (
            snapshot.events.find((e) => e.type === "session.created")
              ?.payload as any
          )?.workspace !== paths.workspace
        )
          continue;
        if (snapshot.tornBytes || snapshot.tentativeEvents)
          throw new Error("源会话包含未验证尾部，先诊断后迁移");
        for (const event of snapshot.events)
          for (const ref of artifactRefs(event.payload))
            await readArtifact(source, ref);
        const digest = hash(await readFile(join(source, "journal.jsonl")));
        if (records[key]) {
          if (records[key] !== digest)
            throw new Error("源会话在迁移后发生变化");
          results.push({ source: label, id: name, status: "skipped" });
          continue;
        }
        let exists = false;
        try {
          await lstat(target);
          exists = true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (exists) {
          await noLinks(target);
          const current = await readSession(target);
          if (hash(await readFile(join(target, "journal.jsonl"))) !== digest)
            throw new Error("目标 ID 内容冲突");
          for (const event of current.events)
            for (const ref of artifactRefs(event.payload))
              await readArtifact(target, ref);
        } else if (execute) {
          temp = join(paths.root, `migration-${id()}`);
          await cp(source, temp, {
            recursive: true,
            errorOnExist: true,
            force: false,
          });
          const copied = await readSession(temp);
          if (hash(await readFile(join(temp, "journal.jsonl"))) !== digest)
            throw new Error("迁移校验失败");
          for (const event of copied.events)
            for (const ref of artifactRefs(event.payload))
              await readArtifact(temp, ref);
          await rename(temp, target);
          temp = undefined;
        }
        if (execute) {
          records[key] = digest;
          await atomicFile(registry, JSON.stringify(records));
        }
        results.push({
          source: label,
          id: name,
          status: execute ? "migrated" : exists ? "existing" : "ready",
        });
      } catch (e) {
        results.push({
          source: label,
          id: name,
          status: "error",
          message:
            (e as NodeJS.ErrnoException).code === "ELOCKED"
              ? "会话正在使用"
              : String(e),
        });
      } finally {
        if (temp) await rm(temp, { recursive: true, force: true });
        await release?.();
      }
    }
  }
  return { results };
}
