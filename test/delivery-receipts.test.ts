import { afterEach, expect, it } from "vitest";
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { startWeb } from "../src/server/app.js";
import { Candidates } from "../src/customization/candidates.js";
import { CustomizationHost } from "../src/customization/host.js";
import { readSession } from "../src/journal.js";
import type { HandoffDraft, DeliverySelection } from "../src/shared/protocol.js";
import type { HandoffStage } from "../src/session/handoff-transfer.js";
import { key, temporary, response, textItem } from "./helpers.js";
const resources: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const resource of resources.splice(0)) await resource.close(); });
async function fixture(template = "command", fault?: (stage: HandoffStage) => Promise<void>) {
  const workspace = await temporary(), home = await temporary(), development = await temporary(); let calls = 0;
  const app = await startWeb({ workspace, home, apiKey: key, naming: false, handoffFault: fault, runtime: { fetch: async () => { calls++; return response([textItem()]); } } }); resources.push(app);
  const work = await app.sessions.create("work", { commandId: "work", mode: "work" });
  const create = await app.sessions.create("create", { commandId: "create", mode: "create", target: { kind: "extension", root: development } });
  const host = new CustomizationHost(development, home); resources.push(host);
  const store = new Candidates(development), candidate = await store.scaffold("review", template);
  if (template === "command") await writeFile(join(candidate.path, "index.ts"), `import {appendFileSync} from 'node:fs'; import type {ExtensionFactory} from 'nekomimi/extensions';
export default ((api)=>{appendFileSync(${JSON.stringify(join(development, "FACTORY"))},'factory');api.registerCommand('review',{description:'Review',async handler(_args,ctx){appendFileSync(ctx.workspace+'/USED','used');return 'review ready'}});}) satisfies ExtensionFactory;`);
  const selected = await store.read(candidate.id);
  const selection: DeliverySelection = { resourceId: selected.id, candidateId: candidate.id, revision: selected.hash, type: template === "theme" ? "themes" : "commands", usage: template === "theme" ? "应用后在工作台查看主题" : "启用后使用 /review" };
  const draft: HandoffDraft = { version: 1, goal: "交付审查能力", target: { sessionId: work.id }, delivery: [selection] };
  const headers = { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" };
  const request = (sessionId: string, action: string, value?: unknown) => fetch(`${app.origin}/api/v1/sessions/${sessionId}/${action}`, { headers, method: value === undefined ? "GET" : "POST", ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const preview = async () => { const result = await request(create.id, "handoff-preview", draft); expect(result.status, JSON.stringify(await result.clone().json())).toBe(200); return result.json(); };
  const confirm = async (value?: any) => request(create.id, "handoff-confirm", { version: 1, confirmed: true, commandId: "deliver", payloadHash: (value ?? await preview()).payloadHash, draft });
  const install = async () => {
    const root = join(workspace, ".nekomimi/extensions/review"); await mkdir(root, { recursive: true });
    for (const file of ["extension.json", "index.ts"]) await writeFile(join(root, file), await readFile(join(candidate.path, file)));
    const resource = (await app.sessions.customization.catalog.discover()).find(resource => resource.name === "review")!;
    await app.sessions.customization.catalog.decide(resource.id, true, true, (await app.sessions.customization.catalog.decisions()).revision);
    await app.sessions.customization.initialize();
    return resource;
  };
  return { app, host, store, candidate, selected, selection, draft, work, create, workspace, home, development, request, preview, confirm, install, calls: () => calls };
}
it("records a preview-only theme as awaiting delivery and leaves all task and theme state unchanged", async () => {
  const f = await fixture("theme"); await f.host.lifecycle.record(f.selected, "preview", { passed: true });
  const source = join(f.app.sessions.root, f.create.id), before = await readFile(join(source, "journal.jsonl"));
  const preview = await f.preview(); expect(preview.delivery[0]).toMatchObject({ phase: "awaiting-delivery", applied: false, scope: "project", candidateRevision: f.selected.hash, executesCommand: false, grantsPermissions: false });
  expect(preview.delivery[0].evidence).toEqual([expect.objectContaining({ stage: "preview", passed: true, origin: "development", eventId: expect.any(String) })]);
  expect(await readFile(join(source, "journal.jsonl"))).toEqual(before); await expect(readFile(join(f.workspace, ".nekomimi/ui-theme.json"))).rejects.toThrow();
  const committed = await f.confirm(preview); expect(committed.status).toBe(200);
  const work = await (await f.request(f.work.id, "deliveries")).json(), create = await (await f.request(f.create.id, "deliveries")).json();
  expect(work.items[0].snapshot).toEqual(create.items[0].snapshot); expect(work.items[0].snapshot[0].applied).toBe(false); expect(f.calls()).toBe(0);
});
it("does not load trusted target or development factories when previewing and receiving a delivery", async () => {
  const f = await fixture();
  const checked = await f.store.inspect(f.candidate.id); expect(checked.candidate.report.passed).toBe(true);
  await f.host.lifecycle.record(checked.resource, "static", { passed: checked.candidate.report.passed });
  const result = await f.confirm(); expect(result.status).toBe(200);
  expect((await (await f.request(f.work.id, "deliveries")).json()).items[0].snapshot[0].evidence[0]).toMatchObject({ stage: "static", passed: true });
  await expect(readFile(join(f.development, "FACTORY"))).rejects.toThrow(); await expect(readFile(join(f.workspace, "USED"))).rejects.toThrow(); expect(f.calls()).toBe(0);
});
it("rejects forged stages, permissions and work-to-create delivery selectors", async () => {
  const f = await fixture();
  expect((await f.request(f.create.id, "handoff-preview", { ...f.draft, delivery: [{ ...f.selection, applied: true, stage: "host" }] })).status).toBe(400);
  expect((await f.request(f.work.id, "handoff-preview", { ...f.draft, target: { sessionId: f.create.id } })).status).toBe(403);
  expect(f.calls()).toBe(0); expect((await readSession(join(f.app.sessions.root, f.create.id))).events.some(event => event.type === "handoff.intent")).toBe(false);
});
it("refuses a stale candidate before confirmation without accepting an intent", async () => {
  const f = await fixture(), preview = await f.preview();
  await writeFile(join(f.candidate.path, "index.ts"), "export default ()=>{};");
  const result = await f.confirm(preview); expect(result.status).toBe(409);
  expect((await readSession(join(f.app.sessions.root, f.create.id))).events.some(event => event.type === "handoff.intent")).toBe(false); expect(f.calls()).toBe(0);
});
it("blocks pending delivery recovery when the confirmed candidate changes", async () => {
  let interrupted = false;
  const f = await fixture("command", async stage => { if (!interrupted && stage === "intent") { interrupted = true; throw Error("accepted only"); } });
  expect((await f.confirm()).status).toBe(500); await writeFile(join(f.candidate.path, "index.ts"), "export default ()=>{};");
  expect((await f.request(f.create.id, "handoff-recover", { version: 1, commandId: "deliver" })).status).toBe(409);
  expect(await (await f.request(f.create.id, "handoffs")).json()).toMatchObject({ items: [{ status: "blocked" }] });
  expect((await readSession(join(f.app.sessions.root, f.work.id))).events.some(event => event.type === "handoff.received")).toBe(false); expect(f.calls()).toBe(0);
});
it("keeps the historical delivery immutable when the current candidate changes or disappears", async () => {
  const f = await fixture(), result = await f.confirm(); expect(result.status).toBe(200);
  const before = (await (await f.request(f.work.id, "deliveries")).json()).items[0];
  await writeFile(join(f.candidate.path, "index.ts"), "export default ()=>{};");
  const changed = (await (await f.request(f.work.id, "deliveries")).json()).items[0];
  expect(changed.snapshot).toEqual(before.snapshot); expect(changed.current[0].versionState).toBe("changed-or-missing");
  await rm(f.candidate.path, { recursive: true });
  expect((await (await f.request(f.work.id, "deliveries")).json()).items[0].snapshot).toEqual(before.snapshot); expect(f.calls()).toBe(0);
});
it("never recreates a deleted work target while delivering", async () => {
  const f = await fixture(), preview = await f.preview(); await f.app.sessions.remove(f.work.id);
  expect((await f.confirm(preview)).status).toBe(404);
  expect(await readdir(f.app.sessions.root)).toEqual([f.create.id]); expect(f.calls()).toBe(0);
});
it("links an explicit work request to the delivered version without automatically executing its command", async () => {
  const f = await fixture(), committed = await f.confirm(); expect(committed.status).toBe(200); const receipt = await committed.json();
  const command = { version: 1, commandId: "reference", prompt: "继续处理项目", handoffIds: [receipt.handoffId] };
  const result = await f.request(f.work.id, "submit", command); expect(result.status).toBe(202); await f.app.sessions.active?.done;
  expect(f.calls()).toBe(1); await expect(readFile(join(f.workspace, "USED"))).rejects.toThrow();
  const events = (await readSession(join(f.app.sessions.root, f.work.id))).events;
  expect(events.filter(event => event.type === "delivery.referenced")).toHaveLength(1);
  expect(events.find(event => event.type === "delivery.referenced")).toMatchObject({ handoffId: receipt.handoffId, payload: { executesCommand: false, grantsPermissions: false, commandId: "reference" } });
  const repeated = await f.request(f.work.id, "submit", command); expect(repeated.status).toBe(202); expect(f.calls()).toBe(1);
  expect((await f.request(f.work.id, "submit", { ...command, handoffIds: [] })).status).toBe(409);
  const current = await (await f.request(f.create.id, "deliveries")).json(); expect(current.items[0].consumedBy).toHaveLength(1);
});
it("exposes the installed work entry and only executes review after an explicit submit", async () => {
  const f = await fixture(); await f.install();
  const preview = await f.preview(); expect(preview.delivery[0]).toMatchObject({ phase: "available", entries: ["/review"], applied: false, workActiveRevision: expect.any(String) });
  const result = await f.confirm(preview); expect(result.status).toBe(200); const receipt = await result.json();
  await expect(readFile(join(f.workspace, "USED"))).rejects.toThrow();
  expect((await f.request(f.work.id, "submit", { version: 1, commandId: "review", prompt: "/review", handoffIds: [receipt.handoffId] })).status).toBe(202);
  await f.app.sessions.active?.done; expect(await readFile(join(f.workspace, "USED"), "utf8")).toBe("used"); expect(f.calls()).toBe(0);
});
it("retains work delivery and activity after the source session is deleted", async () => {
  const f = await fixture(); await f.install(); const result = await f.confirm(); expect(result.status).toBe(200);
  const before = (await (await f.request(f.work.id, "deliveries")).json()).items[0]; await f.app.sessions.remove(f.create.id);
  const after = (await (await f.request(f.work.id, "deliveries")).json()).items[0];
  expect(after.snapshot).toEqual(before.snapshot); expect(after.sourceAvailable).toBe(false); expect(after.current[0]).toMatchObject({ versionState: "source-unavailable", work: { phase: "available" } });
  expect(await readdir(f.app.sessions.root)).toEqual([f.work.id]); expect(f.calls()).toBe(0);
});
it("keeps historical available state separate from current revocation", async () => {
  const f = await fixture(), resource = await f.install(); expect((await f.confirm()).status).toBe(200);
  const before = (await (await f.request(f.work.id, "deliveries")).json()).items[0]; expect(before.snapshot[0].phase).toBe("available");
  await f.app.sessions.customization.catalog.decide(resource.id, false, true, (await f.app.sessions.customization.catalog.decisions()).revision);
  const after = (await (await f.request(f.work.id, "deliveries")).json()).items[0];
  expect(after.snapshot).toEqual(before.snapshot); expect(after.current[0].work).toMatchObject({ phase: "authorization", entries: [], applied: false }); expect(f.calls()).toBe(0);
});
it("rejects unreceived, duplicate and cross-session work references before a request or callback", async () => {
  const f = await fixture(), other = await f.app.sessions.create("other work"); const committed = await f.confirm(); expect(committed.status).toBe(200); const receipt = await committed.json();
  const value = { version: 1, commandId: "forged", prompt: "/review", handoffIds: [receipt.handoffId] };
  expect((await f.request(other.id, "submit", value)).status).toBe(404);
  expect((await f.request(f.work.id, "submit", { ...value, handoffIds: [receipt.handoffId, receipt.handoffId] })).status).toBe(400);
  expect((await f.request(f.create.id, "submit", value)).status).toBe(403);
  expect((await f.request(f.work.id, "submit", { ...value, handoffIds: ["0".repeat(64)] })).status).toBe(404); expect(f.calls()).toBe(0);
  await expect(readFile(join(f.development, "FACTORY"))).rejects.toThrow(); await expect(readFile(join(f.workspace, "USED"))).rejects.toThrow();
});
it("preserves a user-resource delivery scope without transferring cross-project authorization", async () => {
  const f = await fixture(), root = join(f.home, "extensions/user-review"); await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "user-review", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["commands"] }));
  await writeFile(join(root, "index.ts"), "export default ()=>{};");
  const resource = (await f.host.catalog.discover()).find(resource => resource.name === "user-review")!;
  f.draft.delivery = [{ resourceId: resource.id, revision: resource.hash, usage: "需要当前项目确认后再使用", type: "commands" }];
  const preview = await f.preview(); expect(preview.delivery[0]).toMatchObject({ scope: "user", phase: "authorization", missing: ["commands"], grantsPermissions: false });
  expect((await f.confirm(preview)).status).toBe(200);
  expect((await f.app.sessions.customization.catalog.decisions()).entries[resource.id]).toBeUndefined(); expect(f.calls()).toBe(0);
});
it("restores the same historical delivery after a service restart without a model request", async () => {
  const f = await fixture(); expect((await f.confirm()).status).toBe(200);
  const before = (await (await f.request(f.work.id, "deliveries")).json()).items[0];
  await f.app.close(); resources.splice(resources.indexOf(f.app), 1);
  const app = await startWeb({ workspace: f.workspace, home: f.home, apiKey: key, naming: false, runtime: { fetch: async () => { throw Error("restart must not dispatch"); } } }); resources.push(app);
  const result = await app.sessions.deliveries(f.work.id);
  expect(result.items[0]!.snapshot).toEqual(before.snapshot); expect(result.items[0]!.handoffId).toBe(before.handoffId);
  expect(result.items[0]!.sourceAvailable).toBe(true); expect(result.items[0]!.consumedBy).toEqual([]);
});
it("does not present a create-only command as an available work entry", async () => {
  const f = await fixture();
  await writeFile(join(f.candidate.path, "index.ts"), "export default (api: import('nekomimi/extensions').ExtensionAPI)=>api.registerCommand('author',{modes:['create'],async handler(){return 'author'}});");
  const selected = await f.store.read(f.candidate.id); f.draft.delivery![0]!.revision = selected.hash; f.draft.delivery![0]!.localId = "author";
  await f.install();
  const preview = await f.preview(); expect(preview.delivery[0]).toMatchObject({ phase: "unavailable", entries: [], applied: false }); expect(f.calls()).toBe(0);
});
it("distinguishes loaded theme, explicit selection and host verification without rewriting the delivery", async () => {
  const f = await fixture("theme"), resource = await f.install();
  const preview = await f.preview(); expect(preview.delivery[0]).toMatchObject({ phase: "awaiting-application", applied: false });
  expect((await f.confirm(preview)).status).toBe(200);
  const preference = await f.app.sessions.customization.themes.preference("project");
  await f.app.sessions.customization.themes.select("project", { resourceId: resource.id, revision: resource.hash, id: "review" }, preference.revision);
  const current = (await (await f.request(f.work.id, "deliveries")).json()).items[0];
  expect(current.snapshot[0]).toMatchObject({ phase: "awaiting-application", applied: false });
  expect(current.current[0].work).toMatchObject({ phase: "applied", applied: true });
  expect(current.snapshot[0].evidence.some((item: any) => item.stage === "host" && item.passed === true)).toBe(false); expect(f.calls()).toBe(0);
});

