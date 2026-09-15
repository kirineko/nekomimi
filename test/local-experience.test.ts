import { it, expect, vi } from "vitest";
import { join } from "node:path";
import { rm, readFile, writeFile, symlink, stat, realpath } from "node:fs/promises";
import * as journalModule from "../src/journal.js";
import lockfile from "proper-lockfile";
import { ConfigStore } from "../src/config/store.js";
import { workspacePaths } from "../src/storage/paths.js";
import { migrate } from "../src/storage/migrate.js";
import { Sessions } from "../src/server/sessions.js";
import { Journal, readSession } from "../src/journal.js";
import { temporary, key, response, textItem, delay } from "./helpers.js";

it("persists settings and credentials without reading environment; rejects conflicts, bad URLs and corrupt files", async () => {
  const home = await temporary(),
    store = new ConfigStore(home);
  expect((await store.describe()).configured).toBe(false);
  await store.save("auth", { revision: 0, apiKey: key });
  expect((await new ConfigStore(home).snapshot()).apiKey).toBe(key);
  expect(JSON.stringify(await store.describe())).not.toContain(key);
  expect((await stat(join(home, "auth.json"))).mode & 0o777).toBe(0o600);
  const attempts = await Promise.allSettled([
    store.save("settings", {
      revision: 0,
      model: "a",
      baseUrl: "https://api.deepseek.com",
    }),
    store.save("settings", {
      revision: 0,
      model: "b",
      baseUrl: "https://api.deepseek.com",
    }),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  const saved = await store.settings();
  await expect(
    store.save("settings", {
      revision: saved.revision,
      model: "x",
      baseUrl: "https://user:secret@host",
    }),
  ).rejects.toThrow("服务地址");
  expect(await store.settings()).toEqual(saved);
  await store.save("auth", { revision: 1, apiKey: null });
  expect((await store.describe()).configured).toBe(false);
  await writeFile(join(home, "settings.json"), "{broken");
  await expect(store.settings()).rejects.toThrow("无法读取");
  expect(await readFile(join(home, "settings.json"), "utf8")).toBe("{broken");
});
it("uses canonical workspace partitions and rejects data directory links", async () => {
  const home = await temporary(),
    workspace = await temporary(),
    other = await temporary();
  const a = await workspacePaths(workspace, home),
    b = await workspacePaths(other, home);
  expect(a.sessions).not.toBe(b.sessions);
  const alias = join(await temporary(), "alias");
  await symlink(workspace, alias);
  expect((await workspacePaths(alias, home)).sessions).toBe(a.sessions);
  const bad = join(await temporary(), "home");
  await symlink(home, bad);
  await expect(workspacePaths(workspace, bad)).rejects.toThrow("symlink");
});
it("migrates only verified matching sessions, preserves bytes, skips repeats and reports corruption", async () => {
  const workspace = await temporary(),
    home = await temporary(),
    legacy = await temporary();
  const source = join(workspace, ".harness", "sessions", "old");
  const j = await Journal.open(source);
  await j.append("session.created", { workspace: await realpath(workspace) });
  await j.append("fixture", { artifact: await j.artifact("evidence") });
  await j.close();
  const before = await readFile(join(source, "journal.jsonl"));
  const paths = await workspacePaths(workspace, home);
  expect((await migrate(paths, false, legacy)).results[0]?.status).toBe(
    "ready",
  );
  expect((await migrate(paths, true, legacy)).results[0]?.status).toBe(
    "migrated",
  );
  expect(await readFile(join(paths.sessions, "old", "journal.jsonl"))).toEqual(
    before,
  );
  expect(await readFile(join(source, "journal.jsonl"))).toEqual(before);
  expect((await migrate(paths, true, legacy)).results[0]?.status).toBe(
    "skipped",
  );
  const bad = await Journal.open(
    join(workspace, ".harness", "sessions", "bad"),
  );
  await bad.append("session.created", { workspace: await realpath(workspace) });
  await bad.close();
  await writeFile(join(bad.directory, "journal.jsonl"), "broken");
  expect(
    (await migrate(paths, true, legacy)).results.find((r) => r.id === "bad")
      ?.status,
  ).toBe("error");
});
it("names once through recorded provider without polluting task history, and deletion leaves workspace untouched", async () => {
  const workspace = await temporary(),
    home = await temporary();
  await new ConfigStore(home).save("auth", { revision: 0, apiKey: key });
  const bodies: any[] = [];
  const sessions = await Sessions.open({
    workspace,
    home,
    runtime: {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        return response([
          textItem(
            body.instructions?.includes("Name this conversation")
              ? "问候任务"
              : "task result",
          ),
        ]);
      },
    },
  });
  try {
    const created = await sessions.create("新会话");
    await sessions.submit(created.id, {
      version: 1,
      commandId: "first",
      prompt: "你好，请帮我",
    });
    await sessions.active?.done;
    await sessions.naming?.done;
    expect((await sessions.list(0, 30)).sessions[0]?.title).toBe("问候任务");
    const entry = await sessions.entry(created.id);
    expect(
      entry.reader.events.filter((e) => e.type === "session.naming.started"),
    ).toHaveLength(1);
    expect(
      entry.reader.events
        .filter((e) => e.type === "context.add")
        .some((e) => JSON.stringify(e.payload).includes("问候任务")),
    ).toBe(false);
    expect(
      entry.reader.events.some(
        (e) =>
          e.type === "attempt.started" &&
          (e.payload as any).purpose === "session-title",
      ),
    ).toBe(true);
    await sessions.submit(created.id, {
      version: 1,
      commandId: "second",
      prompt: "继续",
    });
    await sessions.active?.done;
    await sessions.naming?.done;
    expect(bodies).toHaveLength(3);
    expect(bodies[1].reasoning).toEqual({ effort: "none" });
    expect(bodies[1].tools).toEqual([]);
    expect(JSON.stringify(bodies[2].input)).not.toContain("问候任务");
    const file = join(workspace, "keep.txt");
    await writeFile(file, "keep");
    const release = await sessions.downloadLease(created.id);
    await expect(sessions.remove(created.id)).rejects.toThrow("下载");
    release();
    expect(await sessions.remove(created.id)).toEqual({ status: "deleted" });
    expect(await sessions.remove(created.id)).toEqual({ status: "deleted" });
    expect(await readFile(file, "utf8")).toBe("keep");
    await expect(sessions.entry(created.id)).rejects.toThrow("不存在");
  } finally {
    await sessions.close();
  }
});
it("new user task preempts naming; running deletion is rejected", async () => {
  const workspace = await temporary(),
    home = await temporary();
  let began!: () => void;
  const naming = new Promise<void>((r) => (began = r));
  const sessions = await Sessions.open({
    workspace,
    home,
    apiKey: key,
    runtime: {
      fetch: async (_u, init) => {
        if (
          JSON.parse(String(init?.body)).instructions?.includes(
            "Name this conversation",
          )
        ) {
          began();
          return new Promise<Response>((_r, reject) => {
            if (init?.signal?.aborted) reject(new Error("abort"));
            else
              init?.signal?.addEventListener(
                "abort",
                () => reject(new Error("abort")),
                { once: true },
              );
          });
        }
        return response([textItem()]);
      },
    },
  });
  try {
    const s = await sessions.create("new");
    await sessions.submit(s.id, {
      version: 1,
      commandId: "first",
      prompt: "hello",
    });
    await naming;
    await expect(sessions.remove(s.id)).rejects.toThrow("运行");
    await sessions.submit(s.id, {
      version: 1,
      commandId: "next",
      prompt: "continue",
    });
    await sessions.active?.done;
    await sessions.naming?.done;
    const log = await readSession(join(sessions.root, s.id));
    expect(log.events.filter((e) => e.type === "run.finished")).toHaveLength(2);
    expect(
      log.events.some(
        (e) =>
          e.type === "session.naming.finished" &&
          (e.payload as any).status === "cancelled",
      ),
    ).toBe(true);
  } finally {
    await sessions.close();
  }
});

it("keeps old config on failed atomic write and ignores environment-only credentials", async () => {
  const home = await temporary(), store = new ConfigStore(home);
  vi.stubEnv("DEEPSEEK_API_KEY", key);
  try {
    expect((await store.snapshot()).apiKey).toBeUndefined();
    await store.save("auth", { revision: 0, apiKey: key });
    const before = await readFile(join(home, "auth.json"));
    const fault = vi.spyOn(journalModule, "atomicFile").mockRejectedValueOnce(new Error("injected write failure"));
    try {
      await expect(store.save("auth", { revision: 1, apiKey: "replacement" })).rejects.toThrow("injected");
      expect(await readFile(join(home, "auth.json"))).toEqual(before);
    } finally { fault.mockRestore(); }
  } finally { vi.unstubAllEnvs(); }
});
it("retries migration after registry failure, rejects active sources and never overwrites conflict", async () => {
  const workspace = await realpath(await temporary()), home = await temporary(), legacy = await temporary();
  const source = join(workspace, ".harness", "sessions", "retry");
  const j = await Journal.open(source);
  await j.append("session.created", { workspace });
  await j.close();
  const paths = await workspacePaths(workspace, home);
  const release = await lockfile.lock(source);
  try { expect((await migrate(paths, true, legacy)).results[0]?.message).toContain("正在使用"); }
  finally { await release(); }
  const atomic = journalModule.atomicFile;
  const fault = vi.spyOn(journalModule, "atomicFile").mockImplementation(async (path, data) => {
    if (path.endsWith("migrations.json")) throw new Error("injected registry failure");
    return atomic(path, data);
  });
  try { expect((await migrate(paths, true, legacy)).results[0]?.status).toBe("error"); }
  finally { fault.mockRestore(); }
  expect((await migrate(paths, true, legacy)).results[0]?.status).toBe("migrated");
  const changed = await Journal.open(source);
  await changed.append("fixture", { changed: true });
  await changed.close();
  const before = await readFile(join(paths.sessions, "retry", "journal.jsonl"));
  expect((await migrate(paths, true, legacy)).results[0]?.status).toBe("error");
  expect(await readFile(join(paths.sessions, "retry", "journal.jsonl"))).toEqual(before);
});
it("captures configuration at submission and applies saved changes to the next task", async () => {
  const home = await temporary(), workspace = await temporary(), store = new ConfigStore(home);
  await store.save("auth", { revision: 0, apiKey: key });
  let resume!: () => void, started!: () => void;
  const gate = new Promise<void>(r => resume = r), began = new Promise<void>(r => started = r);
  const models: string[] = [];
  const sessions = await Sessions.open({ home, workspace, naming: false, runtime: { fetch: async (_u, init) => {
    models.push(JSON.parse(String(init?.body)).model);
    if (models.length === 1) { started(); await gate; }
    return response([textItem()]);
  } } });
  try {
    const s = await sessions.create("new");
    await sessions.submit(s.id, { version: 1, commandId: "one", prompt: "hello" });
    await began;
    await store.save("settings", { revision: 0, model: "next-model", baseUrl: "https://api.deepseek.com" });
    resume(); await sessions.active?.done;
    await sessions.submit(s.id, { version: 1, commandId: "two", prompt: "continue" });
    await sessions.active?.done;
    expect(models).toEqual(["deepseek-flash", "next-model"]);
  } finally { resume(); await sessions.close(); }
});

it("serializes concurrent migrations without losing deletion history", async () => {
  const workspace = await realpath(await temporary());
  const paths = await workspacePaths(workspace, await temporary());
  const legacy = await temporary();
  for (const name of ["a", "b"]) {
    const j = await Journal.open(join(workspace, ".harness", "sessions", name));
    await j.append("session.created", { workspace }); await j.close();
  }
  await Promise.all([migrate(paths, true, legacy), migrate(paths, true, legacy)]);
  const records = JSON.parse(await readFile(join(paths.root, "migrations.json"), "utf8"));
  expect(Object.keys(records).sort()).toEqual(["workspace:a", "workspace:b"]);
  await rm(join(paths.sessions, "a"), { recursive: true });
  expect((await migrate(paths, true, legacy)).results.every(r => r.status === "skipped")).toBe(true);
  await expect(stat(join(paths.sessions, "a"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("HTML redaction preserves row structure even when content matches field names", async () => {
  const { exportSession } = await import("../src/export.js");
  const dir = await temporary(), output = join(await temporary(), "view.html");
  const j = await Journal.open(dir);
  await j.append("context.add", { source: "user", item: { role: "user", content: "text refs kind private" } });
  await j.close();
  const before = await readFile(join(dir, "journal.jsonl"));
  await exportSession(dir, { format: "html", output, redact: ["text", "refs", "kind", "private"] });
  const html = await readFile(output, "utf8");
  expect(html).toContain('id="round-1"');
  expect(html).not.toContain("private");
  expect(html).toContain("[REDACTED]");
  expect(await readFile(join(dir, "journal.jsonl"))).toEqual(before);
});
