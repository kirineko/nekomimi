import {openJournalStorage} from '../src/pi/journal-storage.js';
import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';
import {expect,it} from 'vitest';
import {join,resolve,dirname} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {run} from '../src/runtime.js';
import {Journal,readSession,readArtifact,id} from '../src/journal.js';
import {createSessionBinding,creationHash,sessionBinding} from '../src/session/identity.js';
import {CustomizationHost} from '../src/customization/host.js';
import {ProviderProfiles} from '../src/customization/provider-profiles.js';
import {Candidates} from '../src/customization/candidates.js';
import {temporary,key,response,textItem,callItem} from './helpers.js';
async function fixture(protocol='responses'){
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/providers');await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'providers',sdkVersion:3,entry:'index.ts',requiredCapabilities:['providers']}));
 await writeFile(join(root,'index.ts'),(await readFile(resolve('extension-docs/http-providers.ts'),'utf8')).replace('contextWindow: 128000','contextWindow: 20000').replace('maxOutputTokens: 4096','maxOutputTokens: 2000'));
 const host=new CustomizationHost(workspace,home),resource=(await host.catalog.discover()).find(r=>r.kind==='extension')!;
 await host.catalog.decide(resource.id,true,true,0);const profiles=new ProviderProfiles(home);
 await profiles.save({id:'test',providerId:protocol==='responses'?'example-responses':'example-chat',resourceId:resource.id,model:'fixture-model',baseUrl:'https://fixture.invalid',paths:[protocol==='responses'?'/responses':'/chat/completions']},0);await profiles.select('main','test',1);
 const session=join(workspace,'session');return {workspace,home,root,host,session,profiles};
}
async function seededStorage(session:string){
 const creation={commandId:'context-fixture',mode:'work' as const};
 let binding;try{binding=sessionBinding((await readSession(session)).events);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 binding??=await createSessionBinding(dirname(session),id(),creation,creationHash('context fixture',creation));
 const storage=await openJournalStorage(session,BACKGROUND_CONTEXT,{}, {workspace:binding.ownerWorkspace,binding});
 if(!storage.journal.events.some(e=>e.type==='session.created'))await storage.journal.append('session.created',{workspace:binding.target.root,binding});
 return storage;
}
async function seed(session:string,groups=8){const storage=await seededStorage(session),j=storage.journal;try{for(let i=0;i<groups;i++){await j.append('context.add',{source:'fixture',item:{role:'user',content:[{type:'input_text',text:'History '+i+' 中'.repeat(1500)}]}});await j.append('context.add',{source:'fixture',item:{role:'assistant',content:[{type:'output_text',text:'done'}]}});}}finally{await storage.storage.close(BACKGROUND_CONTEXT);}}
it('captures matched task and model before and after explicit compaction',async()=>{
 const f=await fixture(),report:any={version:1,measurement:'offline synthetic Provider; token estimates only',task:'continue; preserve the recorded constraints',model:'fixture-model',variants:{}};
 try{
  for(const variant of ['before','after']){
   const session=join(f.workspace,variant),bodies:any[]=[];
   await seed(session,4);
   const options={...f,session,customization:f.host,apiKey:key,tools:['read'],autoCompact:false,
    fetch:async(_url:any,init:any)=>{const body=JSON.parse(String(init.body));bodies.push(body);return response([textItem(JSON.stringify(body).includes('Conversation data:')?'Historical goals and constraints remain pending.':'done')]);}};
   if(variant==='after'){
    const compacted=await run({...options,prompt:'/compact'});expect(compacted.status,compacted.error).toBe('completed');
    expect((await readSession(session)).events.some(e=>e.type==='compaction.completed')).toBe(true);
   }
   const result=await run({...options,prompt:report.task});expect(result.status,result.error).toBe('completed');
   const observed=await readSession(result.session),snapshots=observed.events.filter(e=>e.type==='context.snapshot');
   const snapshot=JSON.parse((await readArtifact(result.session,(snapshots.at(-1)!.payload as any).artifact)).toString());
   const dispatched=observed.events.filter(e=>e.type==='request.dispatched'),body=JSON.parse((await readArtifact(result.session,(dispatched.at(-1)!.payload as any).body)).toString());
   expect(body).toEqual(bodies.at(-1));expect(snapshot.purpose).toBe('work');
   report.variants[variant]={body,bodyArtifact:(dispatched.at(-1)!.payload as any).body,model:snapshot.model,
    measurement:snapshot.measurement,selection:snapshot.selection,retainedNodes:snapshot.view.nodes,
    originalHistoryNodes:observed.events.filter(e=>e.type==='context.add'&&(e.payload as any).source==='fixture').length,
    auxiliaryRequests:dispatched.length-1};
  }
  const {before,after}=report.variants;
  expect(before.model).toEqual(after.model);expect(before.body.tools).toEqual(after.body.tools);
  expect(before.originalHistoryNodes).toBe(8);expect(after.originalHistoryNodes).toBe(8);
  expect(after.measurement.messageTokens).toBeLessThan(before.measurement.messageTokens);
  expect(after.selection.some((s:any)=>s.decision==='exclude')).toBe(true);
  if(process.env.CONTEXT_REPORT_DIRECTORY){await mkdir(process.env.CONTEXT_REPORT_DIRECTORY,{recursive:true});await writeFile(join(process.env.CONTEXT_REPORT_DIRECTORY,'wire-comparison.json'),JSON.stringify(report,null,2)+'\n');}
 }finally{await f.host.close();}
},30000);
for(const protocol of ['responses','chat-completions'])it(`auto + manual ${protocol} share projection, shrink wire input and retain raw evidence`,async()=>{
 const f=await fixture(protocol),requests:any[]=[];
 const fetcher:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);const summary=JSON.stringify(body).includes('Conversation data:');return protocol==='responses'?response([textItem(summary?'Short summary with pending objectives.':'done')]):Response.json({choices:[{message:{role:'assistant',content:summary?'Short summary':'done'},finish_reason:'stop'}]});};
 const opts={...f,customization:f.host,apiKey:key,fetch:fetcher,tools:[]};
 try{
  await seed(f.session);const result=await run({...opts,prompt:'continue'});expect(result.status,result.error).toBe('completed');expect(requests.length).toBeGreaterThan(1);
  const summaryRequests=requests.filter(r=>JSON.stringify(r).includes('Conversation data:'));expect(summaryRequests.length).toBeGreaterThan(0);expect(summaryRequests.every(r=>r.tools.length===0)).toBe(true);
  expect(JSON.stringify(requests.at(-1))).toContain('Runtime environment data');expect(JSON.stringify(requests.at(-1))).toContain('历史摘要');expect(JSON.stringify(requests.at(-1)).length).toBeLessThan(20000);
  let events=(await readSession(f.session)).events;expect(events.some(e=>e.type==='compaction.completed')).toBe(true);
  expect(events.filter(e=>e.type==='context.add').some(e=>JSON.stringify(e.payload).includes('History 0'))).toBe(true);
  const sent=events.filter(e=>e.type==='request.dispatched');for(let i=0;i<sent.length;i++)expect(JSON.parse((await readArtifact(result.session,(sent[i]!.payload as any).body)).toString())).toEqual(requests[i]);
  await seed(f.session,4);const count=requests.length;const manual=await run({...opts,prompt:'/compact preserve paths'});expect(manual.status,manual.error).toBe('completed');expect(manual.text).toContain('已整理');expect(requests.slice(count).every(r=>JSON.stringify(r).includes('Conversation data:'))).toBe(true);
  events=(await readSession(f.session)).events;expect(events.filter(e=>e.type==='context.add').some(e=>JSON.stringify(e.payload).includes('/compact'))).toBe(false);
  expect(events.filter(e=>e.type==='attempt.started').some(e=>(e.payload as any).purpose==='compaction')).toBe(true);
 }finally{await f.host.close();}
},30000);

