import {expect,it,vi} from 'vitest';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectSession} from '../src/server/inspection.js';
import {startWeb} from '../src/server/app.js';
import {Journal,hash} from '../src/journal.js';
import {CustomizationHost} from '../src/customization/host.js';
import type {InspectionView} from '../src/shared/inspection.js';
import {temporary,key,response,textItem,callItem} from './helpers.js';
it('keeps parent failure and child success separate, scopes attempts, and counts each usage owner once',async()=>{
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false});
  try{
    const session=await app.sessions.create('inspection'),directory=join(app.sessions.root,session.id),journal=await Journal.open(directory);
    await journal.append('run.started',{}, {runId:'run'});
    await journal.append('tool.requested',{name:'codemode',args:{}},{runId:'run',toolCallId:'script'});
    await journal.append('tool.requested',{name:'write',args:{}},{runId:'run',toolCallId:'write',parentToolCallId:'script'});
    await journal.append('tool.completed',{name:'write',args:{}},{runId:'run',toolCallId:'write',parentToolCallId:'script'});
    const links={runId:'run',toolCallId:'script',parentToolCallId:'script',modelCallId:'classifier',attemptId:'a1'};
    await journal.append('attempt.started',{purpose:'classifier',operation:'classifier',provider:'fixture',model:'physical' },links);
    const body='{"model":"physical","input":"source"}',artifact=await journal.artifact(body);
    await journal.append('request.dispatched',{body:artifact,bodyHash:hash(body)},links);
    await journal.append('attempt.finished',{outcome:'failed',usage:{input:7,output:2,cost:null},elapsedMs:20},links);
    await journal.append('attempt.retry',{reason:'HTTP 429'},links);
    await journal.append('attempt.started',{purpose:'classifier',model:'physical'},{...links,attemptId:'a2'});
    await journal.append('attempt.finished',{outcome:'completed',usage:{input:5,output:1,cost:null}},{...links,attemptId:'a2'});
    await journal.append('tool.result',{name:'codemode',details:{usage:{input:12,output:3}}},{runId:'run',toolCallId:'script'});
    await journal.append('codemode.finished',{status:'failed'},{runId:'run',toolCallId:'script'});
    await journal.append('tool.intent',{name:'remote',args:{}},{runId:'run',toolCallId:'remote',parentToolCallId:'script'});
    await journal.append('tool.requested',{name:'cancelled-script',args:{}},{runId:'run',toolCallId:'cancelled-script'});
    await journal.append('codemode.finished',{status:'cancelled'},{runId:'run',toolCallId:'cancelled-script'});
    await journal.append('tool.failed',{error:'cancelled'},{runId:'run',toolCallId:'cancelled-script'});
    await journal.append('run.finished',{status:'failed'},{runId:'run'});await journal.close();
    const before=await readFile(join(directory,'journal.jsonl')),acquire=vi.spyOn(CustomizationHost.prototype,'acquire');
    const get=async(query='')=>fetch(app.origin+`/api/v1/sessions/${session.id}/inspection?${query}`,{headers:{authorization:`Bearer ${app.token}`}});
    inspectSession(await app.sessions.entry(session.id),session.id,{offset:0,attemptOffset:0,eventOffset:0});
    const root=await(await get()).json() as InspectionView;
    expect(root.nodes,JSON.stringify(root)).toMatchObject([{id:'tool:script',status:'failed',children:3},{id:'tool:cancelled-script',status:'cancelled'}]);expect(root.usage).toMatchObject({attempts:2,input:12,output:3,missingInput:0,missingOutput:0,missingCache:2,cost:null,unknownCostAttempts:2});
    const children=await(await get('parent=tool:script')).json() as InspectionView;
    expect(children.nodes.map(node=>[node.id,node.status])).toEqual([['tool:write','completed'],['model:classifier','completed'],['tool:remote','unknown']]);
    const detail=await(await get('node=model:classifier&attempt=a1')).json() as InspectionView;
    expect(detail.detail!.attempts.map(item=>item.status)).toEqual(['failed','completed']);expect(detail.detail!.events.every(event=>event.attemptId==='a1')).toBe(true);expect(detail.detail!.events.find(event=>event.type==='request.dispatched')?.artifacts[0]?.sha256).toBe(hash(body));
    expect((await get('node=model:classifier&attempt=foreign')).status).toBe(404);expect((await get('run=foreign')).status).toBe(404);expect((await get('group=invalid')).status).toBe(400);
    const requests=await(await get('node=model:classifier&attempt=a1&group=request')).json() as InspectionView;expect(requests.detail!.events.map(event=>event.type)).toEqual(['attempt.started','request.dispatched']);expect(acquire).not.toHaveBeenCalled();expect(await readFile(join(directory,'journal.jsonl'))).toEqual(before);
  }finally{vi.restoreAllMocks();await app.close();}
});
it('bounds tree and event pages, preserves malformed parent diagnostics and never presents unverified cost as zero',async()=>{
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false});
  try{
    const session=await app.sessions.create('bounded'),journal=await Journal.open(join(app.sessions.root,session.id));
    for(let n=0;n<45;n++)await journal.append('tool.requested',{name:`tool-${n}`,args:{}},{runId:'run',toolCallId:`tool-${n}`});
    await journal.append('attempt.started',{operation:'image'},{runId:'run',modelCallId:'image',attemptId:'image-attempt',parentToolCallId:'absent'});
    for(let n=0;n<45;n++)await journal.append('response.headers',{index:n},{runId:'run',modelCallId:'image',attemptId:'image-attempt'});
    await journal.append('attempt.finished',{outcome:'cancelled',usage:{input:null,output:null,cost:0}},{runId:'run',modelCallId:'image',attemptId:'image-attempt'});await journal.close();
    const get=async(query='')=>(await fetch(app.origin+`/api/v1/sessions/${session.id}/inspection?${query}`,{headers:{authorization:`Bearer ${app.token}`}})).json() as Promise<InspectionView>;
    const first=await get(),next=await get('offset=40');expect(first.nodes).toHaveLength(40);expect(next.nodes).toHaveLength(6);expect(next.nodes.at(-1)).toMatchObject({id:'model:image',parentMissing:true,status:'cancelled'});
    expect(first.usage).toMatchObject({input:0,missingInput:1,cost:null,unknownCostAttempts:1});
    const detail=await get('node=model:image');expect(detail.detail!.events).toHaveLength(40);expect(detail.detail!.nextEvent).toBe(40);const later=await get('node=model:image&eventOffset=40');expect(later.detail!.events).toHaveLength(7);
  }finally{await app.close();}
});

