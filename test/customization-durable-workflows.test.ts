import { expect, it } from "vitest";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { CustomizationHost } from "../src/customization/host.js";
import { Workflows } from "../src/customization/workflows.js";
import { WorkspaceState } from "../src/customization/workspace-state.js";
import { Journal, id, readSession } from "../src/journal.js";
import { temporary, key } from "./helpers.js";
const definition = `import type {ExtensionFactory2} from 'nekomimi/extensions'; export default ((api)=>{api.registerWorkflow({id:'review',schemaVersion:1,inputSchema:{type:'object'},entry:'prepare',steps:{prepare:{transitions:['finish'],async execute(input,ctx){const old=await ctx.workspaceState.get('count',1);await ctx.workspaceState.set('count',1,old?.revision??0,Number(old?.value??0)+1);await ctx.callTool('write',{path:'effect.txt',content:'first effect'});return {kind:'wait',step:'finish',input,form:{kind:'form',title:'Review approval',fields:[{name:'decision',label:'Decision',required:true,options:['approve','reject']}]}};}},finish:{transitions:[],async execute(input,ctx){await ctx.callTool('write',{path:'finished.txt',content:'original revision'});return {kind:'complete',output:input};}}}});}) satisfies ExtensionFactory2;`;
async function fixture() {
  const workspace = await realpath(await temporary()), home = await temporary(), root = join(workspace, ".nekomimi/extensions/durable");
  await mkdir(root, { recursive: true }); await writeFile(join(root, "extension.json"), JSON.stringify({ name: "durable", sdkVersion: 2, entry: "index.ts", requiredCapabilities: ["workflows", "workspace-state", "tools"] })); await writeFile(join(root, "index.ts"), definition);
  const host = new CustomizationHost(workspace, home), resource = (await host.catalog.discover()).find(r => r.kind === "extension")!;
  await host.catalog.decide(resource.id, true, true, 0);
  return { workspace, home, root, host, resource };
}
it("persists waiting identity, resumes the original revision after restart/update, and deduplicates answers", async () => {
  const f = await fixture(); let host = f.host;
  try {
    const flows = new Workflows(host, { apiKey: key }); const activation = await host.acquire();
    const created = await flows.create(f.resource.id, "review", {}, activation); await host.release();
    const waiting = await flows.advance(created.id); expect(waiting.status).toBe("waiting"); expect(waiting.wait?.form.title).toBe("Review approval");
    expect(await readFile(join(f.workspace, "effect.txt"), "utf8")).toBe("first effect");
    await host.close(); await writeFile(join(f.root, "index.ts"), definition.replace("original revision", "new revision"));
    host = new CustomizationHost(f.workspace, f.home); const restarted = new Workflows(host, { apiKey: key });
    expect((await restarted.inspect(created.id)).wait?.id).toBe(waiting.wait?.id);
    const command = id(), ready = await restarted.answer(created.id, waiting.wait!.id, command, { decision: "approve" }, waiting.revision);
    expect((await restarted.answer(created.id, waiting.wait!.id, command, { decision: "approve" }, waiting.revision)).status).toBe("ready");
    await expect(restarted.answer(created.id, waiting.wait!.id, command, { decision: "reject" }, waiting.revision)).rejects.toThrow("identity conflict");
    const completed = await restarted.advance(ready.id); expect(completed.status).toBe("completed"); expect(completed.output).toEqual({ input: {}, answer: { decision: "approve" } });
    expect(await readFile(join(f.workspace, "finished.txt"), "utf8")).toBe("original revision");
    expect(await new WorkspaceState(f.workspace).get(f.resource.id, "count", 1)).toEqual({ revision: 1, value: 1 });
    await expect(restarted.answer(created.id, waiting.wait!.id, id(), { decision: "approve" }, completed.revision)).rejects.toThrow("not waiting");
    const events = (await readSession(join(f.workspace, ".nekomimi/workflows", created.id))).events;
    expect(events.filter(e => e.type === "workflow.step.started")).toHaveLength(2);
    expect(events.filter(e => e.type === "tool.intent")).toHaveLength(2);
    expect(events.some(e => e.workflowId === created.id && e.stepId === "prepare" && e.type === "extension.rpc.intent")).toBe(true);
  } finally { await host.close(); }
});
it("marks an effect without a completed step unknown and requires explicit reconciliation instead of rerun", async () => {
  const f = await fixture();
  try {
    const crash = new Workflows(f.host, { apiKey: key }, stage => { if (stage === "effect-completed") throw new Error("simulated crash after effect"); });
    const activation = await f.host.acquire(), created = await crash.create(f.resource.id, "review", {}, activation); await f.host.release();
    const unknown = await crash.advance(created.id); expect(unknown.status).toBe("unknown");
    const recovered = new Workflows(f.host, { apiKey: key }); await expect(recovered.advance(created.id)).rejects.toThrow("unknown");
    expect(await new WorkspaceState(f.workspace).get(f.resource.id, "count", 1)).toEqual({ revision: 1, value: 1 });
    const ready = await recovered.resolveUnknown(created.id, (await recovered.inspect(created.id)).revision, { outcome: { kind: "next", step: "finish", input: { verified: true } }, note: "Verified effect.txt and workspace counter externally" });
    expect((await recovered.advance(ready.id)).status).toBe("completed");
    expect(await new WorkspaceState(f.workspace).get(f.resource.id, "count", 1)).toEqual({ revision: 1, value: 1 });
  } finally { await f.host.close(); }
});
it("does not rerun a completed step after a checkpoint crash and blocks revoked pinned definitions", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "index.ts"), definition.replace("kind:'wait',step:'finish',input,form:{kind:'form',title:'Review approval',fields:[{name:'decision',label:'Decision',required:true,options:['approve','reject']}]}", "kind:'next',step:'finish',input"));
    const crash = new Workflows(f.host, { apiKey: key }, stage => { if (stage === "completion-written") throw new Error("checkpoint crash"); });
    const activation = await f.host.acquire(), created = await crash.create(f.resource.id, "review", {}, activation); await f.host.release();
    await expect(crash.advance(created.id)).rejects.toThrow("checkpoint crash");
    const recovered = new Workflows(f.host, { apiKey: key }); expect((await recovered.inspect(created.id)).status).toBe("ready");
    await f.host.catalog.decide(f.resource.id, false, false, (await f.host.catalog.decisions()).revision);
    await expect(recovered.advance(created.id)).rejects.toThrow("authorization revoked");
    const state = await recovered.inspect(created.id); await recovered.cancel(created.id, state.revision);
    expect((await recovered.inspect(created.id)).status).toBe("cancelled");
    expect(await new WorkspaceState(f.workspace).get(f.resource.id, "count", 1)).toEqual({ revision: 1, value: 1 });
  } finally { await f.host.close(); }
});
it.each(["outbox-written", "state-written", "outbox-delivered"])("recovers state delivery at %s without applying CAS twice", async phase => {
  const workspace = await realpath(await temporary()), source = await Journal.open(join(workspace, "origin")), states = new WorkspaceState(workspace);
  try {
    await expect(states.set(source, { resourceId: "fixture", key: "value", schemaVersion: 1, expectedRevision: 0, value: 42 }, stage => { if (stage === phase) throw new Error("crash"); })).rejects.toThrow("crash");
    await states.recover(source); await states.recover(source);
    expect(await states.get("fixture", "value", 1)).toEqual({ revision: 1, value: 42 });
    await expect(states.set(source, { resourceId: "fixture", key: "value", schemaVersion: 1, expectedRevision: 0, value: 50 })).rejects.toThrow("CAS conflict");
    await states.migrate(source, { resourceId: "fixture", key: "value", schemaVersion: 2, fromSchemaVersion: 1, expectedRevision: 1, value: { count: 42 } });
    await expect(states.get("fixture", "value", 1)).rejects.toThrow("schema incompatible");
    expect((await states.get("fixture", "value", 2))?.revision).toBe(2);
  } finally { await source.close(); }
});
// This scenario starts/replaces pinned extension processes across retry and migration.
// Its aggregate budget must cover multiple startup and cleanup cycles on hosted runners.
it("requires an explicit retry attempt, validates transitions and preserves the old state when migration fails", async () => {
  const f = await fixture();
  try {
    const activation = await f.host.acquire(), manager = new Workflows(f.host, { apiKey: key }, phase => { if (phase === "intent-written") throw new Error("before callback crash"); });
    await expect(manager.create(f.resource.id, "review", "invalid", activation)).rejects.toThrow("input schema");
    const created = await manager.create(f.resource.id, "review", {}, activation); await f.host.release();
    const unknown = await manager.advance(created.id); expect(unknown.status).toBe("unknown");
    await expect(manager.resolveUnknown(created.id, unknown.revision, { outcome: { kind: "next", step: "not-declared", input: {} }, note: "checked" })).rejects.toThrow("transition");
    const retry = await manager.resolveUnknown(created.id, unknown.revision, { retry: true, note: "Verified no callback was dispatched" });
    const normal = new Workflows(f.host, { apiKey: key }); const waiting = await normal.advance(retry.id); expect(waiting.status).toBe("waiting");
    const events = (await readSession(join(f.workspace, ".nekomimi/workflows", created.id))).events;
    const attempts = events.filter(e => e.type === "workflow.step.started").map(e => e.attemptId); expect(new Set(attempts).size).toBe(2);
    await writeFile(join(f.root, "index.ts"), definition.replace("schemaVersion:1", "schemaVersion:2").replace("original revision", "migrated revision"));
    const receipt = f.host.requestReload(); await f.host.reload(receipt);
    const next = await f.host.acquire();
    try {
      await expect(normal.migrate(created.id, waiting.revision, { resourceId: f.resource.id, definitionId: "review", fromSchemaVersion: 1, step: "invalid", input: {}, note: "upgrade" }, next)).rejects.toThrow("target/schema");
      expect((await normal.inspect(created.id)).definitionRevision).toBe(waiting.definitionRevision);
      const migrated = await normal.migrate(created.id, waiting.revision, { resourceId: f.resource.id, definitionId: "review", fromSchemaVersion: 1, step: "finish", input: { migrated: true }, note: "upgrade" }, next);
      expect(migrated.schemaVersion).toBe(2); expect(migrated.status).toBe("ready");
    } finally { await f.host.release(); }
    expect((await normal.advance(created.id)).status).toBe("completed"); expect(await readFile(join(f.workspace, "finished.txt"), "utf8")).toBe("migrated revision");
  } finally { await f.host.close(); }
}, 60_000);

