import {expect,it} from 'vitest';
import {join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {run} from '../src/runtime.js';
import {Journal,readSession,readArtifact} from '../src/journal.js';
import {CustomizationHost} from '../src/customization/host.js';
import {ProviderProfiles} from '../src/customization/provider-profiles.js';
import {temporary,key,response,textItem,callItem} from './helpers.js';
async function fixture(protocol='responses'){
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/providers');await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'providers',sdkVersion:2,entry:'index.ts',requiredCapabilities:['providers']}));
 await writeFile(join(root,'index.ts'),(await readFile(resolve('extension-docs/http-providers.ts'),'utf8')).replace('contextWindow: 128000','contextWindow: 20000').replace('maxOutputTokens: 4096','maxOutputTokens: 2000'));
 const host=new CustomizationHost(workspace,home),resource=(await host.catalog.discover()).find(r=>r.kind==='extension')!;
 await host.catalog.decide(resource.id,true,true,0);const profiles=new ProviderProfiles(home);
 await profiles.save({id:'test',providerId:protocol==='responses'?'example-responses':'example-chat',resourceId:resource.id,model:'fixture-model',baseUrl:'https://fixture.invalid',paths:[protocol==='responses'?'/responses':'/chat/completions']},0);await profiles.select('main','test',1);
 const session=join(workspace,'session');return {workspace,home,root,host,session,profiles};
}
async function seed(session:string,groups=8){const j=await Journal.open(session);try{for(let i=0;i<groups;i++){await j.append('context.add',{source:'fixture',item:{role:'user',content:[{type:'input_text',text:'History '+i+' 中'.repeat(1500)}]}});await j.append('context.add',{source:'fixture',item:{role:'assistant',content:[{type:'output_text',text:'done'}]}});}}finally{await j.close();}}
for(const protocol of ['responses','chat-completions'])it(`auto + manual ${protocol} share projection, shrink wire input and retain raw evidence`,async()=>{
 const f=await fixture(protocol),requests:any[]=[];
 const fetcher:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);const summary=JSON.stringify(body).includes('Conversation data:');return protocol==='responses'?response([textItem(summary?'Short summary with pending objectives.':'done')]):Response.json({choices:[{message:{role:'assistant',content:summary?'Short summary':'done'},finish_reason:'stop'}]});};
 const opts={...f,customization:f.host,apiKey:key,fetch:fetcher,tools:[]};
 try{
  await seed(f.session);const result=await run({...opts,prompt:'continue'});expect(result.status,result.error).toBe('completed');expect(requests.length).toBeGreaterThan(1);
  const summaryRequests=requests.filter(r=>JSON.stringify(r).includes('Conversation data:'));expect(summaryRequests.length).toBeGreaterThan(0);expect(summaryRequests.every(r=>r.tools.length===0)).toBe(true);
  expect(JSON.stringify(requests.at(-1))).toContain('历史摘要');expect(JSON.stringify(requests.at(-1)).length).toBeLessThan(20000);
  let events=(await readSession(f.session)).events;expect(events.some(e=>e.type==='compaction.completed')).toBe(true);
  expect(events.filter(e=>e.type==='context.add').some(e=>JSON.stringify(e.payload).includes('History 0'))).toBe(true);
  const sent=events.filter(e=>e.type==='request.dispatched');for(let i=0;i<sent.length;i++)expect(JSON.parse((await readArtifact(result.session,(sent[i]!.payload as any).body)).toString())).toEqual(requests[i]);
  await seed(f.session,4);const count=requests.length;const manual=await run({...opts,prompt:'/compact preserve paths'});expect(manual.status,manual.error).toBe('completed');expect(manual.text).toContain('已整理');expect(requests.slice(count).every(r=>JSON.stringify(r).includes('Conversation data:'))).toBe(true);
  events=(await readSession(f.session)).events;expect(events.filter(e=>e.type==='context.add').some(e=>JSON.stringify(e.payload).includes('/compact'))).toBe(false);
  expect(events.filter(e=>e.type==='attempt.started').some(e=>(e.payload as any).purpose==='compaction')).toBe(true);
 }finally{await f.host.close();}
},30000);
it('automatic gate runs after tool results without executing any tool twice',async()=>{
 const f=await fixture();await seed(f.session,6);await writeFile(join(f.workspace,'large.txt'),'中'.repeat(5000));let main=0,summary=0;
 try{const result=await run({...f,customization:f.host,apiKey:key,prompt:'read',tools:['read'],fetch:async(_url,init)=>{
 const body=JSON.parse(String(init?.body));if(JSON.stringify(body).includes('Conversation data:')){summary++;return response([textItem('summary')]);}
 main++;return response(main===1?[callItem('read',{path:'large.txt'})]:[textItem('done')]);
 }});expect(result.status,result.error).toBe('completed');expect(main).toBe(2);expect(summary).toBeGreaterThan(0);const events=(await readSession(f.session)).events;expect(events.filter(e=>e.type==='tool.intent')).toHaveLength(1);expect(events.find(e=>e.type==='compaction.started')!.seq).toBeGreaterThan(events.find(e=>e.type==='tool.result')!.seq);
 }finally{await f.host.close();}
},30000);
for(const mode of ['tools','incomplete','cancel','disabled'] as const)it(`summary ${mode} preserves context and cannot execute effects`,async()=>{
 const f=await fixture(),abort=new AbortController();await seed(f.session);let calls=0;
 try{const result=await run({...f,customization:f.host,apiKey:key,prompt:'continue',tools:[],autoCompact:mode!=='disabled',signal:abort.signal,fetch:async()=>{calls++;if(mode==='cancel')abort.abort();return mode==='tools'?response([callItem('write',{path:'bad',content:'bad'})]):response([textItem('summary')],mode==='incomplete'?'incomplete':'completed');}});
 expect(['failed','cancelled']).toContain(result.status);const events=(await readSession(f.session)).events;expect(events.some(e=>e.type==='compaction.completed'||e.type==='tool.intent')).toBe(false);if(mode==='disabled')expect(calls).toBe(0);
 }finally{await f.host.close();}
},30000);
it('built-in empty /compact does not call a model',async()=>{const workspace=await temporary(),home=await temporary();const result=await run({workspace,home,session:join(workspace,'session'),apiKey:key,prompt:'/compact',fetch:async()=>{throw new Error('must not call');}});expect(result.status,result.error).toBe('completed');expect(result.text).toContain('暂无');});
it('selected built-in profile auto-compacts and sends the exact effective projection',async()=>{
 const workspace=await temporary(),home=await temporary(),session=join(workspace,'session');
 const profiles=new ProviderProfiles(home);await profiles.saveCredential('fixture',key);await profiles.save({id:'builtin',providerId:'deepseek',resourceId:'builtin:deepseek',model:'deepseek-flash',baseUrl:'https://fixture.invalid',paths:['/responses'],credentialRef:'fixture'},0);await profiles.select('main','builtin',1);
 const journal=await Journal.open(session);for(let i=0;i<4;i++)await journal.append('context.add',{item:{role:'user',content:[{type:'input_text',text:'large '+i+'中'.repeat(230000)}]}});await journal.close();
 const requests:any[]=[];const result=await run({workspace,home,session,apiKey:key,prompt:'continue',tools:[],fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);return response([textItem(requests.length===1?'Preserve pending objectives.':'done')]);}});
 expect(result.status,result.error).toBe('completed');expect(requests).toHaveLength(2);expect(requests[0].max_output_tokens).toBe(8192);expect(requests[0].tools).toEqual([]);expect(requests[1].max_output_tokens).toBe(131072);expect(JSON.stringify(requests[1].input)).toContain('历史摘要');
 const events=(await readSession(result.session)).events,sent=events.filter(e=>e.type==='request.dispatched');for(let i=0;i<sent.length;i++)expect(JSON.parse((await readArtifact(result.session,(sent[i]!.payload as any).body)).toString())).toEqual(requests[i]);
 expect(events.filter(e=>e.type==='compaction.completed')).toHaveLength(1);
},30000);