it('indexes actual Codemode failure without rolling back successful child evidence',async()=>{
  let calls=0;const workspace=await temporary(),app=await startWeb({workspace,home:await temporary(),apiKey:key,naming:false,runtime:{fetch:async()=>response(++calls===1?[callItem('codemode',{code:'await tools.write({path:"evidence.txt",content:"kept"}); throw Error("parent failed");'})]:[textItem('finished')])}});
  try{
    const session=await app.sessions.create('real script');await app.sessions.submit(session.id,{version:1,commandId:'real-script',prompt:'run fixture'});await app.sessions.activeFor(session.id)?.done;
    expect(await readFile(join(workspace,'evidence.txt'),'utf8')).toBe('kept');
    const entry=await app.sessions.entry(session.id),options={offset:0,attemptOffset:0,eventOffset:0};
    const root=inspectSession(entry,session.id,options),flat=[...root.nodes];
    for(let n=0;n<flat.length;n++)if(flat[n]!.children)flat.push(...inspectSession(entry,session.id,{...options,run:root.runId,parent:flat[n]!.id}).nodes);
    expect(flat.find(node=>node.label==='codemode')).toMatchObject({status:'failed'});expect(flat.find(node=>node.label==='write')).toMatchObject({status:'completed'});expect(root.usage.attempts).toBe(2);
  }finally{await app.close();}
});
it('serves only integrity-checked saved raster images and diagnoses missing or unsupported attachments',async()=>{
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false});
  try{
    const session=await app.sessions.create('images'),other=await app.sessions.create('other'),directory=join(app.sessions.root,session.id),journal=await Journal.open(directory);
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=','base64'),artifact=await journal.artifact(bytes),svg=await journal.artifact('<svg onload="alert(1)"/>');
    await journal.append('model.operation.result',{operation:'image',attachments:[{index:0,mimeType:'image/png',artifact},{index:1,mimeType:'image/svg+xml',artifact:svg}]},{runId:'images',modelCallId:'image'});await journal.close();
    const get=(id:string,digest:string)=>fetch(app.origin+`/api/v1/sessions/${id}/inspection-image/${digest}`,{headers:{authorization:`Bearer ${app.token}`}});
    const result=await get(session.id,artifact.sha256);expect(result.status).toBe(200);expect(result.headers.get('content-type')).toBe('image/png');expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
    expect((await get(other.id,artifact.sha256)).status).toBe(404);expect((await get(session.id,svg.sha256)).status).toBe(415);await rm(join(directory,'artifacts',artifact.sha256));expect((await get(session.id,artifact.sha256)).status).toBe(422);
    const missing=await fetch(app.origin+`/api/v1/sessions/${session.id}/artifacts/${artifact.sha256}`,{headers:{authorization:`Bearer ${app.token}`}});expect(missing.status).toBe(404);expect(await missing.json()).toMatchObject({error:{code:'artifact_missing'}});
  }finally{await app.close();}
});
