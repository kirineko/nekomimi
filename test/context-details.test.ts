import {expect,it,vi} from 'vitest';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {startWeb} from '../src/server/app.js';
import {CustomizationHost} from '../src/customization/host.js';
import {id,Journal,readSession} from '../src/journal.js';
import {temporary,key,response,textItem} from './helpers.js';
import type {ContextDetailsView} from '../src/shared/context-details.js';
it.each(['work','create'] as const)('%s serves current measurement and pinned selection pages without models, factories or history writes',async(mode)=>{
  let calls=0;const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,runtime:{fetch:async()=>{calls++;return response([textItem('done')]);}}});
  try{
    const source=await app.sessions.create('context-details',{commandId:id(),mode,...(mode==='create'?{target:{kind:'extension' as const,scope:'project' as const,root:await temporary()}}:{})}),other=await app.sessions.create('unrelated');
    const journal=await Journal.open(join(app.sessions.root,source.id));
    for(let n=0;n<65;n++)await journal.append('context.add',{source:`fixture:${n}`,item:{role:'user',content:[{type:'input_text',text:`Message ${n}`}]}});
    await journal.close();
    await app.sessions.submit(source.id,{version:1,commandId:id(),prompt:'inspect'});await app.sessions.activeFor(source.id)?.done;
    const acquire=vi.spyOn(CustomizationHost.prototype,'acquire'),initialCalls=calls;
    const directory=join(app.sessions.root,source.id),before=await readFile(join(directory,'journal.jsonl'));
    const request=async(sessionId:string,query='')=>fetch(app.origin+`/api/v1/sessions/${sessionId}/context-details${query}`,{headers:{authorization:`Bearer ${app.token}`}});
    const first=await(await request(source.id)).json() as ContextDetailsView;
    expect(first.mode).toBe(mode);expect(first.targetId).toBe(source.binding!.target.id);expect(first.measurement?.totalTokens).toBeGreaterThan(0);expect(first.snapshot?.selection).toHaveLength(40);expect(first.snapshot?.next).toBe(40);
    const second=await(await request(source.id,`?snapshot=${first.snapshot!.eventId}&offset=40`)).json() as ContextDetailsView;
    expect(second.snapshot?.revision).toBe(first.snapshot?.revision);expect(second.snapshot?.selection.some(item=>first.snapshot!.selection.some(prior=>prior.id===item.id))).toBe(false);
    const empty=await(await request(other.id)).json() as ContextDetailsView;expect(empty.measurement).toBeUndefined();expect(empty.snapshot).toBeUndefined();
    expect((await request(other.id,`?snapshot=${first.snapshot!.eventId}`)).status).toBe(404);
    expect((await request(source.id,'?decision=bogus')).status).toBe(400);
    const settings=await app.sessions.config.describe();await app.sessions.config.save('settings',{...settings,model:'unknown-capacity'});
    const changed=await(await request(source.id)).json() as ContextDetailsView;expect(changed.measurement?.contextWindow).toBeUndefined();expect(changed.measurement?.model).toBe('unknown-capacity');expect(changed.snapshot?.model.id).not.toBe('unknown-capacity');
    expect(calls).toBe(initialCalls);expect(acquire).not.toHaveBeenCalled();expect(await readFile(join(directory,'journal.jsonl'))).toEqual(before);
    await rm(join(directory,'artifacts',first.snapshot!.artifact.sha256));expect((await request(source.id)).status).toBe(422);
  }finally{vi.restoreAllMocks();await app.close();}
});
it('bounds compaction summaries and references and pages by immutable event sequence',async()=>{
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false});
  try{
    const source=await app.sessions.create('compaction evidence'),directory=join(app.sessions.root,source.id),journal=await Journal.open(directory);
    for(let n=0;n<22;n++)await journal.append('compaction.failed',{operation:`op-${n}`,error:'fixture failure'},{runId:`run-${n}`});
    const summary='s'.repeat(13000),artifact=await journal.artifact(summary);
    await journal.append('compaction.completed',{operation:'completed',sourceRevision:'source',before:9000,after:4000,summary,artifact,references:Array.from({length:55},(_,n)=>({eventId:`event-${n}`,itemIndex:0,hash:'0'.repeat(64)})),attemptIds:['summary-attempt']});await journal.close();
    const headers={authorization:`Bearer ${app.token}`},url=app.origin+`/api/v1/sessions/${source.id}/context-details`;
    const first=await(await fetch(url,{headers})).json() as ContextDetailsView;
    expect(first.compactions).toHaveLength(20);expect(first.compactions[0]).toMatchObject({status:'completed',summaryTruncated:true,referenceCount:55,attemptIds:['summary-attempt']});expect(first.compactions[0]!.summary).toHaveLength(12000);expect(first.compactions[0]!.references).toHaveLength(40);
    const refs=await(await fetch(url+'?checkpoint='+first.compactions[0]!.eventId+'&referenceOffset=40',{headers})).json() as ContextDetailsView;expect(refs.compactions[0]!.references).toHaveLength(15);expect(refs.compactions[0]!.references[0]!.eventId).toBe('event-40');expect(refs.compactions[0]!.nextReference).toBeUndefined();
    expect((await fetch(url+'?checkpoint=unrelated',{headers})).status).toBe(404);
    const next=await(await fetch(url+'?compactionBefore='+first.nextCompactionBefore,{headers})).json() as ContextDetailsView;
    expect(next.compactions).toHaveLength(3);expect(next.compactions.every(item=>item.seq<first.nextCompactionBefore!)).toBe(true);
    expect((await readSession(directory)).events.filter(event=>event.type==='compaction.completed')).toHaveLength(1);expect(first.compacting).toBe(false);
  }finally{vi.restoreAllMocks();await app.close();}
});
