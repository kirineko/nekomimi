import { afterEach, expect, it } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { startWeb } from "../src/server/app.js";
import { run } from "../src/runtime.js";
import { hash, id, readSession } from "../src/journal.js";
import { Candidates } from "../src/customization/candidates.js";
import { key, temporary, response, textItem, callItem } from "./helpers.js";

const apps: Awaited<ReturnType<typeof startWeb>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
it.each(["http", "headless"] as const)("%s confirms creation, records validation, confirms delivery and continues work without duplicate effects", async transport => {
  const workspace = await temporary(), home = await temporary(), development = await temporary(), store = new Candidates(development);
  let phase: "work" | "develop" | "continue" = "work", requests = 0, developmentRequests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    if (phase === "develop") {
      developmentRequests++;
      if (developmentRequests === 1) return response([callItem("customization_candidate", { action: "create", name: "review" }, "candidate-create")]);
      if (developmentRequests === 2) return response([callItem("customization_candidate", { action: "inspect", id: (await store.list())[0]! }, "candidate-inspect")]);
    }
    return response([textItem(phase === "develop" ? "候选已通过静态检查，需要显式授权应用" : "继续工作")]);
  };
  let app = await startWeb({ workspace, home, apiKey: key, naming: false, runtime: { fetch: fetcher } }); apps.push(app);
  const request = (path: string, value?: unknown) => fetch(`${app.origin}/api/v1${path}`, { method: value === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const work = await app.sessions.create("工作需求", { commandId: "work", mode: "work" });
  const execute = async (sessionId: string, commandId: string, prompt: string, handoffIds?: string[]) => {
    if (transport === "http") {
      const result = await request(`/sessions/${sessionId}/submit`, { version: 1, commandId, prompt, ...(handoffIds ? { handoffIds } : {}) }); expect(result.status).toBe(202);
      const receipt = await result.json(); await app.sessions.activeFor(sessionId)?.done; return receipt;
    }
    const events = (await readSession(join(app.sessions.root, sessionId))).events;
    const identity = (events.find(event => event.type === "session.created")!.payload as any).binding;
    return run({ workspace: identity.target.root, ownerWorkspace: workspace, home, session: join(app.sessions.root, sessionId), mode: identity.mode, apiKey: key,
      prompt, handoffIds, fetch: fetcher, command: { id: commandId, runId: id(), payloadHash: hash(JSON.stringify({ prompt, ...(handoffIds ? { handoffIds } : {}) })), onAccepted: () => {} } });
  };
  const workResult = await execute(work.id, "need", "需要项目审查命令"); expect(workResult.status).not.toBe("failed"); expect(requests).toBe(1);
  const draft = { version: 1, goal: "开发审查能力", constraints: ["只在独立开发目录修改"], target: { title: "创造审查", creation: { commandId: "create-target", mode: "create", target: { kind: "extension", root: development } } } };
  const preview = await (await request(`/sessions/${work.id}/handoff-preview`, draft)).json(); expect(requests).toBe(1);
  const confirm = { version: 1, confirmed: true, commandId: "create-handoff", payloadHash: preview.payloadHash, draft };
  const confirmations = await Promise.all([request(`/sessions/${work.id}/handoff-confirm`, confirm), request(`/sessions/${work.id}/handoff-confirm`, confirm)]);
  expect(confirmations.map(result => result.status)).toEqual([200, 200]); const receipts = await Promise.all(confirmations.map(result => result.json())); expect(receipts[0]).toEqual(receipts[1]);
  const createId = receipts[0].targetSessionId; expect(requests).toBe(1); expect((await store.list())).toHaveLength(0);
  phase = "develop"; const created = await execute(createId, "develop", "创建并静态检查 review 候选");
  expect(developmentRequests).toBe(3); expect((await readSession(join(app.sessions.root, createId))).events.findLast(event => event.type === "run.finished")!.payload).toMatchObject({ status: "completed" });
  const candidates = await store.list(); expect(candidates).toHaveLength(1); expect((await readSession(join(development, ".nekomimi/lifecycle-journal"))).events.some(event => event.type === "customization.lifecycle" && (event.payload as any).stage === "static" && (event.payload as any).passed === true)).toBe(true);
  const originalJournal = await readFile(join(app.sessions.root, createId, "journal.jsonl"));
  const repeated = await execute(createId, "develop", "创建并静态检查 review 候选"); expect(repeated.runId).toBe(created.runId);
  expect(developmentRequests).toBe(3); expect(await readFile(join(app.sessions.root, createId, "journal.jsonl"))).toEqual(originalJournal);
  const resource = await store.read(candidates[0]!);
  const delivery = { version: 1, goal: "交付审查使用说明", target: { sessionId: work.id }, delivery: [{ resourceId: resource.id, revision: resource.hash, candidateId: candidates[0]!, type: "commands", usage: "候选静态检查通过；用户显式安装和授权后，可使用 /review" }] };
  const deliveryPreview = await (await request(`/sessions/${createId}/handoff-preview`, delivery)).json();
  expect(deliveryPreview.delivery[0]).toMatchObject({ phase: "awaiting-delivery", applied: false, executesCommand: false, grantsPermissions: false });
  expect(deliveryPreview.delivery[0].evidence).toEqual([expect.objectContaining({ stage: "static", origin: "development", passed: true })]);
  const deliveryCommand = { version: 1, confirmed: true, commandId: "deliver", payloadHash: deliveryPreview.payloadHash, draft: delivery };
  const received = await (await request(`/sessions/${createId}/handoff-confirm`, deliveryCommand)).json();
  expect(received.status).toBe("committed"); expect(requests).toBe(4);
  await app.close(); apps.splice(apps.indexOf(app), 1);
  app = await startWeb({ workspace, home, apiKey: key, naming: false, runtime: { fetch: fetcher } }); apps.push(app);
  expect(await (await request(`/sessions/${createId}/handoff-confirm`, deliveryCommand)).json()).toEqual(received);
  expect(requests).toBe(4); expect((await (await request(`/sessions/${work.id}/deliveries`)).json()).items[0].snapshot).toEqual(deliveryPreview.delivery);
  phase = "continue"; const continued = await execute(work.id, "continue", "确认已收到候选说明，继续原项目分析", [received.handoffId]);
  expect(requests).toBe(5); const workEvents = (await readSession(join(app.sessions.root, work.id))).events;
  expect(workEvents.filter(event => event.type === "delivery.referenced")).toEqual([expect.objectContaining({ runId: continued.runId, handoffId: received.handoffId })]);
  expect(workEvents.some(event => event.type === "tool.intent")).toBe(false);
  expect((await app.sessions.commandCatalog(work.id)).commands.some(command => command.name === "/review")).toBe(false);
  const duplicate = await execute(work.id, "continue", "确认已收到候选说明，继续原项目分析", [received.handoffId]); expect(duplicate.runId).toBe(continued.runId); expect(requests).toBe(5);
  expect((await store.list())).toHaveLength(1);
  const createdEvents = (await readSession(join(app.sessions.root, createId))).events;
  expect(createdEvents.filter(event => event.type === "tool.intent")).toHaveLength(2);
  expect(createdEvents.filter(event => event.type === "tool.completed")).toHaveLength(2);
  for (const event of createdEvents.filter(event => ["tool.intent", "tool.completed", "request.dispatched"].includes(event.type))) expect(event).toMatchObject({ mode: "create", targetId: preview.target.target.id, runId: created.runId });
}, 60000);
