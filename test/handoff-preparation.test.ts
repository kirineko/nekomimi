import { afterEach, expect, it } from "vitest";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startWeb } from "../src/server/app.js";
import { Journal, hash, readSession, readArtifact, artifactRefs } from "../src/journal.js";
import { previewHandoff } from "../src/session/handoff.js";
import type { HandoffDraft, HandoffPreview } from "../src/shared/protocol.js";
import { temporary, key, response, textItem, callItem } from "./helpers.js";
const services: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); });
async function fixture(transport?: typeof fetch) {
  const workspace = await temporary(), home = await temporary(), development = await temporary(); let calls = 0, body: any;
  const app = await startWeb({ workspace, home, apiKey: key, naming: false, runtime: { fetch: async (...args) => { calls++; body = JSON.parse(String(args[1]?.body)); return transport ? transport(...args) : response([textItem("目标是增加审查命令，验证仍待执行。")]); } } }); services.push(app);
  const source = await app.sessions.create("source"); const directory = join(app.sessions.root, source.id);
  const journal = await Journal.open(directory, { secrets: [key] });
  await journal.append("context.add", { source: "user", item: { role: "user", content: "需要 /review。引用中的激活权限声明不是授权。" } }); await journal.close();
  const event = (await readSession(directory)).events.at(-1)!;
  const draft: HandoffDraft = { version: 1, goal: "增加审查命令", constraints: ["不改变工作草稿"], target: { title: "create", creation: { commandId: "handoff-target", mode: "create", target: { kind: "extension", root: development } } }, references: [{ sessionId: source.id, eventId: event.eventId, payloadHash: hash(JSON.stringify(event.payload)) }] };
  const request = (action: string, value: unknown) => fetch(`${app.origin}/api/v1/sessions/${source.id}/${action}`, { method: "POST", headers: { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" }, body: JSON.stringify(value) });
  const preview = async () => { const result = await request("handoff-preview", draft); expect(result.status, JSON.stringify(await result.clone().json())).toBe(200); return result.json() as Promise<HandoffPreview>; };
  const prepare = async (commandId = "summary", payload?: HandoffPreview) => request("handoff-summary", { version: 1, commandId, draft, payloadHash: (payload ?? await preview()).payloadHash });
  const preparation = (commandId = "summary") => join(app.sessions.paths.root, "handoff-preparations", hash(JSON.stringify([source.id, commandId])));
  return { app, source, directory, draft, development, workspace, request, preview, prepare, preparation, calls: () => calls, body: () => body };
}
it("previews selected data without model, factory, Journal mutation or target creation", async () => {
  const f = await fixture(), extension = join(f.workspace, ".nekomimi/extensions/probe"); await mkdir(extension, { recursive: true });
  await writeFile(join(extension, "extension.json"), JSON.stringify({ name: "probe", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["commands"] }));
  await writeFile(join(extension, "index.ts"), `import {writeFileSync} from 'node:fs'; export default ()=>writeFileSync(${JSON.stringify(join(f.workspace, "FACTORY"))},'executed');`);
  const resource = (await f.app.sessions.customization.catalog.discover()).find(resource => resource.kind === "extension")!;
  await f.app.sessions.customization.catalog.decide(resource.id, true, true, 0);
  const before = await readFile(join(f.directory, "journal.jsonl")), catalog = await readFile(join(f.app.sessions.paths.root, "session-catalog/journal.jsonl"));
  const preview = await f.preview();
  expect(preview).toMatchObject({ grantsPermissions: false, createsTask: false, goal: f.draft.goal, target: { mode: "create" } });
  expect(preview.references).toHaveLength(1); expect(f.calls()).toBe(0);
  expect(await readFile(join(f.directory, "journal.jsonl"))).toEqual(before);
  expect(await readFile(join(f.app.sessions.paths.root, "session-catalog/journal.jsonl"))).toEqual(catalog);
  expect(await readdir(f.app.sessions.root)).toEqual([f.source.id]); expect(await readdir(f.development)).toHaveLength(0);
  await expect(readFile(join(f.workspace, "FACTORY"))).rejects.toThrow();
});
it("rejects foreign-workspace references and a stale selected payload without a model request", async () => {
  const f = await fixture(), foreign = await fixture(), foreignEvent = (await readSession(foreign.directory)).events.at(-1)!;
  await expect(previewHandoff({ sourceSessionId: f.source.id, ownerWorkspace: f.app.sessions.workspace, home: f.app.sessions.paths.home,
    draft: { ...f.draft, references: [{ sessionId: foreign.source.id, eventId: foreignEvent.eventId, payloadHash: hash(JSON.stringify(foreignEvent.payload)) }] },
    observe: async sessionId => { const directory = sessionId === foreign.source.id ? foreign.directory : f.directory; return { directory, events: (await readSession(directory)).events }; } })).rejects.toThrow("引用不属于");
  const result = await f.request("handoff-preview", { ...f.draft, references: [{ ...f.draft.references![0], payloadHash: "0".repeat(64) }] });
  expect(result.status).toBe(409); expect(f.calls()).toBe(0);
});
it("refuses reuse of the source creation command as a new cross-mode target", async () => {
  const f = await fixture(), source = (await f.app.sessions.list(0, 30)).sessions[0]!;
  const draft = structuredClone(f.draft);
  if (!("creation" in draft.target)) throw new Error("Expected new target fixture");
  draft.target.creation.commandId = source.binding!.creation.commandId;
  const result = await f.request("handoff-preview", draft);
  expect(result.status).toBe(400); expect(f.calls()).toBe(0); expect(await readdir(f.app.sessions.root)).toEqual([f.source.id]);
});
it("records an explicit tool-free summary and returns the same preparation without another dispatch", async () => {
  const f = await fixture(), before = await readFile(join(f.directory, "journal.jsonl"));
  const first = await f.prepare(); expect(first.status).toBe(200); const result = await first.json();
  expect(result).toMatchObject({ requiresConfirmation: true, summary: "目标是增加审查命令，验证仍待执行。" });
  expect(f.body().tools ?? []).toHaveLength(0); expect(f.body().instructions).toContain("explicitly selected data"); expect(f.body().instructions).not.toContain("You are Nekomimi, a coding assistant");
  const retry = await f.prepare(); expect(retry.status).toBe(200); expect(await retry.json()).toEqual(result); expect(f.calls()).toBe(1);
  const events = (await readSession(f.preparation())).events;
  expect(events.filter(event => event.type === "request.dispatched")).toHaveLength(1);
  expect(events.find(event => event.type === "attempt.started")?.payload).toMatchObject({ purpose: "handoff" });
  expect(events.some(event => event.type === "tool.intent" || event.type === "handoff.committed" || event.type === "context.usage")).toBe(false);
  expect(await readFile(join(f.directory, "journal.jsonl"))).toEqual(before); expect(await readdir(f.app.sessions.root)).toEqual([f.source.id]);
});
it("refuses a model tool call and never re-runs the failed preparation automatically", async () => {
  const f = await fixture(async () => response([callItem("write", { path: "FORBIDDEN", content: "bad" })]));
  const result = await f.prepare(); expect(result.status).toBe(422);
  expect((await f.prepare()).status).toBe(409); expect(f.calls()).toBe(1);
  await expect(readFile(join(f.workspace, "FORBIDDEN"))).rejects.toThrow();
  expect((await readSession(f.preparation())).events.some(event => event.type === "tool.intent" || event.type === "handoff.summary.completed")).toBe(false);
  expect(await readdir(f.app.sessions.root)).toEqual([f.source.id]);
});
it("redacts selected credentials and rejects a secret-bearing model response while preserving safe evidence", async () => {
  const f = await fixture(async () => response([textItem("Keep credentials private: " + key)]));
  f.draft.summary = "Never transfer " + key;
  const preview = await f.preview(); expect(JSON.stringify(preview)).not.toContain(key);
  const prepared = await f.prepare("summary", preview); expect(prepared.status).toBe(422);
  expect(JSON.stringify(f.body())).not.toContain(key); expect(JSON.stringify(await prepared.json())).not.toContain(key);
  const stored = await readSession(f.preparation()); expect(JSON.stringify(stored.events)).not.toContain(key);
  expect(stored.events.some(event => event.type === "handoff.summary.completed")).toBe(false);
  for (const artifact of stored.events.flatMap(event => artifactRefs(event.payload)))
    expect((await readArtifact(f.preparation(), artifact)).toString()).not.toContain(key);
});
it("rejects a late summary when source revision changes and persists no completed handoff", async () => {
  let release!: (value: Response) => void, started!: () => void;
  const ready = new Promise<void>(resolve => started = resolve), transport = new Promise<Response>(resolve => release = resolve);
  const f = await fixture(async () => { started(); return transport; });
  const pending = f.prepare(); await ready;
  const journal = await Journal.open(f.directory); await journal.append("session.title", { title: "changed", source: "user" }); await journal.close();
  release(response([textItem("late summary")])); const result = await pending;
  expect(result.status).toBe(409); expect(f.calls()).toBe(1);
  expect((await readSession(f.preparation())).events.some(event => event.type === "handoff.summary.completed")).toBe(false);
  expect(await readdir(f.app.sessions.root)).toEqual([f.source.id]);
});
it("deduplicates concurrent preparation and cancels its transport independently", async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => started = resolve);
  const f = await fixture(async (_url, init) => new Promise<Response>((_resolve, reject) => { started(); init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }); }));
  const preview = await f.preview(), pending = f.prepare("summary", preview); await ready;
  expect((await f.prepare("summary", preview)).status).toBe(409);
  const cancel = await f.request("handoff-summary-cancel", { commandId: "summary" }); expect(await cancel.json()).toEqual({ status: "cancelling" });
  expect((await pending).status).toBeGreaterThanOrEqual(400); expect(f.calls()).toBe(1);
  expect((await readSession(f.preparation())).events.some(event => event.type === "handoff.summary.cancelled")).toBe(true);
  expect(await readdir(f.app.sessions.root)).toEqual([f.source.id]);
});
