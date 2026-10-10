import { expect, it } from 'vitest';
import { mkdir, writeFile, readFile, rm, rename, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/runtime.js';
import { Journal, hash, readSession, readArtifact } from '../src/journal.js';
import { CustomizationHost } from '../src/customization/host.js';
import { CustomRun } from '../src/customization/run.js';
import { prepareToolCall } from '../src/customization/execution.js';
import { assemblePrompt } from '../src/context.js';
import { captureRequestContext } from '../src/context-snapshot.js';
import { temporary, key, response, textItem, callItem } from './helpers.js';
async function fixture() {
  const workspace=await realpath(await temporary()),home=await temporary(),path=join(workspace,'.agents/skills/review/SKILL.md');
  await mkdir(join(workspace,'.agents/skills/review'),{recursive:true});
  const original='---\nname: review\ndescription: review\n---\nPINNED_SKILL_BODY';await writeFile(path,original);
  await writeFile(join(workspace,'file.txt'),'ordinary file');const host=new CustomizationHost(workspace,home),active=await host.acquire();
  const skill=active.resources.find(resource=>resource.kind==='skill')!;await host.release();
  return {workspace,home,path,original,host,skill,session:join(workspace,'session')};
}
async function disable(f:Awaited<ReturnType<typeof fixture>>) {await f.host.catalog.decide(f.skill.id,false,false,(await f.host.catalog.decisions()).revision);}
it('withdraws a disabled skill from the next real request while retaining immutable earlier bodies and read evidence',async()=>{
  const f=await fixture(),bodies:any[]=[];let count=0;
  try{
    const result=await run({...f,customization:f.host,apiKey:key,prompt:'review',tools:['resource_read','read'],fetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));bodies.push(body);count++;
      if(count===1)return response([callItem('resource_read',{id:f.skill.id})]);
      if(count===2){await writeFile(f.path,f.original.replace('PINNED_SKILL_BODY','LATE_SKILL_BODY'));await disable(f);return response([callItem('read',{path:'file.txt'},'next-file')]);}
      return response([textItem()]);
    }});
    expect(result.status,result.error).toBe('completed');expect(count).toBe(3);expect(bodies[1].instructions).toContain('PINNED_SKILL_BODY');
    expect(bodies[2].instructions).not.toContain('PINNED_SKILL_BODY');expect(bodies[2].instructions).not.toContain('LATE_SKILL_BODY');
    const events=(await readSession(result.session)).events,snapshots=await Promise.all(events.filter(e=>e.type==='context.snapshot').map(async e=>JSON.parse((await readArtifact(result.session,(e.payload as any).artifact)).toString())));
    expect(snapshots[2].selection).toContainEqual(expect.objectContaining({source:`${f.skill.id}:${hash(f.original)}`,decision:'exclude',reason:'resource-disabled'}));
    expect(snapshots[2].resources.find((r:any)=>r.id===f.skill.id)).toMatchObject({read:true,effective:false,injected:false,historical:true,status:'disabled'});
    const dispatched=events.filter(e=>e.type==='request.dispatched');for(let index=0;index<dispatched.length;index++)expect(JSON.parse((await readArtifact(result.session,(dispatched[index]!.payload as any).body)).toString())).toEqual(bodies[index]);
    expect((await readArtifact(result.session,(events.find(e=>e.type==='skill.loaded')!.payload as any).artifact)).toString()).toBe(f.original);
  }finally{await f.host.close();}
});
it.each(['content','permission','permission-after-intent'])('keeps captured body fixed through a late %s change and blocks only revoked dispatch',async kind=>{
  const f=await fixture();let calls=0,changed=false,revisionToBlock:string|undefined;const bodies:any[]=[];
  try{
    const result=await run({...f,customization:f.host,apiKey:key,prompt:'read',tools:['resource_read'],beforeDispatch:async prepared=>{
      if(prepared?.snapshot.view.prompt.text.includes('PINNED_SKILL_BODY'))revisionToBlock=prepared.reference.revision;
      if(kind!=='permission-after-intent'&&!changed&&prepared?.snapshot.view.prompt.text.includes('PINNED_SKILL_BODY')){
        changed=true;if(kind==='content')await writeFile(f.path,f.original.replace('PINNED_SKILL_BODY','LATE_SKILL_BODY'));else await disable(f);
      }
    },journalOptions:{beforeIO:async point=>{
      if(kind!=='permission-after-intent'||changed||point!=='watermark.rename'||calls!==1)return;
      const text=await readFile(join(f.session,'journal.jsonl'),'utf8'),last=text.trim().split('\n').at(-1);
      if(last){const event=JSON.parse(last);if(event.type==='request.dispatched'&&revisionToBlock&&event.payload.contextSnapshot?.revision===revisionToBlock){changed=true;await disable(f);}}
    }},fetch:async(_url,init)=>{calls++;bodies.push(JSON.parse(String(init?.body)));return response(calls===1?[callItem('resource_read',{id:f.skill.id})]:[textItem()]);}});
    expect(changed).toBe(true);expect(result.status).toBe(kind==='content'?'completed':'failed');expect(calls).toBe(kind==='content'?2:1);
    const events=(await readSession(result.session)).events,selected=events.filter(e=>e.type==='context.snapshot').at(-1)!;
    const snapshot=JSON.parse((await readArtifact(result.session,(selected.payload as any).artifact)).toString());
    expect(snapshot.view.prompt.text).toContain('PINNED_SKILL_BODY');expect(snapshot.view.prompt.text).not.toContain('LATE_SKILL_BODY');
    if(kind!=='content'){expect(events.some(e=>e.type==='request.blocked')).toBe(true);expect(events.filter(e=>e.type==='request.dispatched')).toHaveLength(kind==='permission'?1:2);expect(events.filter(e=>e.type==='response.headers')).toHaveLength(1);}
    else expect(bodies[1].instructions).toBe(snapshot.view.prompt.text);
  }finally{await f.host.close();}
});
async function extensionFixture() {
  const f=await fixture(),root=join(f.workspace,'.nekomimi/extensions/count');await mkdir(root,{recursive:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({name:'count',sdkVersion:3,entry:'index.ts',requiredCapabilities:['tools']}));
  await writeFile(join(root,'index.ts'),`import {writeFileSync} from 'node:fs';export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerTool({name:'effect',description:'Fixture effect',parameters:{type:'object',properties:{}},async execute(){writeFileSync('effect.txt','once');return {content:[{type:'text',text:'done'}]};}});}`);
  const resource=(await f.host.catalog.discover()).find(r=>r.kind==='extension')!;
  await f.host.catalog.decide(resource.id,true,true,(await f.host.catalog.decisions()).revision);await f.host.reload(await f.host.requestReload());
  return {...f,resource};
}
it('rechecks a prepared tool before intent after revocation, without rerunning hooks or executing its worker',async()=>{
  const f=await extensionFixture(),journal=await Journal.open(f.session);
  try{
    const active=await f.host.acquire(),custom=new CustomRun(f.host,active,journal,'prepared',new AbortController().signal,{apiKey:key});await custom.initialize([]);
    const tool=custom.definitions.find(d=>d.tool.name==='ext_count_effect')!.tool,prepared=await prepareToolCall(tool,'prepared-call',{},new AbortController().signal);
    await f.host.catalog.decide(f.resource.id,false,false,(await f.host.catalog.decisions()).revision);
    await expect(prepared.execute()).rejects.toThrow('revoked');await expect(readFile(join(f.workspace,'effect.txt'))).rejects.toThrow();
    expect(journal.events.some(e=>e.type==='tool.intent')).toBe(false);expect(journal.events.find(e=>e.type==='tool.blocked')?.payload).toMatchObject({phase:'before-intent'});
  }finally{await journal.close();await f.host.release();await f.host.close();}
});
it('rechecks after reliable tool intent and records a known blocked result with zero effects',async()=>{
  const f=await extensionFixture();let revoked=false,calls=0;
  try{
    const result=await run({...f,customization:f.host,apiKey:key,prompt:'execute',tools:['ext_count_effect'],journalOptions:{beforeIO:async point=>{
      if(revoked||point!=='watermark.rename')return;
      const text=await readFile(join(f.session,'journal.jsonl'),'utf8').catch(()=>''),last=text.trim().split('\n').at(-1);
      if(last&&JSON.parse(last).type==='tool.intent'){revoked=true;await f.host.catalog.decide(f.resource.id,false,false,(await f.host.catalog.decisions()).revision);}
    }},fetch:async()=>response(++calls===1?[callItem('ext_count_effect',{})]:[textItem('Operation was blocked')])});
    expect(revoked).toBe(true);await expect(readFile(join(f.workspace,'effect.txt'))).rejects.toThrow();
    const events=(await readSession(result.session)).events;expect(events.filter(e=>e.type==='tool.intent')).toHaveLength(1);
    expect(events.find(e=>e.type==='tool.blocked')?.payload).toMatchObject({phase:'before-execute'});
    expect(events.find(e=>e.type==='tool.execution_error')?.payload).toMatchObject({unknown:false,effect:'not-dispatched'});
    expect(events.some(e=>e.type==='tool.completed')).toBe(false);
  }finally{await f.host.close();}
});
it.each(['delete','escape'])('withdraws loaded skills after source scope becomes %s and leaves prior read artifacts intact',async kind=>{
  const f=await fixture(),journal=await Journal.open(f.session);
  try{
    const active=await f.host.acquire(),custom=new CustomRun(f.host,active,journal,'scope',new AbortController().signal,{apiKey:key});await custom.initialize([]);await custom.load(f.skill.id);
    const prompt=assemblePrompt(custom.definitions,custom.instructions,'work'),captured=captureRequestContext({events:journal.events,prompt,model:{provider:'fixture',id:'fixture',protocol:'responses',contextWindow:128000,maxTokens:1000},runId:'scope'});
    if(kind==='delete')await rm(f.path);else {const outside=await temporary();await writeFile(join(outside,'SKILL.md'),f.original);await rm(f.path);await symlink(join(outside,'SKILL.md'),f.path);}
    if(kind==='escape')await expect(custom.validateRequest({snapshot:captured,reference:{eventId:'fixture',revision:captured.revision,artifact:{kind:'artifact',sha256:'a'.repeat(64),bytes:0}}})).rejects.toThrow();
    if(kind==='escape')await expect(custom.refreshContext()).rejects.toThrow('scope revoked');else await custom.refreshContext();
    expect(assemblePrompt(custom.effectiveDefinitions(),custom.instructions,'work').text).not.toContain('PINNED_SKILL_BODY');
    expect(captured.view.prompt.text).toContain('PINNED_SKILL_BODY');expect(journal.events.some(e=>e.type==='instruction.withdrawn')).toBe(true);
    const loaded=journal.events.find(e=>e.type==='skill.loaded')!;expect((await readArtifact(journal.directory,(loaded.payload as any).artifact)).toString()).toBe(f.original);
  }finally{await journal.close();await f.host.release();await f.host.close();}
});
