import { afterEach, expect, it } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readFile, rename, rm } from "node:fs/promises";
import { startWeb } from "../src/server/app.js";
import { readSession } from "../src/journal.js";
import { key, temporary, response, textItem } from "./helpers.js";

const apps: Awaited<ReturnType<typeof startWeb>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
type Pending = { body: any; signal: AbortSignal; release(text?: string): void };
async function fixture(naming = false, holdMain = true) {
  const workspace = await temporary(), development = await temporary(), home = await temporary(), pending: Pending[] = [], waiting: { count: number; resolve(): void }[] = [];
  const app = await startWeb({ workspace, home, naming, apiKey: key, runtime: { fetch: async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    if (!holdMain && body.max_output_tokens !== 64) return response([textItem("main done")]);
    return new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!; signal.throwIfAborted();
      const abort = () => reject(new Error("fixture aborted"));
      signal.addEventListener("abort", abort, { once: true });
      pending.push({ body, signal, release: (text = "done") => { signal.removeEventListener("abort", abort); resolve(response([textItem(text)])); } });
      for (const item of waiting) if (pending.length >= item.count) item.resolve();
    });
  } } }); apps.push(app);
  const work = await app.sessions.create("work", { commandId: "work", mode: "work" });
  const create = await app.sessions.create("create", { commandId: "create", mode: "create", target: { kind: "extension", root: development } });
  const headers = { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" };
  const request = (path: string, value?: unknown) => fetch(`${app.origin}/api/v1${path}`, { headers, method: value === undefined ? "GET" : "POST", ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const submit = async (id: string, commandId: string) => { const result = await request(`/sessions/${id}/submit`, { version: 1, commandId, prompt: commandId }); expect(result.status).toBe(202); return result.json(); };
  const snapshot = async (id: string) => (await request(`/sessions/${id}/snapshot`)).json();
  // Coordinate with the actual transport; keep Vitest's existing 15s test bound.
  const waitForRequests = (count: number) => pending.length >= count ? Promise.resolve() : new Promise<void>(resolve => waiting.push({ count, resolve }));
  return { app, workspace, development, home, work, create, pending, request, submit, snapshot, waitForRequests };
}
it("runs work and create independently, scopes cancel IDs and reports both active runs", async () => {
  const f = await fixture();
  const [work, create] = await Promise.all([f.submit(f.work.id, "work-task"), f.submit(f.create.id, "create-task")]);
  await f.waitForRequests(2); expect(f.pending).toHaveLength(2);
  const sessions = (await (await f.request("/sessions")).json()).sessions;
  expect(sessions.map((item: any) => item.status)).toEqual(["running", "running"]);
  expect((await f.snapshot(f.work.id)).session.runId).toBe(work.runId);
  expect((await f.snapshot(f.create.id)).session.runId).toBe(create.runId);
  expect((await f.request(`/sessions/${f.create.id}/export`, { version: 1, format: "json", redact: [] })).status).toBe(409);
  expect((await (await f.request(`/sessions/${f.work.id}/cancel`, { version: 1, runId: create.runId })).json()).status).toBe("not_running");
  expect(f.pending.every(item => !item.signal.aborted)).toBe(true);
  expect((await f.request(`/sessions/${f.create.id}/delete`, {})).status).toBe(409);
  const runningWork = f.app.sessions.activeFor(f.work.id)!;
  await f.request(`/sessions/${f.work.id}/cancel`, { version: 1, runId: work.runId }); await runningWork.done;
  expect((await f.snapshot(f.work.id)).session.status).toBe("cancelled");
  expect((await f.snapshot(f.create.id)).session.status).toBe("running");
  expect(f.pending.filter(item => item.signal.aborted)).toHaveLength(1);
  const runningCreate = f.app.sessions.activeFor(f.create.id)!;
  f.pending.find(item => !item.signal.aborted)!.release(); await runningCreate.done;
  expect((await f.snapshot(f.create.id)).session.status).toBe("completed");
  expect((await readSession(join(f.app.sessions.root, f.create.id))).events.filter(event => event.type === "request.dispatched")).toHaveLength(1);
});
it("keeps one mutable target serialized even across create sessions", async () => {
  const f = await fixture(), other = await f.app.sessions.create("other", { commandId: "other", mode: "create", target: { kind: "extension", root: f.development } });
  await f.submit(f.create.id, "one");
  expect((await f.request(`/sessions/${other.id}/submit`, { version: 1, commandId: "two", prompt: "two" })).status).toBe(409);
  expect((await readSession(join(f.app.sessions.root, other.id))).events.some(event => event.type === "command.accepted")).toBe(false);
});
it("service shutdown cancels and drains every independent target", async () => {
  const f = await fixture(); await f.submit(f.work.id, "work"); await f.submit(f.create.id, "create");
  await f.waitForRequests(2); expect(f.pending).toHaveLength(2); await f.app.close(); apps.splice(apps.indexOf(f.app), 1);
  expect(f.pending.every(item => item.signal.aborted)).toBe(true);
  for (const id of [f.work.id, f.create.id]) expect((await readSession(join(f.app.sessions.root, id))).events.findLast(event => event.type === "run.finished")?.payload).toMatchObject({ status: "cancelled" });
});
it("keeps another target's naming alive and ignores repeated commands and stale cancel IDs", async () => {
  const f = await fixture(true, false), receipt = await f.submit(f.work.id, "name-work");
  await f.waitForRequests(1); expect(f.app.sessions.namingFor(f.work.id)).toBeTruthy();
  const naming = f.app.sessions.namingFor(f.work.id)!;
  expect((await f.snapshot(f.work.id)).session.namingRunId).toBe(naming.runId);
  expect((await f.submit(f.work.id, "name-work")).runId).toBe(receipt.runId);
  await f.request(`/sessions/${f.work.id}/cancel`, { version: 1, runId: receipt.runId });
  expect(naming.abort.signal.aborted).toBe(false);
  await f.submit(f.create.id, "name-create"); await f.waitForRequests(2); expect(f.pending).toHaveLength(2);
  expect(naming.abort.signal.aborted).toBe(false);
  expect(f.pending.every(item => item.body.tools?.length === 0 || item.body.tools === undefined)).toBe(true);
  const workTitle = f.pending.find(item => JSON.stringify(item.body).includes("name-work"))!, createTitle = f.pending.find(item => JSON.stringify(item.body).includes("name-create"))!;
  expect(JSON.stringify(workTitle.body)).not.toContain("name-create");
  workTitle.release("工作标题"); createTitle.release("创造标题");
  await naming.done; await f.app.sessions.namingFor(f.create.id)?.done;
  expect((await f.snapshot(f.work.id)).session.title).toBe("工作标题");
  expect((await f.snapshot(f.create.id)).session.title).toBe("创造标题");
  for (const id of [f.work.id, f.create.id]) {
    const events = (await readSession(join(f.app.sessions.root, id))).events;
    expect(events.filter(event => event.type === "session.naming.started")).toHaveLength(1);
    expect(events.filter(event => event.type === "context.usage")).toHaveLength(1);
    expect(events.some(event => event.type === "tool.intent")).toBe(false);
  }
});
it("a new task preempts only naming on its own target, without rerunning old naming", async () => {
  const f = await fixture(true, false); await f.submit(f.work.id, "first"); await f.submit(f.create.id, "other");
  await f.waitForRequests(2); expect(f.pending).toHaveLength(2);
  const own = f.app.sessions.namingFor(f.work.id)!, other = f.app.sessions.namingFor(f.create.id)!;
  await f.submit(f.work.id, "second");
  expect(own.abort.signal.aborted).toBe(true); expect(other.abort.signal.aborted).toBe(false);
  await f.app.sessions.activeFor(f.work.id)?.done;
  await f.app.sessions.namingFor(f.work.id)?.done;
  expect(f.app.sessions.namingFor(f.work.id)).toBeUndefined();
  expect(f.pending).toHaveLength(2);
  const originalTitle = (await f.snapshot(f.create.id)).session.title;
  await f.request(`/sessions/${f.create.id}/cancel`, { version: 1, runId: other.runId }); await other.done;
  expect((await f.snapshot(f.create.id)).session.title).toBe(originalTitle);
  const events = (await readSession(join(f.app.sessions.root, f.work.id))).events;
  expect(events.filter(event => event.type === "session.naming.started")).toHaveLength(1);
  expect(events.filter(event => event.type === "run.finished")).toHaveLength(2);
});
it("retains confirmed snapshots and independent development files when their source session is deleted", async () => {
  const f = await fixture(); const sentinel = join(f.development, "SOURCE"); await writeFile(sentinel, "keep source");
  const draft = { version: 1, goal: "build capability", target: { sessionId: f.create.id } };
  const preview = await (await f.request(`/sessions/${f.work.id}/handoff-preview`, draft)).json();
  expect((await f.request(`/sessions/${f.work.id}/handoff-confirm`, { version: 1, confirmed: true, commandId: "handoff", payloadHash: preview.payloadHash, draft })).status).toBe(200);
  const before = await readFile(join(f.app.sessions.root, f.create.id, "journal.jsonl"));
  const impact = await (await f.request(`/sessions/${f.work.id}/deletion-preview`)).json();
  expect(impact).toMatchObject({ busy: false, relations: [{ direction: "outgoing", snapshotRetainedInOtherSession: true }], selectedSessionEvidenceAfterDelete: "unavailable" });
  await f.request(`/sessions/${f.work.id}/delete`, {});
  expect((await (await f.request(`/sessions/${f.create.id}/handoff-relations`)).json()).items[0]).toMatchObject({ direction: "incoming", sourceAvailable: false, targetAvailable: true, sourceEvidence: "unavailable", snapshot: preview });
  expect(await readFile(join(f.app.sessions.root, f.create.id, "journal.jsonl"))).toEqual(before);
  expect(await readFile(sentinel, "utf8")).toBe("keep source"); expect(f.pending).toHaveLength(0);
  expect((await f.request(`/sessions/${f.work.id}/delete`, {})).status).toBe(200);
  await f.app.close(); apps.splice(apps.indexOf(f.app), 1);
  const reopened = await startWeb({ workspace: f.workspace, home: f.home, apiKey: key, naming: false }); apps.push(reopened);
  expect((await reopened.sessions.handoffRelations(f.create.id)).items[0]).toMatchObject({ sourceAvailable: false, targetAvailable: true });
  await expect(reopened.sessions.entry(f.work.id)).rejects.toThrow("已删除"); expect(await readFile(sentinel, "utf8")).toBe("keep source");
});
it("never recreates a missing target while observing relationships", async () => {
  const f = await fixture(); const draft = { version: 1, goal: "build", target: { sessionId: f.create.id } };
  const preview = await (await f.request(`/sessions/${f.work.id}/handoff-preview`, draft)).json();
  await f.request(`/sessions/${f.work.id}/handoff-confirm`, { version: 1, confirmed: true, commandId: "handoff", payloadHash: preview.payloadHash, draft });
  await rename(f.development, f.development + "-moved");
  expect((await f.app.sessions.handoffRelations(f.work.id)).items[0]).toMatchObject({ targetAvailable: false, sourceAvailable: true });
  await expect(readFile(join(f.development, "SOURCE"))).rejects.toThrow(); expect(f.pending).toHaveLength(0);
  await mkdir(f.development); // A replacement directory remains unavailable.
  expect((await f.app.sessions.handoffRelations(f.work.id)).items[0]?.targetAvailable).toBe(false);
  await rm(f.development, { recursive: true }); await rename(f.development + "-moved", f.development);
});
it('keeps core switching blocked until both independent work and create runs have settled', async () => {
  const f=await fixture();
  const [work,create]=await Promise.all([f.submit(f.work.id,'switch-work'),f.submit(f.create.id,'switch-create')]);await f.waitForRequests(2);
  const first=await f.app.prepareCoreSwitch('switch-both');
  expect(first.ready).toBe(false);expect(first.blockers.filter(b=>b.kind==='run').map(b=>b.id).sort()).toEqual([work.runId,create.runId].sort());
  const workTask=f.app.sessions.activeFor(f.work.id)!;await f.request(`/sessions/${f.work.id}/cancel`,{version:1,runId:work.runId});await workTask.done;
  const second=await f.app.prepareCoreSwitch('switch-both');expect(second.ready).toBe(false);expect(second.blockers.filter(b=>b.kind==='run').map(b=>b.id)).toEqual([create.runId]);
  const createTask=f.app.sessions.activeFor(f.create.id)!;f.pending.find(item=>!item.signal.aborted)!.release();await createTask.done;
  expect(await f.app.prepareCoreSwitch('switch-both')).toMatchObject({ready:true});await f.app.releaseCoreSwitch('switch-both');
});
it('counts background naming after the main task finishes as a core-switch blocker', async () => {
  const f=await fixture(true,false);await f.submit(f.work.id,'switch-naming');await f.waitForRequests(1);
  const naming=f.app.sessions.namingFor(f.work.id)!;expect(naming).toBeDefined();
  const readiness=await f.app.prepareCoreSwitch('switch-naming');expect(readiness.ready).toBe(false);expect(readiness.blockers.some(b=>b.kind==='naming'&&b.sessionId===f.work.id)).toBe(true);
  f.pending[0]!.release('Named');await naming.done;
  expect(await f.app.prepareCoreSwitch('switch-naming')).toMatchObject({ready:true});await f.app.releaseCoreSwitch('switch-naming');
});
