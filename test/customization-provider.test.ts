import { expect, it } from "vitest";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CustomizationHost } from "../src/customization/host.js";
import { ProviderProfiles } from "../src/customization/provider-profiles.js";
import { run } from "../src/runtime.js";
import { readSession, readArtifact } from "../src/journal.js";
import { temporary, key, response, callItem, textItem, reasoning } from "./helpers.js";
import { branchHistory } from "../src/customization/history-branch.js";
import { ConfigStore } from "../src/config/store.js";
async function fixture(protocol: "responses" | "chat-completions") {
  const workspace = await temporary(), home = await temporary(), root = join(workspace, ".nekomimi/extensions/providers");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "providers", sdkVersion: 2, entry: "index.ts", requiredCapabilities: ["providers"] }));
  await copyFile(resolve("extension-docs/http-providers.ts"), join(root, "index.ts"));
  const host = new CustomizationHost(workspace, home), resource = (await host.catalog.discover()).find(r => r.kind === "extension")!;
  await host.catalog.decide(resource.id, true, true, 0);
  const profiles = new ProviderProfiles(home);
  await profiles.saveCredential("test-key", "provider-secret-fixture");
  await profiles.save({ id: "fixture", providerId: protocol === "responses" ? "example-responses" : "example-chat", resourceId: resource.id, model: "fixture-model", baseUrl: "https://fixture.invalid/v1", paths: [protocol === "responses" ? "/responses" : "/chat/completions"], credentialRef: "test-key" }, 0);
  await profiles.select("main", "fixture", 1);
  return { workspace, home, root, host, profiles };
}
for (const protocol of ["responses", "chat-completions"] as const) for (const sse of [false, true]) it(`runs a ${protocol} ${sse ? "SSE" : "JSON"} adapter in a child with native request/tool evidence`, async () => {
  const f = await fixture(protocol); await writeFile(join(f.workspace, "source.txt"), "read evidence");
  let calls = 0; const requests: string[] = [];
  try {
    const result = await run({ ...f, customization: f.host, apiKey: key, session: join(f.workspace, "session"), prompt: "Read source", fetch: async (url, init) => {
      expect(String(url)).toBe(`https://fixture.invalid/v1/${protocol === "responses" ? "responses" : "chat/completions"}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer provider-secret-fixture");
      requests.push(String(init!.body)); calls++;
      const output = calls === 1 ? [callItem("read", { path: "source.txt" }, "adapter-call")] : [textItem("Adapter done")];
      if (protocol === "responses") return sse ? response(output) : Response.json({ status: "completed", output });
      const message = calls === 1 ? { role: "assistant", content: null, tool_calls: [{ id: "adapter-call", type: "function", function: { name: "read", arguments: '{"path":"source.txt"}' } }] } : { role: "assistant", content: "Adapter done" };
      const finish = calls === 1 ? "tool_calls" : "stop";
      if (!sse) return Response.json({ choices: [{ message, finish_reason: finish }] });
      const delta = calls === 1 ? { tool_calls: [{ index: 0, ...message.tool_calls![0] }] } : { content: "Adapter done" };
      return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    } });
    expect(result.status, result.error).toBe("completed"); expect(result.text).toBe("Adapter done"); expect(calls).toBe(2);
    const session = await readSession(result.session), dispatched = session.events.filter(e => e.type === "request.dispatched");
    expect(dispatched).toHaveLength(2);
    for (let i = 0; i < 2; i++) expect((await readArtifact(result.session, (dispatched[i]!.payload as any).body)).toString()).toBe(requests[i]);
    expect(session.events.filter(e => e.type === "tool.intent" && (e.payload as any).name === "read")).toHaveLength(1);
    expect(JSON.stringify(session.events)).not.toContain("provider-secret-fixture");
    expect(JSON.parse(requests[1]!)[protocol === "responses" ? "input" : "messages"]).toEqual(expect.arrayContaining([expect.objectContaining(protocol === "responses" ? { type: "function_call_output", call_id: "adapter-call" } : { role: "tool", tool_call_id: "adapter-call" })]));
  } finally { await f.host.close(); }
});
it("rejects unapproved paths and unsupported tools before credential dispatch", async () => {
  const f = await fixture("responses"); let calls = 0;
  try {
    const profiles = await f.profiles.list(); await f.profiles.save({ ...profiles.entries.fixture!, paths: ["/different"] }, profiles.revision);
    const options = { ...f, customization: f.host, apiKey: key, prompt: "go", fetch: async () => { calls++; return response([textItem()]); } };
    const rejected = await run({ ...options, session: join(f.workspace, "path") }); expect(rejected.status).toBe("failed"); expect(rejected.error).toContain("path not authorized"); expect(calls).toBe(0);
    await writeFile(join(f.root, "index.ts"), (await readFile(join(f.root, "index.ts"), "utf8")).replace("tools: true", "tools: false"));
    const receipt = f.host.requestReload(); await f.host.reload(receipt); expect(receipt.status).toBe("activated");
    const unsupported = await run({ ...options, session: join(f.workspace, "tools") }); expect(unsupported.status).toBe("failed"); expect(unsupported.error).toContain("does not support"); expect(calls).toBe(0);
  } finally { await f.host.close(); }
});
it("retains parser failure evidence, rejects incompatible history and does not retry parser errors", async () => {
  const f = await fixture("responses"); let calls = 0;
  try {
    const failed = await run({ ...f, customization: f.host, apiKey: key, session: join(f.workspace, "bad-parser"), prompt: "go", fetch: async () => { calls++; return Response.json({ invalid: true }); } });
    expect(failed.status).toBe("failed"); expect(calls).toBe(1);
    expect((await readSession(failed.session)).events.some(e => e.type === "response.chunk")).toBe(true);
    const successful = await run({ ...f, customization: f.host, apiKey: key, session: join(f.workspace, "history"), prompt: "go", fetch: async () => response([textItem()]) });
    const p = await f.profiles.list(); await f.profiles.save({ ...p.entries.fixture!, providerId: "example-chat", paths: ["/chat/completions"] }, p.revision);
    await expect(run({ ...f, customization: f.host, apiKey: key, session: successful.session, prompt: "continue", fetch: async () => { calls++; throw new Error("must not send"); } })).rejects.toThrow("history incompatible"); expect(calls).toBe(1);
  } finally { await f.host.close(); }
});
it("branches native reasoning with explicit consent, preserves source artifacts and keeps tool pairs without replay", async () => {
  const f = await fixture("responses"); let requests = 0;
  try {
    const source = await run({ ...f, customization: f.host, apiKey: key, session: join(f.workspace, "original"), prompt: "reason", fetch: async () => { requests++; return response([reasoning, textItem("Original text")]); } });
    const destination = join(f.workspace, "branch");
    await expect(branchHistory(source.session, destination, f.workspace, false)).rejects.toThrow("Explicit consent");
    const branch = await branchHistory(source.session, destination, f.workspace, true); expect(branch.omittedReasoning).toBe(1); expect(requests).toBe(1);
    const events = (await readSession(destination)).events; const origin = events.find(e => e.type === "branch.created")!;
    expect((await readArtifact(branch.directory, (origin.payload as any).sourceEvents)).toString()).toContain("Synthetic reasoning fixture.");
    expect(events.filter(e => e.type === "context.add").some(e => (e.payload as any).item.type === "reasoning")).toBe(false);
    const p = await f.profiles.list(); await f.profiles.save({ ...p.entries.fixture!, providerId: "example-chat", paths: ["/chat/completions"] }, p.revision);
    const continued = await run({ ...f, customization: f.host, apiKey: key, session: destination, prompt: "continue", fetch: async (_url, init) => { const body = JSON.parse(String(init!.body)); expect(JSON.stringify(body.messages)).toContain("Original text"); expect(JSON.stringify(body.messages)).not.toContain("Synthetic reasoning fixture"); return Response.json({ choices: [{ message: { role: "assistant", content: "Branched" }, finish_reason: "stop" }] }); } });
    expect(continued.text).toBe("Branched");
    expect((await readSession(source.session)).events.some(e => e.type === "branch.created")).toBe(false);
  } finally { await f.host.close(); }
});
it("backs up and migrates old settings without exposing credentials in profiles or breaking the original store", async () => {
  const home = await temporary(), config = new ConfigStore(home), profiles = new ProviderProfiles(home);
  await config.save("auth", { revision: 0, apiKey: "migration-secret" });
  const result = await profiles.migrateLegacy(0);
  expect(result.selection.main).toBe("legacy-deepseek"); expect(JSON.stringify(result)).not.toContain("migration-secret");
  expect((await profiles.resolve("main"))?.apiKey).toBe("migration-secret");
  expect((await config.snapshot()).apiKey).toBe("migration-secret");
  expect(await readFile(join(home, "provider-migration-backup.json"), "utf8")).toContain("migration-secret");
  await expect(profiles.migrateLegacy(0)).rejects.toThrow("conflict"); expect((await config.snapshot()).apiKey).toBe("migration-secret");
});
it("rejects duplicate provider activation without replacing the last working registry", async () => {
  const f = await fixture("responses");
  try {
    const first = await f.host.acquire(); const revision = first.revision; await f.host.release();
    await writeFile(join(f.root, "index.ts"), (await readFile(join(f.root, "index.ts"), "utf8")).replace('api.registerProvider(adapter("responses"));', 'api.registerProvider(adapter("responses")); api.registerProvider(adapter("responses"));'));
    const receipt = f.host.requestReload(); await f.host.reload(receipt);
    expect(receipt.status).toBe("failed"); expect(receipt.error).toContain("Duplicate Provider"); expect(f.host.active?.revision).toBe(revision);
    const result = await run({ ...f, customization: f.host, apiKey: key, session: join(f.workspace, "retained"), prompt: "go", fetch: async () => response([textItem("Still works")]) });
    expect(result.text).toBe("Still works");
  } finally { await f.host.close(); }
});
it('keeps auxiliary and naming profiles separate from the main provider and gives each an independent context',async()=>{
 const f=await fixture('responses');
 try{
  const manifest=JSON.parse(await readFile(join(f.root,'extension.json'),'utf8'));manifest.requiredCapabilities.push('commands','model');await writeFile(join(f.root,'extension.json'),JSON.stringify(manifest));
  await writeFile(join(f.root,'index.ts'),(await readFile(join(f.root,'index.ts'),'utf8')).replace('}) satisfies ExtensionFactory2;',`api.registerCommand('aux',{description:'aux',async handler(_a,ctx){return await ctx.model('Only auxiliary input');}});}) satisfies ExtensionFactory2;`));
  const resource=(await f.host.catalog.discover()).find(r=>r.kind==='extension')!;await f.host.catalog.decide(resource.id,true,true,(await f.host.catalog.decisions()).revision);
  let profiles=await f.profiles.list();await f.profiles.save({...profiles.entries.fixture!,id:'aux',providerId:'example-chat',paths:['/chat/completions']},profiles.revision);
  profiles=await f.profiles.list();await f.profiles.select('auxiliary','aux',profiles.revision);profiles=await f.profiles.list();await f.profiles.select('naming','aux',profiles.revision);
  const calls:Array<{url:string;body:any}>=[];
  const fetcher:typeof fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init!.body))});return String(url).endsWith('/responses')?response([textItem('Main secret context')]):Response.json({choices:[{message:{role:'assistant',content:calls.length===2?'Auxiliary only':'Independent title'},finish_reason:'stop'}]});};
  const original=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'conversation'),prompt:'Main user context',fetch:fetcher});
  const auxiliary=await run({...f,customization:f.host,apiKey:key,session:original.session,prompt:'/aux',fetch:fetcher});expect(auxiliary.text).toBe('Auxiliary only');
  expect(calls[1]!.url).toContain('/chat/completions');expect(JSON.stringify(calls[1]!.body)).toContain('Only auxiliary input');expect(JSON.stringify(calls[1]!.body)).not.toContain('Main secret context');
  const titleSource=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'title'),prompt:'Title input',fetch:async()=>response([textItem('Main response not passed to title')])});
  const {nameSession}=await import('../src/session/title.js');await nameSession(titleSource.session,{apiKey:key,fetch:fetcher},new AbortController().signal,{},f.host);
  expect(calls[2]!.url).toContain('/chat/completions');expect(JSON.stringify(calls[2]!.body)).not.toContain('Main response not passed to title');
  expect((await readSession(titleSource.session)).events.findLast(e=>e.type==='session.title')?.payload).toMatchObject({title:'Independent title'});
 }finally{await f.host.close();}
});
it('cancels an incomplete parser stream without executing tool calls and disposes parser state before the next run',async()=>{
 const f=await fixture('responses'),abort=new AbortController();let dispatched=false;
 try{
  const session=join(f.workspace,'cancel');
  const pending=run({...f,customization:f.host,apiKey:key,session,prompt:'go',signal:abort.signal,fetch:async()=>{dispatched=true;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({status:'completed',output:[callItem('write',{path:'must-not-exist',content:'bad'})]})));}}),{headers:{'content-type':'application/json'}});}});
  await expect.poll(()=>dispatched).toBe(true);abort.abort();const result=await pending;expect(result.status).toBe('cancelled');
  expect((await readSession(session)).events.some(e=>e.type==='tool.intent')).toBe(false);
  const next=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'next'),prompt:'retry explicitly',fetch:async()=>response([textItem('Clean parser')])});expect(next.text).toBe('Clean parser');
 }finally{abort.abort();await f.host.close();}
});
it('rejects a revoked credential between attempts instead of dispatching a retry with a stale key',async()=>{
 const f=await fixture('responses');let calls=0;
 try{
  const result=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'revoked'),prompt:'go',fetch:async()=>{calls++;await f.profiles.saveCredential('test-key',null);return new Response('temporary failure',{status:503});}});
  expect(calls).toBe(1);expect(result.status).toBe('failed');expect(result.error).toContain('credential changed or revoked');
 }finally{await f.host.close();}
});
it('preserves image and multiple tool pairs in explicit protocol branches without replaying effects',async()=>{
 const f=await fixture('responses');await writeFile(join(f.workspace,'one.txt'),'one');await writeFile(join(f.workspace,'two.txt'),'two');let calls=0;
 try{
  const original=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'original-pairs'),prompt:'Review image and files',images:[{type:'image',data:'iVBORw0KGgo=',mimeType:'image/png'}],fetch:async()=>++calls===1?response([callItem('read',{path:'one.txt'},'one-call'),callItem('read',{path:'two.txt'},'two-call')]):response([textItem('Paired')])});
  expect(original.status).toBe('completed');const branch=await branchHistory(original.session,join(f.workspace,'pairs-branch'),f.workspace,false);
  const profile=await f.profiles.list();await f.profiles.save({...profile.entries.fixture!,providerId:'example-chat',paths:['/chat/completions']},profile.revision);
  const continued=await run({...f,customization:f.host,apiKey:key,session:branch.directory,prompt:'Continue',fetch:async(_url,init)=>{
   const messages=JSON.parse(String(init!.body)).messages;expect(JSON.stringify(messages)).toContain('data:image/png;base64,iVBORw0KGgo=');
   expect(messages.filter((m:any)=>m.role==='tool').map((m:any)=>m.tool_call_id).sort()).toEqual(['one-call','two-call']);
   expect(messages.find((m:any)=>m.tool_calls)?.tool_calls).toHaveLength(2);
   return Response.json({choices:[{message:{role:'assistant',content:'Branch checked'},finish_reason:'stop'}]});
  }});expect(continued.text).toBe('Branch checked');expect((await readSession(branch.directory)).events.some(e=>e.type==='tool.intent')).toBe(false);
 }finally{await f.host.close();}
});
it('rejects unsupported image inputs and unknown model capabilities before dispatch or replacement',async()=>{
 const f=await fixture('responses');let calls=0;
 try{
  await writeFile(join(f.root,'index.ts'),(await readFile(join(f.root,'index.ts'),'utf8')).replace('images: true','images: false'));
  const result=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'image'),prompt:'image',images:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgo='}],fetch:async()=>{calls++;return response([textItem()]);}});
  expect(result.status).toBe('failed');expect(result.error).toContain('does not support');expect(calls).toBe(0);
  const {validateProvider,defaultModel}=await import('../src/customization/provider-registry.js');expect(()=>validateProvider({id:'unknown-capability',models:[{...defaultModel,capabilities:{...defaultModel.capabilities,future:true} as any}]})).toThrow('Invalid Provider');
 }finally{await f.host.close();}
});
it('does not forward profile credentials across HTTP redirects',async()=>{
 const {createServer}=await import('node:http');const f=await fixture('responses');let redirected=0;
 const target=createServer((_req,res)=>{redirected++;res.end('{}');});await new Promise<void>(r=>target.listen(0,'127.0.0.1',r));
 const origin=createServer((req,res)=>{expect(req.headers.authorization).toBe('Bearer provider-secret-fixture');res.writeHead(302,{location:`http://127.0.0.1:${(target.address() as any).port}/stolen`}).end();});await new Promise<void>(r=>origin.listen(0,'127.0.0.1',r));
 try{
  const profiles=await f.profiles.list();await f.profiles.save({...profiles.entries.fixture!,baseUrl:`http://127.0.0.1:${(origin.address() as any).port}`},profiles.revision);
  const result=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'redirect'),prompt:'go',maxAttempts:1});expect(result.status).toBe('failed');expect(redirected).toBe(0);
 }finally{await f.host.close();origin.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise<void>(r=>origin.close(()=>r())),new Promise<void>(r=>target.close(()=>r()))]);}
});
it('supports an arbitrary JSON protocol with explicit native tool evidence pointers',async()=>{
 const f=await fixture('responses');await writeFile(join(f.workspace,'custom.txt'),'custom protocol');let calls=0;
 const source=`import type {ExtensionFactory2,ProviderOutput} from 'nekomimi/extensions';export default ((api)=>{let body='';api.registerProvider({id:'example-responses',models:[{id:'fixture-model',name:'Custom',protocol:'custom-json-v1',historyCompatibility:'custom-v1',contextWindow:128000,maxOutputTokens:4096,capabilities:{tools:true,images:false,reasoning:false}}],async serialize(input){return {path:'/responses',body:{dialogue:input.history}};},async parse(input):Promise<ProviderOutput|null>{if(input.sequence===1)body='';body+=input.chunk;if(!input.final)return null;const native=JSON.parse(body);if(native.invoke)return {terminal:'completed',rawItems:[native],contextItems:[{type:'function_call',call_id:native.invoke.id,name:native.invoke.tool,arguments:JSON.stringify(native.invoke.args)}],projection:{content:[{type:'toolCall',id:native.invoke.id,name:native.invoke.tool,arguments:native.invoke.args}]},toolEvidence:{[native.invoke.id]:{itemIndex:0,callIdPath:'/invoke/id',namePath:'/invoke/tool',argumentsPath:'/invoke/args'}}};return {terminal:'completed',rawItems:[native],contextItems:[{type:'message',role:'assistant',content:[{type:'output_text',text:native.answer}]}],projection:{content:[{type:'text',text:native.answer}]}};}});}) satisfies ExtensionFactory2;`;
 try{
  await writeFile(join(f.root,'index.ts'),source);
  const result=await run({...f,customization:f.host,apiKey:key,session:join(f.workspace,'custom-protocol'),prompt:'read',fetch:async()=>Response.json(++calls===1?{invoke:{id:'custom-call',tool:'read',args:{path:'custom.txt'}}}:{answer:'Custom protocol done'})});
  expect(result.text,result.error).toBe('Custom protocol done');expect(calls).toBe(2);expect((await readSession(result.session)).events.filter(e=>e.type==='tool.completed')).toHaveLength(1);
 }finally{await f.host.close();}
});
it.each(['backup-written','credential-written'])('keeps original settings usable if migration stops at %s',async phase=>{
 const home=await temporary(),config=new ConfigStore(home),profiles=new ProviderProfiles(home);await config.save('auth',{revision:0,apiKey:'original-migration-key'});
 await expect(profiles.migrateLegacy(0,stage=>{if(stage===phase)throw new Error('interrupted migration');})).rejects.toThrow('interrupted migration');
 expect((await profiles.list()).entries).toEqual({});expect((await config.snapshot()).apiKey).toBe('original-migration-key');
 expect((await profiles.migrateLegacy(0)).selection.main).toBe('legacy-deepseek');expect((await profiles.resolve('main'))?.apiKey).toBe('original-migration-key');
});