it('uses the owning project for creation provenance and shares environment-bound delivery facts across both modes', async () => {
  const f = await fixture();
  const { sessionBinding } = await import('../src/session/identity.js');
  const { Journal } = await import('../src/journal.js');
  const binding = sessionBinding((await readSession(join(f.app.sessions.root, f.create.id))).events)!;
  await f.host.lifecycle.record(f.selected, 'created', { sourceBinding: binding, sessionId: f.create.id, runId: 'creation-run' });
  const verified = await f.host.lifecycle.record(f.selected, 'static', { passed: true });
  const history = join(f.development, '.nekomimi/lifecycle-journal');
  const writer = await Journal.open(history);
  await writer.append('customization.lifecycle', { ...verified, environment: { ...verified.environment, node: 'v0.0.0' } }); await writer.close();
  const before = await readFile(join(history, 'journal.jsonl'));
  const ability = (await f.host.lifecycle.catalog()).find(item => item.candidateId === f.candidate.id)!;
  expect(ability).toMatchObject({ changeOrigin: 'controlled', changeKind: 'created', sourceAvailable: true, origin: { sessionId: f.create.id, ownerWorkspace: binding.ownerWorkspace, target: binding.target, scope: 'project' } });
  expect(ability.relatedSessions).toContain(f.create.id);
  expect(ability.previousEvidence).toEqual([expect.objectContaining({ environment: expect.objectContaining({ node: 'v0.0.0' }) })]);
  const preview = await f.preview();
  expect(preview.delivery[0].creation).toMatchObject({ sessionId: f.create.id, ownerWorkspace: binding.ownerWorkspace, target: binding.target });
  expect(preview.delivery[0].evidence).toEqual([expect.objectContaining({ stage: 'static', status: 'passed', environment: expect.objectContaining({ node: process.version }), verification: expect.objectContaining({ hostIntegration: 'not_run' }) })]);
  expect((await f.confirm(preview)).status).toBe(200);
  const work = (await (await f.request(f.work.id, 'deliveries')).json()).items[0];
  const create = (await (await f.request(f.create.id, 'deliveries')).json()).items[0];
  expect(work.snapshot).toEqual(create.snapshot);
  expect(work.snapshot[0].evidence[0].hash).toBe(create.snapshot[0].evidence[0].hash);
  expect(await readFile(join(history, 'journal.jsonl'))).toEqual(before);
  await expect(readFile(join(f.development, 'FACTORY'))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(f.candidate.path, 'index.ts'), 'export default ()=>{};');
  const observed = (await f.host.lifecycle.catalog()).find(item => item.candidateId === f.candidate.id)!;
  expect(observed).toMatchObject({ changeOrigin: 'observed', changeKind: 'observed-update', origin: { sessionId: f.create.id } });
  await f.app.sessions.remove(f.create.id);
  expect((await f.host.lifecycle.catalog()).find(item => item.candidateId === f.candidate.id)?.sourceAvailable).toBe(false);
  expect((await (await f.request(f.work.id, 'deliveries')).json()).items[0].snapshot).toEqual(work.snapshot);
  expect(f.calls()).toBe(0);
});