for(const change of ['none','profile','permission','lifecycle'] as const)it(change==='none'?'commits create stages as sourced data and retains them in the next real request':`rejects a late create ${change} change and preserves its response evidence`,async()=>{
 const f=await fixture(),ownerWorkspace=await temporary();
 const binding=await createSessionBinding(ownerWorkspace,id(),{commandId:'create-summary',mode:'create',target:{kind:'extension',root:f.workspace}},creationHash('create',{commandId:'create-summary',mode:'create',target:{kind:'extension',root:f.workspace}}),f.home);
 const mapped=await openJournalStorage(f.session,BACKGROUND_CONTEXT,{}, {workspace:ownerWorkspace,binding}),j=mapped.journal;
 await j.append('session.created',{workspace:binding.target.root,ownerWorkspace:binding.ownerWorkspace,binding});
 for(let i=0;i<7;i++)await j.append('context.add',{item:{role:'user',content:'create task '+i+' 中'.repeat(1300)}});
 await mapped.storage.close(BACKGROUND_CONTEXT);
 const candidates=new Candidates(f.workspace),draft=await candidates.scaffold('summary-draft'),resource=await candidates.read(draft.id);
 await f.host.lifecycle.record(resource,'created',{sessionId:binding.sessionId});
 await f.host.lifecycle.record(resource,'preview',{sessionId:binding.sessionId,passed:true});
 let calls=0;const bodies:any[]=[];
 try{
  const result=await run({...f,ownerWorkspace,mode:'create',target:{kind:'extension',root:f.workspace},customization:f.host,apiKey:key,prompt:'/compact',tools:[],fetch:async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));bodies.push(body);
   expect(JSON.stringify(body)).toContain(draft.id);expect(JSON.stringify(body)).toContain('preview');
   if(change==='profile'){const p=await f.profiles.list();await f.profiles.save({...p.entries.test!,model:'changed-model'},p.revision);}
   if(change==='permission'){const provider=(await f.host.catalog.discover()).find(r=>r.kind==='extension'&&r.name==='providers')!;const decision=await f.host.catalog.decisions();await f.host.catalog.decide(provider.id,false,false,decision.revision);}
   if(change==='lifecycle')await f.host.lifecycle.record(resource,'simulation',{sessionId:binding.sessionId,passed:false});
   return response([textItem('Preview complete; application pending.')]);
  }});
  expect(result.status,result.error).toBe(change==='none'?'completed':'failed');expect(calls).toBe(1);
  const events=(await readSession(f.session)).events;expect(events.some(e=>e.type==='tool.intent')).toBe(false);
  expect(events.filter(e=>e.type==='compaction.completed')).toHaveLength(change==='none'?1:0);
  expect(events.filter(e=>e.type==='compaction.failed')).toHaveLength(change==='none'?0:1);
  const dispatched=events.filter(e=>e.type==='request.dispatched');expect(dispatched).toHaveLength(1);
  expect(JSON.parse((await readArtifact(result.session,(dispatched[0]!.payload as any).body)).toString())).toEqual(bodies[0]);
  expect(events.some(e=>e.type==='attempt.finished'&&(e.payload as any).status===(change==='permission'?'failed':'completed'))).toBe(true);
  if(change==='permission')expect(events.some(e=>e.type==='response.chunk')).toBe(true);
  expect(events.some(e=>e.type==='context.add'&&JSON.stringify(e.payload).includes('create task 0'))).toBe(true);
  if(change==='none'){
   const checkpoint=events.find(e=>e.type==='compaction.completed')!.payload as any;
   expect(checkpoint.source).toMatchObject({mode:'create',target:binding.target});
   expect(checkpoint.retention.development.abilities).toContainEqual(expect.objectContaining({candidateId:draft.id,phase:'authorization'}));
   expect(checkpoint.retention.development.evidence).toContainEqual(expect.objectContaining({data:expect.objectContaining({stage:'preview',passed:true})}));
   let next=0;const resumed=await run({...f,ownerWorkspace,mode:'create',target:{kind:'extension',root:f.workspace},customization:f.host,apiKey:key,prompt:'continue',tools:[],autoCompact:false,fetch:async(_url,init)=>{
    next++;const body=JSON.parse(String(init?.body));expect(JSON.stringify(body)).toContain(draft.id);expect(JSON.stringify(body)).toContain('模型摘要不得覆盖');
    expect(body.tools).toEqual([]);return response([textItem('Application remains pending.')]);
   }});
   expect(resumed.status,resumed.error).toBe('completed');expect(next).toBe(1);
   expect((await readSession(resumed.session)).events.filter(e=>e.type==='compaction.completed')).toHaveLength(1);
  }
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
 const storage=await seededStorage(session),journal=storage.journal;for(let i=0;i<4;i++)await journal.append('context.add',{item:{role:'user',content:[{type:'input_text',text:'large '+i+'中'.repeat(230000)}]}});await storage.storage.close(BACKGROUND_CONTEXT);
 const requests:any[]=[];const result=await run({workspace,home,session,apiKey:key,prompt:'continue',tools:[],fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);return response([textItem(requests.length===1?'Preserve pending objectives.':'done')]);}});
 expect(result.status,result.error).toBe('completed');expect(requests).toHaveLength(2);expect(requests[0].max_output_tokens).toBe(8192);expect(requests[0].tools).toEqual([]);expect(requests[1].max_output_tokens).toBe(131072);expect(JSON.stringify(requests[1].input)).toContain('历史摘要');
 const events=(await readSession(result.session)).events,sent=events.filter(e=>e.type==='request.dispatched');for(let i=0;i<sent.length;i++)expect(JSON.parse((await readArtifact(result.session,(sent[i]!.payload as any).body)).toString())).toEqual(requests[i]);
 expect(events.filter(e=>e.type==='compaction.completed')).toHaveLength(1);
},30000);