const triggered = `import type {ExtensionFactory2} from 'nekomimi/extensions'; export default ((api)=>{api.registerWorkflow({id:'observer',schemaVersion:1,inputSchema:{type:'object'},triggers:[{kind:'tool-completed',name:'read'},{kind:'run-completed'}],entry:'finish',steps:{finish:{transitions:[],async execute(input,ctx){await ctx.callTool('write',{path:'triggered.txt',content:'ran'});return {kind:'complete',output:input};}}}});}) satisfies ExtensionFactory2;`;
it('bounds pending workflows and refuses a trigger beyond the causal depth without running its effects',async()=>{
 const f=await fixture(),source=await Journal.open(join(f.workspace,'depth-source'));
 try{
  await writeFile(join(f.root,'index.ts'),triggered);const activation=await f.host.acquire();
  await source.append('workflow.created',{causes:Array.from({length:8},(_,i)=>`previous-${i}`)});await source.append('tool.completed',{name:'read'});
  await f.host.workflows.observe(source,activation,'tool-completed','read',{apiKey:key});expect(await f.host.workflows.list()).toHaveLength(0);expect(source.events.at(-1)?.type).toBe('workflow.trigger.blocked');
  for(let n=0;n<64;n++)await f.host.workflows.create(f.resource.id,'observer',{},activation);
  await expect(f.host.workflows.create(f.resource.id,'observer',{},activation)).rejects.toThrow('queue limit');
  await f.host.release();await expect(readFile(join(f.workspace,'triggered.txt'))).rejects.toThrow();
 }finally{await source.close();await f.host.close();}
},30000);
it("deduplicates confirmed triggers, serializes execution and blocks causal cycles", async () => {
  const f = await fixture(); const source = await Journal.open(join(f.workspace, 'source'));
  try {
    await writeFile(join(f.root, 'index.ts'), triggered);
    const activation = await f.host.acquire();
    await source.append('tool.completed', {name:'read'});
    await f.host.workflows.observe(source, activation, 'tool-completed', 'read', {apiKey:key});
    await f.host.workflows.observe(source, activation, 'tool-completed', 'read', {apiKey:key});
    expect(await f.host.workflows.list()).toHaveLength(1);
    expect((await f.host.workflows.list())[0]!.status).toBe('queued');
    await f.host.release();
    const state = (await f.host.workflows.list())[0]!; expect(state.status).toBe('completed');
    expect(await readFile(join(f.workspace, 'triggered.txt'), 'utf8')).toBe('ran');
    const events = (await readSession(join(f.workspace, '.nekomimi/workflows', state.id))).events;
    expect(events.some(e=>e.type==='workflow.trigger.blocked')).toBe(true);
    expect(source.events.filter(e=>e.type==='workflow.trigger.delivered')).toHaveLength(1);
  } finally {await source.close(); await f.host.close();}
});
it.each(['trigger-enqueued','trigger-created','trigger-delivered'])("recovers trigger outbox at %s without executing queued work", async phase => {
  const f = await fixture(); const source = await Journal.open(join(f.workspace, 'source'));
  try {
    await writeFile(join(f.root, 'index.ts'), triggered);
    const activation = await f.host.acquire(), crash = new Workflows(f.host, {apiKey:key}, stage=>{if(stage===phase) throw new Error('crash');});
    await source.append('run.finished', {status:'completed'});
    await expect(crash.observe(source, activation, 'run-completed', undefined, {apiKey:key})).rejects.toThrow('crash');
    await f.host.release(); await f.host.close();
    const restarted = new CustomizationHost(f.workspace, f.home);
    try {
      await restarted.workflows.recover(source); await restarted.workflows.recover(source);
      const states = await restarted.workflows.list(); expect(states).toHaveLength(1); expect(states[0]!.status).toBe('queued');
      await expect(readFile(join(f.workspace, 'triggered.txt'))).rejects.toThrow();
      expect(source.events.filter(e=>e.type==='workflow.trigger.delivered')).toHaveLength(1);
    } finally {await restarted.close();}
  } finally {await source.close(); await f.host.close();}
});
it('serializes concurrent workspace CAS writers from independent origin journals',async()=>{
 const workspace=await temporary(),one=await Journal.open(join(workspace,'one')),two=await Journal.open(join(workspace,'two')),state=new WorkspaceState(workspace);
 try{
  const outcomes=await Promise.allSettled([state.set(one,{resourceId:'same',key:'counter',schemaVersion:1,expectedRevision:0,value:1}),state.set(two,{resourceId:'same',key:'counter',schemaVersion:1,expectedRevision:0,value:2})]);
  expect(outcomes.filter(v=>v.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(v=>v.status==='rejected')).toHaveLength(1);
  await state.recover(one);await state.recover(two);expect((await state.get('same','counter',1))?.revision).toBe(1);
 }finally{await one.close();await two.close();}
});
it('starts a command-triggered workflow with an independent journal and only a reference in the originating conversation',async()=>{
 const f=await fixture();
 try{
  await writeFile(join(f.root,'index.ts'),definition.replace("id:'review',schemaVersion", "id:'review',triggers:[{kind:'command',name:'durable-review'}],schemaVersion"));
  const {run}=await import('../src/runtime.js');
  const result=await run({workspace:f.workspace,home:f.home,customization:f.host,session:join(f.workspace,'command'),apiKey:key,prompt:'/durable-review {}'});
  expect(result.status).toBe('completed');const events=(await readSession(result.session)).events;
  expect(events.filter(e=>e.type==='workflow.reference')).toHaveLength(1);expect(events.some(e=>e.type==='workflow.step.completed')).toBe(false);
  const [flow]=await f.host.workflows.list();expect(flow?.status).toBe('waiting');expect(f.host.busy).toBe(false);
 }finally{await f.host.close();}
});
