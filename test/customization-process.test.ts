import { expect, it } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { LIMITS } from "../src/customization/resources.js";
import { CustomizationHost } from "../src/customization/host.js";
import { run } from "../src/runtime.js";
import { readSession } from "../src/journal.js";
import { temporary, key, response, callItem, textItem } from "./helpers.js";
async function setup(source: string, extraCapabilities: string[] = []) {
  const workspace = await temporary(), home = await temporary();
  const root = join(workspace, ".nekomimi/extensions/process");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "process", sdkVersion: 3, requiredCapabilities: ['commands', 'state', 'tools', ...extraCapabilities], entry: "index.ts" }));
  await writeFile(join(root, "index.ts"), source);
  const host = new CustomizationHost(workspace, home);
  const resource = (await host.catalog.discover()).find(r => r.kind === "extension")!;
  await host.catalog.decide(resource.id, true, true, 0);
  return { workspace, home, host, resource, root };
}
it('cancels an unawaited script child in the actual extension process and preserves its unknown effect',async()=>{
 const f=await setup(`import {appendFileSync} from 'node:fs'; let started=false; export default (api: import('nekomimi/extensions').ExtensionAPI)=>{
 api.registerTool({name:'slow',description:'slow',parameters:{type:'object',properties:{}},async execute(){appendFileSync('script-effect','once\\n');started=true;await new Promise(()=>{});return {content:[]}}});
 api.registerTool({name:'ready',description:'ready',parameters:{type:'object',properties:{}},async execute(){while(!started)await new Promise(r=>setTimeout(r,5));return {content:[{type:'text',text:'ready'}]}}});}`);
 const session=join(f.workspace,'session');let requests=0;
 try{
  const result=await run({...f,customization:f.host,session,apiKey:key,prompt:'script',tools:['codemode','ext_process_slow','ext_process_ready'],fetch:async()=>response(++requests===1?[callItem('codemode',{code:'void tools.ext_process_slow({}); await tools.ext_process_ready({}); return "done";'})]:[textItem('Child outcome remains unknown.')])});
  expect(result.status,result.error).toBe('completed');expect(await readFile(join(f.workspace,'script-effect'),'utf8')).toBe('once\n');
  const events=(await readSession(result.session)).events;
  expect(events.some(e=>e.type==='extension.callback.failed'&&(e.payload as any).unknown&&(e.payload as any).processExited)).toBe(true);
  expect(events.filter(e=>e.type==='tool.intent'&&(e.payload as any).name==='ext_process_slow')).toHaveLength(1);
  await f.host.close();
  const reopened=new CustomizationHost(f.workspace,f.home);
  try{await reopened.acquire();await reopened.release();expect(await readFile(join(f.workspace,'script-effect'),'utf8')).toBe('once\n');}
  finally{await reopened.close();}
 }finally{await f.host.close();}
},15000);
it("executes factories and callbacks outside the host and preserves synchronous reload receipts", async () => {
  const f = await setup(`const factoryPid=process.pid; export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('pid',{description:'pid',async handler(a,c){const receipt=c.reload();return JSON.stringify({factoryPid,pid:process.pid,receipt})}})}`);
  try {
    const result = await run({ ...f, mode: "create", ownerWorkspace: await temporary(), target: { kind: "extension", root: f.workspace }, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/pid" });
    expect(result.status).toBe("completed");
    const output = JSON.parse(result.text);
    expect(output.pid).not.toBe(process.pid); expect(output.factoryPid).toBe(output.pid);
    expect(output.receipt.id).toBe(f.host.receipts.at(-1)!.id);
    expect(f.host.receipts.at(-1)!.status).toBe("activated");
  } finally { await f.host.close(); }
});
it("cancels a synchronous infinite loop without blocking the host and does not replay it", async () => {
  const f = await setup(`import {writeFileSync} from 'node:fs'; export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('loop',{description:'loop',async handler(a,c){await c.state.set('started',1,true);writeFileSync('loop.started','ready');while(true){} }})}`);
  const controller = new AbortController();
  const session = join(f.workspace, "session");
  let timer: ReturnType<typeof setTimeout>;
  try {
    // Start cancellation only after the factory has been loaded.
    await f.host.acquire(); await f.host.release();
    timer = setTimeout(() => controller.abort(), 10000);
    const pending = run({ ...f, customization: f.host, session, apiKey: key, prompt: "/loop", signal: controller.signal });
    await expect.poll(async () => readFile(join(f.workspace, "loop.started"), "utf8").catch(() => "waiting"), { timeout: 8000 }).toBe("ready");
    const began = Date.now();
    controller.abort();
    const result = await pending;
    expect(Date.now() - began).toBeLessThan(6000);
    expect(result.status).toBe("cancelled");
    const events = (await readSession(session)).events;
    expect(events.filter(e => e.type === "extension.state")).toHaveLength(1);
    expect(events.find(e => e.type === "extension.callback.failed")?.payload).toMatchObject({ unknown: true, processExited: true });
    // Acquiring a fresh host loads registrations only, not the incomplete command.
    await f.host.acquire(); await f.host.release();
    expect((await readSession(session)).events.filter(e => e.type === "extension.state")).toHaveLength(1);
  } finally { clearTimeout(timer!); controller.abort(); await f.host.close(); }
}, 15_000);
it("records an unknown result after a process exits following a durable host effect", async () => {
  const f = await setup(`import {writeFileSync} from 'node:fs';export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('crash',{description:'crash',async handler(a,c){await c.callTool('write',{path:'effect.txt',content:'once'});writeFileSync('outside-host-services.txt','unobserved');process.exit(9)}})}`);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/crash" });
    expect(result.status).toBe("failed");
    expect(await readFile(join(f.workspace, "effect.txt"), "utf8")).toBe("once");
    const events = (await readSession(result.session)).events;
    expect(events.filter(e => e.type === "tool.intent")).toHaveLength(1);
    expect(events.find(e => e.type === "extension.callback.failed")?.payload).toMatchObject({ unknown: true, captureScope: "host-services-only", externalEffects: "unknown" });
    expect(await readFile(join(f.workspace, "outside-host-services.txt"), "utf8")).toBe("unobserved");
  } finally { await f.host.close(); }
});
it("rejects revoked host grants during an active callback", async () => {
  const f = await setup(`export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('later',{description:'later',async handler(a,c){await new Promise(r=>setTimeout(r,500));await c.state.set('forbidden',1,true);return 'bad'}})}`);
  let timer: ReturnType<typeof setTimeout>;
  try {
    await f.host.acquire(); await f.host.release();
    const result = run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/later" });
    const revoked = new Promise<void>((resolve, reject) => { timer = setTimeout(() => {
      void f.host.catalog.decide(f.resource.id, false, false, 1).then(() => resolve(), reject);
    }, 100); });
    await revoked;
    const outcome = await result;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("revoked");
    expect((await readSession(outcome.session)).events.some(e => e.type === "extension.state")).toBe(false);
  } finally { clearTimeout(timer!); await f.host.close(); }
});
it("rejects duplicate registrations without replacing the active revision", async () => {
  const f = await setup(`export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('ok',{description:'ok',async handler(){return 'ok'}})}`);
  try {
    const active = await f.host.acquire(); await f.host.release();
    await writeFile(join(f.root, "index.ts"), `export default (api: import('nekomimi/extensions').ExtensionAPI)=>{for(let i=0;i<2;i++)api.registerCommand('same',{description:'same',async handler(){}})}`);
    const receipt = f.host.requestReload(); await f.host.reload(receipt);
    expect(receipt.status).toBe("failed"); expect(receipt.error).toContain("duplicate");
    expect(f.host.active?.revision).toBe(active.revision);
  } finally { await f.host.close(); }
});
it("discards late SDK calls instead of attaching them to a new run", async () => {
  const f = await setup(`export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('late',{description:'late',async handler(a,c){if(a==='first'){setTimeout(()=>{c.state.set('late',1,true).catch(()=>{})},150);return 'first'}await new Promise(r=>setTimeout(r,300));return 'second'}})}`);
  try {
    const options = { workspace: f.workspace, home: f.home, customization: f.host, session: join(f.workspace, "session"), apiKey: key };
    expect((await run({ ...options, prompt: "/late first" })).status).toBe("completed");
    expect((await run({ ...options, prompt: "/late second" })).status).toBe("completed");
    expect((await readSession(options.session)).events.some(e => e.type === "extension.state")).toBe(false);
  } finally { await f.host.close(); }
}, 30000);
it("reports oversized callback results as an evidence gap while preserving host responsiveness", async () => {
  const f = await setup(`export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('huge',{description:'huge',async handler(){return 'x'.repeat(6*1024*1024)}})}`);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/huge" });
    expect(result.status).toBe("failed"); expect(result.error).toContain("evidence limit");
    expect((await readSession(result.session)).events.find(e => e.type === "extension.callback.failed")?.payload).toMatchObject({ evidenceGap: true });
  } finally { await f.host.close(); }
});
it("terminates log flooding without treating stdout as RPC or leaking it into the Journal", async () => {
  const f = await setup(`export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('flood',{description:'flood',async handler(){process.stdout.write('private-log-fixture'.repeat(10000));await new Promise(r=>setTimeout(r,30000));return 'must not complete'}})}`);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/flood" });
    expect(result.status).toBe("failed"); expect(result.error).toContain("log limit");
    const events = (await readSession(result.session)).events;
    expect(JSON.stringify(events)).not.toContain("private-log-fixture");
    expect(events.find(e => e.type === "extension.callback.failed")?.payload).toMatchObject({ processExited: true, evidenceGap: true });
  } finally { await f.host.close(); }
});
it('kills and confirms a native process tree including a descendant that ignores SIGTERM',async()=>{
  const f=await setup(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('tree',{description:'tree',async handler(a,c){const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});await new Promise(r=>setTimeout(r,150));writeFileSync('descendant.pid',String(child.pid));process.on('SIGTERM',()=>{});await new Promise(()=>{});}})}`);
  const controller=new AbortController();
  try{
    await f.host.acquire();await f.host.release();
    const task=run({...f,customization:f.host,session:join(f.workspace,'session'),apiKey:key,prompt:'/tree',signal:controller.signal});
    await expect.poll(()=>readFile(join(f.workspace,'descendant.pid'),'utf8').catch(()=>''),{timeout:5000}).not.toBe('');
    const descendant=Number(await readFile(join(f.workspace,'descendant.pid'),'utf8'));controller.abort();
    expect((await task).status).toBe('cancelled');
    if (process.platform === 'win32') expect(()=>process.kill(descendant,0)).toThrow();
    else {
      let state='';
      try {state=execFileSync('ps',['-p',String(descendant),'-o','stat='],{encoding:'utf8'}).trim();}
      catch(error) {if((error as {status?:number}).status!==1)throw error;}
      expect(state === '' || state.startsWith('Z')).toBe(true);
    }
  }finally{controller.abort();await f.host.close();}
},15000);


it("preserves Durable ownership and tool ancestry through concurrent extension RPC calls", async () => {
  const f = await setup(`export default (api: import('nekomimi/extensions').ExtensionAPI)=>{let before=0,after=0;api.on('beforeTool',async(_event,ctx)=>{await ctx.state.set('before',1,++before)});api.on('afterTool',async(_event,ctx)=>{await ctx.state.set('after',1,++after)});api.registerTool({name:'parent',description:'Read two files',parameters:{type:'object',properties:{}},async execute(args,ctx){await Promise.all([ctx.callTool('read',{path:'a.txt'}),ctx.callTool('read',{path:'b.txt'})]);return {content:[{type:'text',text:'done'}]}}})}`, ['hooks']);
  await writeFile(join(f.workspace, 'a.txt'), 'a'); await writeFile(join(f.workspace, 'b.txt'), 'b');
  let calls = 0;
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, 'session'), apiKey: key, prompt: 'read both', tools: ['read', 'ext_process_parent'], fetch: async () => ++calls === 1 ? response([callItem('ext_process_parent', {}, 'parent-wire')]) : response([textItem()]) });
    expect(result.status).toBe('completed');
    const events = (await readSession(result.session)).events;
    const intents = events.filter(event => event.type === 'tool.intent');
    expect(intents).toHaveLength(3);
    for (const key of ['before', 'after']) expect(events.filter(event => event.type === 'extension.state' && (event.payload as {key:string}).key === key)).toHaveLength(3);
    for (const intent of intents) expect(intent.payload).toMatchObject({ schemaHash: expect.any(String), capabilityRevision: expect.any(String) });
    const parent = intents.find(event => (event.payload as {name:string}).name === 'ext_process_parent')!;
    expect(parent.frameworkTaskId).toBeTypeOf('number');
    const children = intents.filter(event => event !== parent);
    expect(new Set(children.map(event => event.toolCallId)).size).toBe(2);
    for (const child of children) {
      expect(child.parentToolCallId).toBe(parent.toolCallId);
      expect(child.frameworkTaskId).toBe(parent.frameworkTaskId);
      expect(child.conversationId).toBe(parent.conversationId);
      const evidence = events.filter(event => event.toolCallId === child.toolCallId);
      expect(evidence.some(event => event.type === 'tool.completed')).toBe(true);
      expect(evidence.every(event => event.parentToolCallId === parent.toolCallId)).toBe(true);
    }
    expect(new Set(events.map(event => event.seq)).size).toBe(events.length);
  } finally { await f.host.close(); }
});

it('cancels a script child model across RPC while the main run remains live', async () => {
  const f = await setup(`import {existsSync} from 'node:fs'; export default (api:import('nekomimi/extensions').ExtensionAPI)=>{
    api.registerTool({name:'helper',description:'helper',parameters:{type:'object',properties:{}},async execute(a,c){await c.model('SDK_CHILD_CANCELLATION');return {content:[]};}});
    api.registerTool({name:'ready',description:'ready',parameters:{type:'object',properties:{}},async execute(){while(!existsSync('model-started'))await new Promise(r=>setTimeout(r,5));return {content:[]};}});
  }`, ['model']);
  const controller = new AbortController(); let main = 0, auxiliary = 0, cancelled = false;
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, 'session'), apiKey: key, signal: controller.signal, prompt: 'nested cancellation', tools: ['codemode','ext_process_helper','ext_process_ready'], fetch: async (_url, init) => {
      if (String(init?.body).includes('SDK_CHILD_CANCELLATION')) {
        auxiliary++; await writeFile(join(f.workspace, 'model-started'), 'ready');
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(response([textItem('late helper result')])), 3000);
          const abort = () => { cancelled = true; clearTimeout(timer); reject(init?.signal?.reason); };
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) abort();
        });
      }
      return response(++main === 1 ? [callItem('codemode', { code: 'void tools.ext_process_helper({}); await tools.ext_process_ready({}); return "done";' })] : [textItem('Main continues.')]);
    }});
    expect(result.status, result.error).toBe('completed');
    expect(controller.signal.aborted).toBe(false);
    expect({ main, auxiliary, cancelled }).toEqual({ main: 2, auxiliary: 1, cancelled: true });
    const events = (await readSession(result.session)).events;
    const helper = events.find(e => e.type === 'tool.intent' && (e.payload as any).name === 'ext_process_helper')!;
    expect(events.some(e => e.type === 'attempt.started' && e.toolCallId === helper.toolCallId)).toBe(true);
    expect(JSON.stringify(events.filter(e => e.type === 'context.add'))).not.toContain('late helper result');
  } finally { controller.abort(); await f.host.close(); }
}, 15000);

it('shares the operation budget across nested SDK tool calls and prevents subsequent models', async () => {
  const f = await setup(`export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('budget',{description:'budget',async handler(a,c){
    let exhausted=false;
    for(let i=0;i<8;i++)try{await c.callTool('read',{path:'small.txt'});}catch(error){
      if(!String(error).includes('budget exceeded'))throw error;
      exhausted=true;break;
    }
    if(!exhausted)throw new Error('Nested calls did not consume the shared budget');
    // Even a callback that catches exhaustion must not dispatch a model.
    return await c.model('must not dispatch');
  }})}`, ['model']);
  await writeFile(join(f.workspace, 'small.txt'), 'small'); let requests = 0;
  const originalLimit = LIMITS.operations;
  try {
    expect(originalLimit).toBe(128);
    // Exercise the actual cross-process admission path with a small test budget,
    // rather than making the assertion depend on dozens of fsyncs completing in 30s.
    LIMITS.operations = 6;
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, 'session'), apiKey: key, prompt: '/budget', fetch: async () => { requests++; return response([textItem()]); } });
    expect(result.status).toBe('failed'); expect(result.error).toContain('budget exceeded');
    expect(requests).toBe(0);
    const events = (await readSession(result.session)).events;
    const reads = events.filter(e => e.type === 'tool.intent' && (e.payload as any).name === 'read');
    expect(reads.length).toBeGreaterThan(0); expect(reads.length).toBeLessThan(8);
    expect(events.filter(e => e.type === 'tool.completed' && (e.payload as any).name === 'read')).toHaveLength(reads.length);
  } finally { LIMITS.operations = originalLimit; await f.host.close(); }
}, 30000);

it('runs hooks in registration order around the recorded tool effect', async () => {
  const f = await setup(`export default (api:import('nekomimi/extensions').ExtensionAPI)=>{
    api.on('beforeRun',async(e,c)=>{await c.state.set('order',1,'beforeRun')});
    for(const phase of ['beforeTool','afterTool'] as const)for(const n of [1,2])api.on(phase,async(e,c)=>{await c.state.set('order',1,phase+n)});
    api.on('afterRun',async(e,c)=>{await c.state.set('order',1,'afterRun')});
    api.registerCommand('ordered',{description:'ordered',async handler(a,c){await c.callTool('write',{path:'ordered.txt',content:'once'});return 'done'}});
  }`, ['hooks']);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, 'session'), apiKey: key, prompt: '/ordered' });
    expect(result.status, result.error).toBe('completed');
    const events = (await readSession(result.session)).events;
    const order = events.filter(e => e.type === 'extension.state').map(e => (e.payload as any).value);
    expect(order).toEqual(['beforeRun','beforeTool1','beforeTool2','afterTool1','afterTool2','afterRun']);
    const index = (value: string) => events.findIndex(e => e.type === 'extension.state' && (e.payload as any).value === value);
    const completed = events.findIndex(e => e.type === 'tool.completed' && (e.payload as any).name === 'write');
    expect(index('beforeTool2')).toBeLessThan(completed); expect(index('afterTool1')).toBeGreaterThan(completed);
    expect(await readFile(join(f.workspace, 'ordered.txt'), 'utf8')).toBe('once');
  } finally { await f.host.close(); }
});
