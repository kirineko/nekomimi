import { expect, it } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CustomizationHost } from "../src/customization/host.js";
import { run } from "../src/runtime.js";
import { readSession } from "../src/journal.js";
import { temporary, key } from "./helpers.js";
async function setup(source: string) {
  const workspace = await temporary(), home = await temporary();
  const root = join(workspace, ".nekomimi/extensions/process");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "process", sdkVersion: 1, entry: "index.ts" }));
  await writeFile(join(root, "index.ts"), source);
  const host = new CustomizationHost(workspace, home);
  const resource = (await host.catalog.discover()).find(r => r.kind === "extension")!;
  await host.catalog.decide(resource.id, true, true, 0);
  return { workspace, home, host, resource, root };
}
it("executes factories and callbacks outside the host and preserves synchronous reload receipts", async () => {
  const f = await setup(`const factoryPid=process.pid; export default api=>{api.registerCommand('pid',{description:'pid',async handler(a,c){const receipt=c.reload();return JSON.stringify({factoryPid,pid:process.pid,receipt})}})}`);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/pid" });
    expect(result.status).toBe("completed");
    const output = JSON.parse(result.text);
    expect(output.pid).not.toBe(process.pid); expect(output.factoryPid).toBe(output.pid);
    expect(output.receipt.id).toBe(f.host.receipts.at(-1)!.id);
    expect(f.host.receipts.at(-1)!.status).toBe("activated");
  } finally { await f.host.close(); }
});
it("cancels a synchronous infinite loop without blocking the host and does not replay it", async () => {
  const f = await setup(`import {writeFileSync} from 'node:fs'; export default api=>{api.registerCommand('loop',{description:'loop',async handler(a,c){await c.state.set('started',1,true);writeFileSync('loop.started','ready');while(true){} }})}`);
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
  const f = await setup(`export default api=>{api.registerCommand('crash',{description:'crash',async handler(a,c){await c.callTool('write',{path:'effect.txt',content:'once'});process.exit(9)}})}`);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/crash" });
    expect(result.status).toBe("failed");
    expect(await readFile(join(f.workspace, "effect.txt"), "utf8")).toBe("once");
    const events = (await readSession(result.session)).events;
    expect(events.filter(e => e.type === "tool.intent")).toHaveLength(1);
    expect(events.find(e => e.type === "extension.callback.failed")?.payload).toMatchObject({ unknown: true });
  } finally { await f.host.close(); }
});
it("rejects revoked host grants during an active callback", async () => {
  const f = await setup(`export default api=>{api.registerCommand('later',{description:'later',async handler(a,c){await new Promise(r=>setTimeout(r,500));await c.state.set('forbidden',1,true);return 'bad'}})}`);
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
  const f = await setup(`export default api=>{api.registerCommand('ok',{description:'ok',async handler(){return 'ok'}})}`);
  try {
    const active = await f.host.acquire(); await f.host.release();
    await writeFile(join(f.root, "index.ts"), `export default api=>{for(let i=0;i<2;i++)api.registerCommand('same',{description:'same',async handler(){}})}`);
    const receipt = f.host.requestReload(); await f.host.reload(receipt);
    expect(receipt.status).toBe("failed"); expect(receipt.error).toContain("duplicate");
    expect(f.host.active?.revision).toBe(active.revision);
  } finally { await f.host.close(); }
});
it("discards late SDK calls instead of attaching them to a new run", async () => {
  const f = await setup(`export default api=>{api.registerCommand('late',{description:'late',async handler(a,c){if(a==='first'){setTimeout(()=>{c.state.set('late',1,true).catch(()=>{})},150);return 'first'}await new Promise(r=>setTimeout(r,300));return 'second'}})}`);
  try {
    const options = { workspace: f.workspace, home: f.home, customization: f.host, session: join(f.workspace, "session"), apiKey: key };
    expect((await run({ ...options, prompt: "/late first" })).status).toBe("completed");
    expect((await run({ ...options, prompt: "/late second" })).status).toBe("completed");
    expect((await readSession(options.session)).events.some(e => e.type === "extension.state")).toBe(false);
  } finally { await f.host.close(); }
});
it("reports oversized callback results as an evidence gap while preserving host responsiveness", async () => {
  const f = await setup(`export default api=>{api.registerCommand('huge',{description:'huge',async handler(){return 'x'.repeat(6*1024*1024)}})}`);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/huge" });
    expect(result.status).toBe("failed"); expect(result.error).toContain("evidence limit");
    expect((await readSession(result.session)).events.find(e => e.type === "extension.callback.failed")?.payload).toMatchObject({ evidenceGap: true });
  } finally { await f.host.close(); }
});
it("terminates log flooding without treating stdout as RPC or leaking it into the Journal", async () => {
  const f = await setup(`export default api=>{api.registerCommand('flood',{description:'flood',async handler(){process.stdout.write('private-log-fixture'.repeat(10000));await new Promise(r=>setTimeout(r,30000));return 'must not complete'}})}`);
  try {
    const result = await run({ ...f, customization: f.host, session: join(f.workspace, "session"), apiKey: key, prompt: "/flood" });
    expect(result.status).toBe("failed"); expect(result.error).toContain("log limit");
    const events = (await readSession(result.session)).events;
    expect(JSON.stringify(events)).not.toContain("private-log-fixture");
    expect(events.find(e => e.type === "extension.callback.failed")?.payload).toMatchObject({ processExited: true, evidenceGap: true });
  } finally { await f.host.close(); }
});
it('kills and confirms a native process tree including a descendant that ignores SIGTERM',async()=>{
  const f=await setup(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';export default api=>{api.registerCommand('tree',{description:'tree',async handler(a,c){const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});await new Promise(r=>setTimeout(r,150));writeFileSync('descendant.pid',String(child.pid));process.on('SIGTERM',()=>{});await new Promise(()=>{});}})}`);
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
