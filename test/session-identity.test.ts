import { afterEach, expect, it } from "vitest";
import { mkdir, readFile, readdir, rename, rm, symlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { startWeb } from "../src/server/app.js";
import { Sessions } from "../src/server/sessions.js";
import { readSession, Journal } from "../src/journal.js";
import { run } from "../src/runtime.js";
import { currentTargetHost, sessionBinding } from "../src/session/identity.js";
import { CustomizationHost } from "../src/customization/host.js";
import { temporary, key, response, textItem, callItem } from "./helpers.js";
const services: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); });
async function setup(transport?: typeof globalThis.fetch) {
  const workspace = await temporary(), home = await temporary(); let calls = 0;
  const app = await startWeb({ workspace, home, apiKey: key, naming: false, runtime: { fetch: async (...args) => { calls++; return transport ? transport(...args) : response([textItem()]); } } });
  services.push(app);
  const request = (path: string, value?: unknown) => fetch(app.origin + "/api/v1" + path, {
    method: value === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  return { workspace, home, app, request, calls: () => calls };
}
it("deduplicates concurrent creation and restart without naming or model dispatch", async () => {
  const f = await setup(), input = { version: 1, title: "fixed", commandId: "create-once", mode: "work" };
  const values = await Promise.all([f.request("/sessions", input), f.request("/sessions", input)]);
  expect(values.map(value => value.status)).toEqual([201, 201]);
  const [a, b] = await Promise.all(values.map(value => value.json()));
  expect(a).toEqual(b); expect(a.binding.mode).toBe("work"); expect(a.binding.creation.commandId).toBe("create-once");
  expect(await readdir(f.app.sessions.root)).toEqual([a.id]);
  const snapshot = await readSession(join(f.app.sessions.root, a.id));
  expect(snapshot.events.filter(event => event.type === "session.created")).toHaveLength(1);
  expect(snapshot.events.every(event => event.sessionId === a.id)).toBe(true);
  expect(sessionBinding(snapshot.events)).toEqual(a.binding); expect(f.calls()).toBe(0);
  await f.app.close(); services.splice(services.indexOf(f.app), 1);
  const service = await Sessions.open({ workspace: f.workspace, home: f.home, naming: false }); services.push(service);
  expect((await service.create("fixed", { commandId: "create-once", mode: "work" })).id).toBe(a.id);
});
it("rejects creation command content or mode changes before allocating another session", async () => {
  const f = await setup(), developer = await temporary();
  const input = { version: 1, title: "fixed", commandId: "fixed-command", mode: "work" };
  expect((await f.request("/sessions", input)).status).toBe(201);
  expect((await f.request("/sessions", { ...input, title: "changed" })).status).toBe(409);
  expect((await f.request("/sessions", { ...input, mode: "create", target: { kind: "extension", root: developer } })).status).toBe(409);
  expect(await readdir(f.app.sessions.root)).toHaveLength(1); expect(f.calls()).toBe(0);
});
it("rejects a submit payload that attempts to rewrite the bound mode or target", async () => {
  const f = await setup(), created = await f.app.sessions.create("bound");
  for (const change of [{ mode: "create" }, { target: { kind: "extension", root: await temporary() } }]) {
    const result = await f.request(`/sessions/${created.id}/submit`, { version: 1, commandId: "rewrite", prompt: "task", ...change });
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ error: { code: "session_identity" } });
  }
  expect(f.calls()).toBe(0);
  const snapshot = await readSession(join(f.app.sessions.root, created.id));
  expect(sessionBinding(snapshot.events)?.mode).toBe("work");
  expect(snapshot.events.some(event => event.type === "command.accepted")).toBe(false);
});
it("captures canonical create target and host, diagnoses missing target without falling back", async () => {
  const f = await setup(), developer = await temporary(), alias = join(await temporary(), "alias");
  await symlink(developer, alias);
  const input = { version: 1, title: "develop", commandId: "develop-once", mode: "create", target: { kind: "extension", root: alias } };
  const created = await (await f.request("/sessions", input)).json();
  expect(created.binding.target.root).toBe(await realpath(developer)); expect(created.binding.target.host).toEqual(await currentTargetHost());
  const before = await readFile(join(f.app.sessions.root, created.id, "journal.jsonl"));
  await rm(developer, { recursive: true });
  const snapshot = await (await f.request(`/sessions/${created.id}/snapshot`)).json();
  expect(snapshot.session.targetState).toBe("unavailable");
  const submitted = await f.request(`/sessions/${created.id}/submit`, { version: 1, commandId: "must-not-run", prompt: "write" });
  expect(submitted.status).toBe(422); expect(await submitted.json()).toMatchObject({ error: { code: "target_unavailable" } });
  expect((await (await f.request("/sessions", input)).json()).id).toBe(created.id);
  expect(await readFile(join(f.app.sessions.root, created.id, "journal.jsonl"))).toEqual(before); expect(f.calls()).toBe(0);
});
it("rejects a replacement directory even when its pathname is unchanged", async () => {
  const f = await setup(), developer = await temporary();
  const created = await f.app.sessions.create("develop", { commandId: "replace", mode: "create", target: { kind: "extension", root: developer } });
  await rename(developer, developer + "-old"); await mkdir(developer);
  await expect(f.app.sessions.submit(created.id, { version: 1, commandId: "run", prompt: "write" })).rejects.toThrow("丢失或被替换");
  expect((await f.app.sessions.list(0, 30)).sessions[0]?.targetState).toBe("unavailable"); expect(f.calls()).toBe(0);
});
it("executes an explicitly submitted create task in its selected development root", async () => {
  let requests = 0;
  const f = await setup(async () => response(++requests === 1 ? [callItem("write", { path: "created", content: "development" })] : [textItem()]));
  const developer = await temporary();
  const created = await f.app.sessions.create("develop", { commandId: "create-run", mode: "create", target: { kind: "extension", root: developer } });
  expect(f.calls()).toBe(0);
  await f.app.sessions.submit(created.id, { version: 1, commandId: "explicit-run", prompt: "write" });
  await f.app.sessions.active?.done;
  expect(await readFile(join(developer, "created"), "utf8")).toBe("development");
  await expect(readFile(join(f.workspace, "created"))).rejects.toThrow();
  const snapshot = await readSession(join(f.app.sessions.root, created.id));
  const request = snapshot.events.find(event => event.type === "request.dispatched")!;
  expect(request.sessionId).toBe(created.id); expect(request.mode).toBe("create"); expect(request.targetId).toBe(created.binding!.target.id);
});
it("rejects invalid mode scopes and mismatched host versions before a model request", async () => {
  const f = await setup(), developer = await temporary();
  for (const target of [undefined, { kind: "extension", root: f.workspace }, { kind: "project", root: developer }]) {
    const result = await f.request("/sessions", { version: 1, title: "bad", commandId: "invalid", mode: "create", target });
    expect(result.status).toBeGreaterThanOrEqual(400);
  }
  expect((await f.request("/sessions", { version: 1, title: "bad", commandId: "foreign", mode: "work", target: { kind: "project", root: developer } })).status).toBe(403);
  expect((await f.request("/sessions", { version: 1, title: "bad", commandId: "host", mode: "create", target: { kind: "extension", root: developer, host: { ...await currentTargetHost(), build: "0".repeat(64) } } })).status).toBe(409);
  expect(await readdir(f.app.sessions.root)).toHaveLength(0); expect(f.calls()).toBe(0);
});
it("retains creation receipts after deletion and never recreates the deleted identity", async () => {
  const f = await setup(), input = { commandId: "deleted-creation", mode: "work" as const };
  const created = await f.app.sessions.create("delete", input);
  await f.app.sessions.remove(created.id);
  await expect(f.app.sessions.create("delete", input)).rejects.toThrow("已删除");
  expect(await readdir(f.app.sessions.root)).toHaveLength(0); expect(f.calls()).toBe(0);
});
it("hides a logically deleted session even from a cached list and can finish physical cleanup", async () => {
  const f = await setup();
  const created = await f.app.sessions.create("cleanup", { commandId: "cleanup-creation", mode: "work" });
  expect((await f.app.sessions.list(0, 30)).sessions).toHaveLength(1);
  const catalog = await Journal.open(join(f.app.sessions.paths.root, "session-catalog"));
  try { await catalog.append("session.deleted", { sessionId: created.id }); } finally { await catalog.close(); }
  expect((await f.app.sessions.list(0, 30)).sessions).toHaveLength(0);
  await expect(f.app.sessions.entry(created.id)).rejects.toThrow("已删除");
  await expect(f.app.sessions.create("cleanup", { commandId: "cleanup-creation", mode: "work" })).rejects.toThrow("已删除");
  expect(await f.app.sessions.remove(created.id)).toEqual({ status: "deleted" });
  expect(await readdir(f.app.sessions.root)).toHaveLength(0); expect(f.calls()).toBe(0);
});
it.each(["intent", "identity", "created", "committed"] as const)("recovers a creation receipt after interruption at %s without duplicate identity", async stage => {
  const workspace = await temporary(), home = await temporary(); let injected = false;
  const options = { workspace, home, naming: false, creationFault: async (point: string) => { if (!injected && point === stage) { injected = true; throw new Error("creation interrupted"); } } };
  const first = await Sessions.open(options); services.push(first);
  const creation = { commandId: "interrupted", mode: "work" as const };
  await expect(first.create("fixed", creation)).rejects.toThrow("creation interrupted");
  await first.close(); services.splice(services.indexOf(first), 1);
  const next = await Sessions.open({ workspace, home, naming: false }); services.push(next);
  const result = await next.create("fixed", creation);
  expect(await readdir(next.root)).toEqual([result.id]);
  const events = (await readSession(join(next.root, result.id))).events;
  expect(events.filter(event => event.type === "session.created")).toHaveLength(1);
  expect(events.filter(event => event.type === "web.session")).toHaveLength(1);
  expect(events.some(event => event.type === "request.dispatched" || event.type === "tool.intent")).toBe(false);
  const catalog = (await readSession(join(next.paths.root, "session-catalog"))).events;
  expect(catalog.filter(event => event.type === "session.create.intent")).toHaveLength(1);
  expect(catalog.filter(event => event.type === "session.create.committed")).toHaveLength(1);
});
it("headless requests and tools inherit the immutable mode and target identity", async () => {
  const workspace = await temporary(), home = await temporary(), session = join(await temporary(), "session"); let calls = 0;
  const options = { workspace, home, session, apiKey: key, prompt: "write", tools: ["write"], fetch: async () => response(++calls === 1 ? [callItem("write", { path: "result", content: "ok" })] : [textItem()]) };
  expect((await run(options)).status).toBe("completed");
  const snapshot = await readSession(session), binding = sessionBinding(snapshot.events)!;
  expect(binding.mode).toBe("work");
  for (const event of snapshot.events.filter(event => ["run.started", "request.dispatched", "tool.intent", "tool.completed"].includes(event.type))) {
    expect(event.mode).toBe("work"); expect(event.targetId).toBe(binding.target.id);
  }
  const bytes = await readFile(join(session, "journal.jsonl"));
  await expect(run({ ...options, mode: "create" })).rejects.toThrow("不可原地改变");
  expect(await readFile(join(session, "journal.jsonl"))).toEqual(bytes); expect(calls).toBe(2);
});
it("refuses a supplied customization host belonging to another target before acquiring factories", async () => {
  const workspace = await temporary(), host = new CustomizationHost(await temporary(), await temporary()); services.push(host);
  const session = join(await temporary(), "foreign-host");
  await expect(run({ workspace, customization: host, session, apiKey: key, prompt: "work" })).rejects.toThrow("定制宿主必须属于");
  expect(host.active).toBeUndefined(); await expect(readFile(join(session, "journal.jsonl"))).rejects.toThrow();
});
it("blocks dispatch when the target is replaced after model completion but before a tool call", async () => {
  const workspace = await temporary(), home = await temporary(), session = join(await temporary(), "moving-target"); let calls = 0;
  const result = await run({ workspace, home, session, apiKey: key, prompt: "write", tools: ["write"], fetch: async () => {
    calls++; await rename(workspace, workspace + "-original"); await mkdir(workspace);
    return response([callItem("write", { path: "never", content: "wrong target" })]);
  } });
  expect(result.status).toBe("failed"); expect(calls).toBe(1);
  await expect(readFile(join(workspace, "never"))).rejects.toThrow();
  expect((await readSession(session)).events.some(event => event.type === "tool.intent")).toBe(false);
});
it("deduplicates explicit headless creation identities and rejects reuse at a different location", async () => {
  const workspace = await temporary(), home = await temporary(), root = await temporary(); let calls = 0;
  const options = { workspace, home, session: join(root, "first"), createCommandId: "headless-create", apiKey: key, prompt: "work", fetch: async () => { calls++; return response([textItem()]); } };
  const first = await run(options), second = await run({ ...options, prompt: "explicit new task" });
  expect(second.sessionId).toBe(first.sessionId); expect(second.runId).not.toBe(first.runId);
  await expect(run({ ...options, session: join(root, "second") })).rejects.toThrow("同一创建命令");
  await expect(readFile(join(root, "second", "journal.jsonl"))).rejects.toThrow();
  const events = (await readSession(options.session)).events;
  expect(events.filter(event => event.type === "session.created")).toHaveLength(1); expect(calls).toBe(2);
});
it("redacts configured credentials from creation receipts and conversation titles", async () => {
  const f = await setup();
  const created = await f.app.sessions.create("title " + key, { commandId: "secret-title", mode: "work" });
  expect(created.title).not.toContain(key);
  const session = await readFile(join(f.app.sessions.root, created.id, "journal.jsonl"), "utf8");
  const catalog = await readFile(join(f.app.sessions.paths.root, "session-catalog", "journal.jsonl"), "utf8");
  expect(session).not.toContain(key); expect(catalog).not.toContain(key); expect(f.calls()).toBe(0);
});
