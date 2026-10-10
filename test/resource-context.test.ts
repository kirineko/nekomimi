import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CustomizationHost } from '../src/customization/host.js';
import { CustomRun } from '../src/customization/run.js';
import { assemblePrompt } from '../src/context.js';
import { captureRequestContext } from '../src/context-snapshot.js';
import { CONTEXT_POLICY, contextDirectory, requiredInstructionBudget } from '../src/context-policy.js';
import { Journal, hash, readArtifact, readSession } from '../src/journal.js';
import { run } from '../src/runtime.js';
import { temporary, key, response, textItem, callItem } from './helpers.js';
const model = { id: 'fixture', provider: 'fixture', protocol: 'responses', contextWindow: 128000, maxTokens: 1000 };
async function fixture() {
  const workspace = await temporary(), home = await temporary();
  await mkdir(join(workspace, '.agents/skills/review'), {recursive:true});
  await writeFile(join(workspace, '.agents/skills/review/SKILL.md'), '---\nname: review\ndescription: review\n---\nSKILL_BODY_ONLY_AFTER_READ');
  return { workspace, home };
}
it('paginates a large catalog with complete coverage, bounded UTF-8 descriptors, explicit omissions and pinned cursors', async () => {
  const f = await fixture(), host = new CustomizationHost(f.workspace, f.home), journal = await Journal.open(join(f.workspace, 'session'));
  try {
    const active = await host.acquire(), skill = active.resources.find(r=>r.kind==='skill')!;
    const longDescription='猫<> &"'.repeat(1000);
    active.resources.push(...Array.from({length:150}, (_,index)=>({...skill,id:`fixture:${String(index).padStart(3,'0')}`,name:`resource-${index}`,description:longDescription})));
    const custom = new CustomRun(host, active, journal, 'catalog', new AbortController().signal, {apiKey:key, mode:'create'});
    await custom.initialize([]);
    const prompt = assemblePrompt(custom.definitions, custom.instructions, 'create');
    expect(prompt.text).not.toContain('SKILL_BODY_ONLY_AFTER_READ'); expect(prompt.text).toContain('Use resource_list');
    const directory = custom.instructions.find(i=>i.source.startsWith('resources:'))!;
    const initial = JSON.parse(directory.text.split('\n')[1]!);
    expect(Buffer.byteLength(JSON.stringify(initial))).toBeLessThanOrEqual(CONTEXT_POLICY.directoryBytes);
    expect(initial.omitted).toBeGreaterThan(0);
    expect(Buffer.byteLength(prompt.fragments.find(fragment=>fragment.source===directory.source)!.text)).toBeLessThan(4500);
    const list = custom.definitions.find(d=>d.tool.name==='resource_list')!.tool;
    const ids:string[]=[];let offset:number|undefined=0;
    while(offset!==undefined){
      const result = await list.execute('catalog-page', {offset,revision:active.revision}, new AbortController().signal), page=result.details as any;
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
      const text=result.content.find(c=>c.type==='text')!;expect(text.type==='text'&&Buffer.byteLength(text.text)).toBeLessThanOrEqual(CONTEXT_POLICY.pageBytes);
      expect(page.items.length).toBeLessThanOrEqual(CONTEXT_POLICY.pageEntries);
      expect(page.omitted).toBe(page.total-page.offset-page.items.length);
      for(const item of page.items){ids.push(item.id); if(item.id.startsWith('fixture:')){
        expect(item.descriptionTruncated).toBe(true);expect(item.descriptionHash).toBe(hash(longDescription));
        expect(Buffer.byteLength(item.description)).toBeLessThanOrEqual(CONTEXT_POLICY.descriptionBytes);expect(item.description).not.toContain('\ufffd');
      }}
      offset=page.next;
    }
    expect(new Set(ids).size).toBe(active.resources.length);expect(ids.length).toBe(active.resources.length);
    await expect(list.execute('stale', {revision:'different'}, new AbortController().signal)).rejects.toThrow('revision');
    await expect(list.execute('invalid', {offset:active.resources.length+1}, new AbortController().signal)).rejects.toThrow('invalid');
    expect(contextDirectory([], 'empty')).toMatchObject({total:0,items:[],omitted:0,next:undefined});
  } finally {await journal.close();await host.release();await host.close();}
});
it('records discovery, read, effectiveness, actual instruction injection and retained history independently across real requests', async()=>{
  const f=await fixture(), session=join(f.workspace,'session');let count=0;const bodies:any[]=[];
  const fetcher:typeof fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));bodies.push(body);count++;
    if(count===1){const directory=JSON.parse(body.instructions.split('\n').find((line:string)=>line.startsWith('{"version":1,"revision":'))!);const skill=directory.items.find((r:any)=>r.kind==='skill');return response([callItem('resource_read',{id:skill.id})]);}
    return response([textItem()]);
  };
  const first=await run({...f,session,apiKey:key,prompt:'read skill',tools:['resource_read','resource_list'],fetch:fetcher});
  expect(first.status,first.error).toBe('completed');
  let events=(await readSession(first.session)).events;
  const snapshots=await Promise.all(events.filter(e=>e.type==='context.snapshot').map(async e=>JSON.parse((await readArtifact(first.session,(e.payload as any).artifact)).toString())));
  const before=snapshots[0].resources.find((r:any)=>r.kind==='skill'),after=snapshots[1].resources.find((r:any)=>r.id===before.id);
  expect(before).toMatchObject({discoverable:true,read:false,effective:true,injected:false,historical:false});
  expect(after).toMatchObject({discoverable:true,read:true,effective:true,injected:true,historical:false});
  expect(after.injections).toContainEqual(expect.objectContaining({via:'instruction',resourceRevision:before.revision}));
  expect(bodies[0].instructions).not.toContain('SKILL_BODY_ONLY_AFTER_READ');expect(bodies[1].instructions).toContain('SKILL_BODY_ONLY_AFTER_READ');
  const second=await run({...f,session:first.session,apiKey:key,prompt:'next task',tools:['resource_read','resource_list'],fetch:fetcher});expect(second.status,second.error).toBe('completed');
  events=(await readSession(second.session)).events;
  const last=events.findLast(e=>e.type==='context.snapshot')!, snapshot=JSON.parse((await readArtifact(second.session,(last.payload as any).artifact)).toString());
  expect(snapshot.resources.find((r:any)=>r.id===before.id)).toMatchObject({discoverable:true,read:true,effective:true,injected:false,historical:true});
  expect(bodies.at(-1).instructions).not.toContain('SKILL_BODY_ONLY_AFTER_READ');
  const journal=await Journal.open(second.session);
  try{
    const prior=events.findLast(e=>e.type==='resources.context')!.payload as any;
    await journal.append('resources.context',{...prior,items:prior.items.map((r:any)=>r.id===before.id?{...r,status:'disabled'}:r)},{runId:'inspection'});
    const inspected=captureRequestContext({events:journal.events,prompt:assemblePrompt([],[],'work'),model,runId:'inspection'});
    expect(inspected.resources.find(r=>r.id===before.id)).toMatchObject({discoverable:true,read:true,effective:false,injected:false,historical:true});
  }finally{await journal.close();}
});
it('indexes document data by Journal tool identity rather than confusing native and wire call IDs', async()=>{
  const f=await fixture(),host=new CustomizationHost(f.workspace,f.home),journal=await Journal.open(join(f.workspace,'session'));
  try{
    const active=await host.acquire(),custom=new CustomRun(host,active,journal,'documents',new AbortController().signal,{apiKey:key,mode:'create'});
    await custom.initialize([]);const document=active.resources.find(r=>r.kind==='doc'&&r.name==='README.md')!;
    const tool=custom.definitions.find(d=>d.tool.name==='resource_read')!.tool;
    const result=await tool.execute('native-document-call',{id:document.id},new AbortController().signal);
    await journal.append('tool.result',{source:'tool:resource_read',item:{type:'function_call_output',call_id:'wire-document-call',output:result.content.map(c=>c.type==='text'?{type:'input_text',text:c.text}:c)}},{runId:'documents',toolCallId:'native-document-call'});
    const snapshot=captureRequestContext({events:journal.events,prompt:assemblePrompt(custom.definitions,custom.instructions,'create'),model,runId:'documents',mode:'create'});
    const state=snapshot.resources.find(r=>r.id===document.id)!;
    expect(state).toMatchObject({discoverable:true,read:true,effective:true,injected:true,historical:false});
    expect(state.injections).toContainEqual(expect.objectContaining({via:'tool-result',resourceRevision:document.hash}));
    expect(state.injections.some(i=>i.via==='instruction')).toBe(false);
    const read=journal.events.find(e=>e.type==='resource.read')!;
    expect((await readArtifact(journal.directory,(read.payload as any).artifact)).toString()).toBe(document.text);
  }finally{await journal.close();await host.release();await host.close();}
});
it('attributes changed directory rules to their latest content and keeps prior revisions historical', async()=>{
  const f=await fixture(),host=new CustomizationHost(f.workspace,f.home),journal=await Journal.open(join(f.workspace,'session'));
  await mkdir(join(f.workspace,'nested'));const path=join(f.workspace,'nested/AGENTS.md');await writeFile(path,'NESTED_FIRST');
  try{
    const active=await host.acquire(),custom=new CustomRun(host,active,journal,'scoped',new AbortController().signal,{apiKey:key});await custom.initialize([]);
    await custom.checkRules('read',{path:'nested/file'});
    await writeFile(path,'NESTED_SECOND');await custom.checkRules('read',{path:'nested/file'});
    const snapshot=captureRequestContext({events:journal.events,prompt:assemblePrompt([],custom.instructions,'work'),model,runId:'scoped'});
    const rule=snapshot.resources.find(r=>r.kind==='rule')!;
    expect(rule).toMatchObject({read:true,effective:true,injected:true,historical:true,revision:hash('NESTED_SECOND')});
    expect(rule.injections).toHaveLength(1);expect(rule.injections[0]!.contentHash).toBe(hash('NESTED_SECOND'));
    expect(rule.reads.map(r=>r.hash)).toEqual([hash('NESTED_FIRST'),hash('NESTED_SECOND')]);
  }finally{await journal.close();await host.release();await host.close();}
});
it('rejects mandatory rules before any model or compaction call and preserves their full evidence', async()=>{
  const f=await fixture(), text='MANDATORY_FULL_RULE\n'+'r'.repeat(CONTEXT_POLICY.requiredBytes+1);
  await writeFile(join(f.workspace,'AGENTS.md'),text);let calls=0;
  const result=await run({...f,session:join(f.workspace,'session'),apiKey:key,prompt:'continue',fetch:async()=>{calls++;return response([textItem()]);}});
  expect(result.status).toBe('failed');expect(result.error).toContain('强制规则');expect(result.error).toContain('AGENTS.md');expect(calls).toBe(0);
  const events=(await readSession(result.session)).events, loaded=events.find(e=>e.type==='rule.loaded')!;
  expect((await readArtifact(result.session,(loaded.payload as any).artifact)).toString()).toBe(text);
  expect(events.some(e=>['compaction.started','attempt.started','request.dispatched'].includes(e.type))).toBe(false);
  const manual=await run({...f,session:result.session,apiKey:key,prompt:'/compact',fetch:async()=>{calls++;return response([textItem()]);}});
  expect(manual.status).toBe('failed');expect(manual.error).toContain('强制规则');expect(calls).toBe(0);
  expect((await readSession(manual.session)).events.some(e=>e.type==='compaction.started')).toBe(false);
  const prompt=assemblePrompt([], [{source:'fixture:required',section:'rules',text:'猫'.repeat(2000)}],'work');
  expect(()=>requiredInstructionBudget(prompt,{...model,contextWindow:3000,maxTokens:1000})).toThrow('fixture:required');
  expect(()=>captureRequestContext({events:[],prompt,model:{...model,contextWindow:3000,maxTokens:1000}})).toThrow('fixture:required');
});
