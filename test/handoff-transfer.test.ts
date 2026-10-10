import { afterEach, expect, it } from "vitest";
import { readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Journal, readSession, type JournalOptions } from "../src/journal.js";
import { startWeb } from "../src/server/app.js";
import { CustomizationHost } from "../src/customization/host.js";
import { readHandoffPayload, type HandoffStage } from "../src/session/handoff-transfer.js";
import type { HandoffDraft, HandoffReceipt } from "../src/shared/protocol.js";
import { temporary, key, response, textItem } from "./helpers.js";
const services: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); });
async function fixture(fault?: (stage: HandoffStage) => Promise<void>, creationFault?: (stage: "intent" | "identity" | "created" | "committed") => Promise<void>, transport?: typeof fetch, handoffJournalOptions?: JournalOptions) {
  const workspace = await temporary(), home = await temporary(), development = await temporary(); let calls = 0, armed = false;
  const app = await startWeb({ workspace, home, naming: false, apiKey: key, handoffFault: fault, handoffJournalOptions,
    creationFault: async stage => { if (armed) await creationFault?.(stage); }, runtime: { fetch: async (...args) => { calls++; if (transport) return transport(...args); throw Error("handoff must not call model"); } } }); services.push(app);
  const source = await app.sessions.create("source", { commandId: "source-create", mode: "work" }); armed = true;
  const sourceDirectory = join(app.sessions.root, source.id);
  const draft: HandoffDraft = { version: 1, goal: "develop /review", summary: "User selected minimal input", target: { title: "target", creation: { commandId: "target-create", mode: "create", target: { kind: "extension", root: development } } } };
  const headers = { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" };
  const request = (action: string, value?: unknown, signal?: AbortSignal) => fetch(`${app.origin}/api/v1/sessions/${source.id}/${action}`, { method: value === undefined ? "GET" : "POST", headers, signal, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const previewResponse = await request("handoff-preview", draft); expect(previewResponse.status).toBe(200); const preview = await previewResponse.json();
  const confirmation = { version: 1, commandId: "confirm", confirmed: true, payloadHash: preview.payloadHash, draft };
  const recover = () => request("handoff-recover", { version: 1, commandId: "confirm" });
  const assertFacts = async (receipt: HandoffReceipt) => {
    const sourceEvents = (await readSession(sourceDirectory)).events;
    const targetEvents = (await readSession(join(app.sessions.root, receipt.targetSessionId))).events;
    expect(sourceEvents.filter(event => event.type === "handoff.intent")).toHaveLength(1);
    expect(sourceEvents.filter(event => event.type === "handoff.committed")).toHaveLength(1);
    expect(targetEvents.filter(event => event.type === "session.created")).toHaveLength(1);
    expect(targetEvents.filter(event => event.type === "handoff.received")).toHaveLength(1);
    expect(sourceEvents.filter(event => ["handoff.intent", "handoff.committed"].includes(event.type)).map(event => event.handoffId)).toEqual([receipt.handoffId, receipt.handoffId]);
    expect(targetEvents.find(event => event.type === "handoff.received")!.handoffId).toBe(receipt.handoffId);
    for (const events of [sourceEvents, targetEvents]) expect(events.some(event => ["run.started", "tool.intent", "session.naming.started", "request.dispatched"].includes(event.type))).toBe(false);
    expect(receipt).toMatchObject({ status: "committed", createsTask: false, grantsPermissions: false });
    expect(calls).toBe(0); expect(await readdir(app.sessions.root)).toHaveLength(2);
  };
  return { app, workspace, home, development, source, sourceDirectory, draft, preview, confirmation, request, recover, assertFacts, calls: () => calls };
}
it("requires confirmation and an unchanged preview before persisting an intent", async () => {
  const f = await fixture(); const before = await readFile(join(f.sourceDirectory, "journal.jsonl"));
  expect((await f.request("handoff-confirm", { ...f.confirmation, confirmed: false })).status).toBe(400);
  expect((await f.recover()).status).toBe(404);
  expect(await readFile(join(f.sourceDirectory, "journal.jsonl"))).toEqual(before);
  const journal = await Journal.open(f.sourceDirectory); await journal.append("session.title", { title: "changed" }); await journal.close();
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(409);
  expect((await readSession(f.sourceDirectory)).events.some(event => event.type === "handoff.intent")).toBe(false);
  expect(await readdir(f.app.sessions.root)).toHaveLength(1); expect(f.calls()).toBe(0);
});
it("refuses a conflicting target creation command during read-only preview before accepting source intent", async () => {
  const f = await fixture();
  await f.app.sessions.create("conflicting work", { commandId: "target-create", mode: "work" });
  expect((await f.request("handoff-preview", f.draft)).status).toBe(409);
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(409);
  expect((await readSession(f.sourceDirectory)).events.some(event => event.type === "handoff.intent")).toBe(false); expect(f.calls()).toBe(0);
});
it("deduplicates concurrent confirmations, reordered content, repeated receipts and later recovery", async () => {
  const f = await fixture();
  const results = await Promise.all([f.request("handoff-confirm", f.confirmation), f.request("handoff-confirm", f.confirmation)]);
  expect(results.map(result => result.status)).toEqual([200, 200]);
  const [first, second] = await Promise.all(results.map(result => result.json())); expect(second).toEqual(first); await f.assertFacts(first);
  const reversed = Object.fromEntries(Object.entries(f.draft).reverse());
  const repeated = await f.request("handoff-confirm", { ...f.confirmation, draft: reversed }); expect(repeated.status).toBe(200); expect(await repeated.json()).toEqual(first);
  const recovered = await f.recover(); expect(recovered.status).toBe(200); expect(await recovered.json()).toEqual(first);
  expect(await (await f.request("handoffs")).json()).toMatchObject({ items: [{ phase: "committed", status: "committed", receipt: first }] });
});
it("refuses changed content and forged recovery without affecting the accepted snapshot", async () => {
  const f = await fixture(), accepted = await f.request("handoff-confirm", f.confirmation); expect(accepted.status).toBe(200); const receipt = await accepted.json();
  expect((await f.request("handoff-confirm", { ...f.confirmation, draft: { ...f.draft, summary: "different" } })).status).toBe(409);
  expect((await f.request("handoff-recover", { version: 1, commandId: "confirm", draft: { ...f.draft, summary: "different" } })).status).toBe(400);
  expect((await f.request("handoff-recover", { version: 1, commandId: "confirm", payloadHash: "0".repeat(64) })).status).toBe(409);
  await f.assertFacts(receipt);
});
it.each(["intent", "target", "received", "committed"] as const)("reconciles metadata after an interruption at %s using the original snapshot", async stage => {
  let injected = false;
  const f = await fixture(async point => { if (!injected && point === stage) { injected = true; throw Error("stage interruption"); } });
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(500);
  const before = await readFile(join(f.sourceDirectory, "journal.jsonl"));
  const states = await (await f.request("handoffs")).json(); expect(states.items[0].phase).toBe(stage);
  expect(await readFile(join(f.sourceDirectory, "journal.jsonl"))).toEqual(before); expect(f.calls()).toBe(0);
  const journal = await Journal.open(f.sourceDirectory); await journal.append("session.title", { title: "Changed after accepting intent" }); await journal.close();
  const result = await f.recover(); expect(result.status, JSON.stringify(await result.clone().json())).toBe(200); await f.assertFacts(await result.json());
});
it.each(["intent", "identity", "created", "committed"] as const)("resumes the partial target creation at %s without another identity", async stage => {
  let injected = false;
  const f = await fixture(undefined, async point => { if (!injected && point === stage) { injected = true; throw Error("creation interruption"); } });
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(500);
  const result = await f.recover(); expect(result.status, JSON.stringify(await result.clone().json())).toBe(200); await f.assertFacts(await result.json());
});
it("does not load target factories or replace the selected target after accepting intent", async () => {
  let injected = false;
  const f = await fixture(async stage => { if (!injected && stage === "intent") { injected = true; throw Error("pause before creation"); } });
  const extension = join(f.development, ".nekomimi/extensions/trap"); await mkdir(extension, { recursive: true });
  await writeFile(join(extension, "extension.json"), JSON.stringify({ name: "trap", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["commands"] }));
  await writeFile(join(extension, "index.ts"), `import {writeFileSync} from 'node:fs';export default ()=>writeFileSync(${JSON.stringify(join(f.development, "FACTORY"))},'executed');`);
  const host = new CustomizationHost(f.development, f.app.sessions.paths.home); services.push(host);
  const resource = (await host.catalog.discover()).find(resource => resource.kind === "extension")!; await host.catalog.decide(resource.id, true, true, 0);
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(500);
  const recovered = await f.recover(); expect(recovered.status).toBe(200); await f.assertFacts(await recovered.json());
  await expect(readFile(join(f.development, "FACTORY"))).rejects.toThrow();
  const events = (await readSession(f.sourceDirectory)).events, intent = events.find(event => event.type === "handoff.intent")!;
  expect((await readHandoffPayload(f.sourceDirectory, intent)).payloadHash).toBe(f.preview.payloadHash);
});
it.each(["logical", "physical"])("never recreates a %s deleted target during pending recovery", async removal => {
  let injected = false;
  const f = await fixture(async stage => { if (!injected && stage === "target") { injected = true; throw Error("target created"); } });
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(500);
  if (removal === "logical") await f.app.sessions.remove(f.preview.target.sessionId);
  else await rm(join(f.app.sessions.root, f.preview.target.sessionId), { recursive: true });
  expect((await f.recover()).status).toBe(410);
  expect(await (await f.request("handoffs")).json()).toMatchObject({ items: [{ status: "blocked" }] });
  expect(await readdir(f.app.sessions.root)).toEqual([f.source.id]); expect(f.calls()).toBe(0);
});
it("reports an unreadable received snapshot without completing or recreating it", async () => {
  let injected = false;
  const f = await fixture(async stage => { if (!injected && stage === "received") { injected = true; throw Error("received only"); } });
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(500);
  const directory = join(f.app.sessions.root, f.preview.target.sessionId), events = (await readSession(directory)).events;
  const received = events.find(event => event.type === "handoff.received")!;
  const snapshot = (received.payload as any).snapshot;
  await rm(join(directory, "artifacts", snapshot.sha256));
  expect(await (await f.request("handoffs")).json()).toMatchObject({ items: [{ status: "blocked" }] });
  expect((await f.recover()).status).toBeGreaterThanOrEqual(400);
  expect((await readSession(f.sourceDirectory)).events.some(event => event.type === "handoff.committed")).toBe(false);
  await expect(readFile(join(directory, "artifacts", snapshot.sha256))).rejects.toThrow(); expect(f.calls()).toBe(0);
});
it.each(["intent", "target", "received", "committed"] as const)("returns the original receipt after a client timeout at %s", async stage => {
  let release!: () => void, started!: () => void;
  const barrier = new Promise<void>(resolve => release = resolve), ready = new Promise<void>(resolve => started = resolve);
  const f = await fixture(async point => { if (point === stage) { started(); await barrier; } });
  const abort = new AbortController(), pending = f.request("handoff-confirm", f.confirmation, abort.signal);
  const rejected = expect(pending).rejects.toThrow();
  try { await ready; abort.abort(new Error("client timeout")); await rejected; }
  finally { release(); }
  await f.app.sessions.exclusive(async () => {});
  const result = await f.request("handoff-confirm", f.confirmation); expect(result.status).toBe(200); await f.assertFacts(await result.json());
});
it("reads an already committed receipt while the source Durable runtime owns the writer lease", async () => {
  let release!: (response: Response) => void, started!: () => void;
  const ready = new Promise<void>(resolve => started = resolve);
  const f = await fixture(undefined, undefined, async (_url, init) => new Promise<Response>((resolve, reject) => { release = resolve; started(); init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }); }));
  const initial = await f.request("handoff-confirm", f.confirmation); expect(initial.status).toBe(200); const receipt = await initial.json();
  expect((await f.request("submit", { version: 1, commandId: "ordinary-run", prompt: "continue explicit work" })).status).toBe(202); await ready;
  try {
    const repeated = await f.request("handoff-confirm", f.confirmation); expect(repeated.status).toBe(200); expect(await repeated.json()).toEqual(receipt);
    expect((await f.recover()).status).toBe(200); expect(f.calls()).toBe(1);
  } finally { release(response([textItem()])); await f.app.sessions.active?.done; }
});
it.each([1, 2, 3].flatMap(step => ["append", "sync", "watermark.write", "watermark.rename"].map(operation => ({ step, operation }))))("recovers the metadata commit $step after a $operation failure", async ({ step, operation }) => {
  let current = 0, injected = false;
  const f = await fixture(undefined, undefined, undefined, { beforeIO: async point => {
    if (point === "append") current++;
    if (!injected && current === step && point === operation) { injected = true; throw Error("metadata I/O failure"); }
  } });
  expect((await f.request("handoff-confirm", f.confirmation)).status).toBe(500); expect(injected).toBe(true);
  let result = step === 1 ? await f.request("handoff-confirm", f.confirmation) : await f.recover();
  if (step === 1 && operation !== "append") {
    expect(result.status).toBe(409);
    expect((await readSession(f.sourceDirectory)).events.some(event => event.type === "handoff.intent")).toBe(false);
    const refreshed = await f.request("handoff-preview", f.draft); expect(refreshed.status).toBe(200);
    result = await f.request("handoff-confirm", { ...f.confirmation, payloadHash: (await refreshed.json()).payloadHash });
  }
  expect(result.status, JSON.stringify(await result.clone().json())).toBe(200); await f.assertFacts(await result.json());
});
