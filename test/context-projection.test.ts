import { expect, it } from 'vitest';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { assemblePrompt, contextView, type ToolDefinition } from '../src/context.js';
import { measureContext, envelopeKey } from '../src/context-meter.js';
import { contextMeasurementIdentity } from '../src/context-meta.js';
import { Journal, hash, readArtifact, readSession } from '../src/journal.js';
import { recordedTool } from '../src/customization/execution.js';
import { CoreTools } from '../src/tools.js';
import { run } from '../src/runtime.js';
import { temporary, key, response, textItem, callItem } from './helpers.js';
const model={id:'fixture',provider:'fixture',contextWindow:20000,maxTokens:2000};
const definition:ToolDefinition={source:'fixture:tool',snippet:'Tool summary',guidance:['Tool guidance'],tool:{name:'fixture',label:'fixture',description:'fixture',parameters:Type.Object({x:Type.String()}),execute:async()=>({content:[],details:{}})}};
async function journalFixture(){const journal=await Journal.open(join(await temporary(),'session'));await journal.append('context.add',{source:'runtime:environment:v1',item:{role:'user',content:'Environment data'}});await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:'Task input'},{type:'input_image',image_url:'data:image/png;base64,AAEC'}]}});return journal;}
it('reports additive input layers, excluded guidance and separate reservations without inventing an unknown capacity',async()=>{
 const journal=await journalFixture();try{
 const prompt=assemblePrompt([definition],[{source:'fixture:user-rule',section:'rules',scope:'user',text:'user rule'},{source:'fixture:project-rule',section:'rules',scope:'.',text:'project rule'},{source:'fixture:directory-rule',section:'rules',scope:'src',text:'directory rule'},{source:'fixture:skill',section:'skills',text:'skill body'},{source:'fixture:catalog',section:'resources',text:'catalog summary'},{source:'fixture:excluded',text:'excluded body',requiresTools:['unavailable']}],'work');
 const measured=measureContext(contextView(journal.events,prompt),model,journal.events);
 expect(measured.layers!.reduce((sum,layer)=>sum+layer.tokens,0)).toBe(measured.totalTokens);expect(measured.totalTokens).toBe(measured.systemTokens+measured.toolsTokens+measured.messageTokens);
 expect(measured.layers!.map(layer=>layer.id)).toEqual(expect.arrayContaining(['policy','tools','guidance','user-rules','project-rules','directory-rules','skills','resources','schemas','environment','history','images']));
 expect(measured.layers!.find(layer=>layer.id==='images')!.estimatedTokens).toBe(2048);
 expect(measured.exclusions).toContainEqual(expect.objectContaining({source:'fixture:excluded',hash:hash('excluded body'),reason:'tool-dependency-unavailable'}));
 expect(measured.reservations).toMatchObject({output:2000,safety:1024,toolResults:400,availableInput:16576,capacity:'known'});
 const unknown=measureContext(contextView(journal.events,prompt),{...model,contextWindow:0},journal.events);
 expect(unknown.contextWindow).toBeUndefined();expect(unknown.reservations).toEqual({output:2000,capacity:'unknown'});expect(unknown).not.toHaveProperty('percentage');
 }finally{await journal.close();}
});
it('invalidates calibration for model, schema, image encoding, mode, target and output changes while preserving additive corrected layers',async()=>{
 const journal=await journalFixture();try{
 const prompt=assemblePrompt([definition],[],'work'),view=contextView(journal.events,prompt),base=measureContext(view,model,journal.events);
 await journal.append('context.usage',{key:envelopeKey(view,model),input:base.totalTokens+1000,heuristic:base.totalTokens,attemptId:'main',purpose:'work'});
 const calibrated=measureContext(view,model,journal.events);expect(calibrated.method).toBe('calibrated');expect(calibrated.layers!.reduce((sum,layer)=>sum+layer.tokens,0)).toBe(base.totalTokens+1000);
 for(const changed of [{...model,id:'other'},{...model,provider:'other'},{...model,maxTokens:3000},{...model,contextIdentity:'different-protocol'}, {...model,contextWindow:30000}])expect(measureContext(view,changed,journal.events).method).toBe('estimated');
 expect(measureContext(contextView(journal.events,assemblePrompt([{...definition,tool:{...definition.tool,description:'changed'}}],[],'work')),model,journal.events).method).toBe('estimated');
 expect(measureContext(contextView(journal.events,assemblePrompt([definition],[],'create')),model,journal.events).method).toBe('estimated');
 const changed=structuredClone(journal.events);(changed.at(-2)!.payload as any).item.content[1].image_url='data:image/png;base64,AQID';
 expect(measureContext(contextView(changed,prompt),model,changed).method).toBe('estimated');
 const identity=contextMeasurementIdentity(view,journal.events);expect(measureContext(view,model,journal.events,{...identity,targetId:'different-target'}).method).toBe('estimated');
 }finally{await journal.close();}
});
it('ignores auxiliary usage even when its key is forged to match the main frame or purpose is only on its attempt',async()=>{
 const journal=await journalFixture();try{
 const view=contextView(journal.events,assemblePrompt([])),base=measureContext(view,model,journal.events);
 for(const purpose of ['compaction','session-title','extension','handoff'])await journal.append('context.usage',{key:envelopeKey(view,model),purpose,input:1000000,heuristic:base.totalTokens,attemptId:purpose});
 await journal.append('attempt.started',{purpose:'compaction'},{attemptId:'legacy-aux'});
 await journal.append('context.usage',{key:envelopeKey(view,model),input:1000000,heuristic:base.totalTokens,attemptId:'legacy-aux'});
 expect(measureContext(view,model,journal.events)).toMatchObject({totalTokens:base.totalTokens,method:'estimated',anchor:undefined});
 }finally{await journal.close();}
});
it('keeps full Unicode/control-character results and records a bounded encoded projection with a reliable continuation',async()=>{
 const journal=await Journal.open(join(await temporary(),'session'));
 const original={content:[{type:'text' as const,text:'猫😀\n\\"\u0000'.repeat(12000)}],details:{nextOffset:80000,path:'large.txt'}};
 try{
 const tool=recordedTool({name:'large',label:'large',description:'large',parameters:Type.Object({}),execute:async()=>original},journal,{}),result=await tool.execute('large',{});
 expect(Buffer.byteLength(JSON.stringify(result.content))).toBeLessThanOrEqual(24000);expect(JSON.stringify(result.content)).not.toContain('\ufffd');
 const completed=journal.events.find(e=>e.type==='tool.completed')!,projection=journal.events.find(e=>e.type==='tool.projection')!,meta=projection.payload as any;
 expect(meta.full).toEqual((completed.payload as any).artifact);expect(JSON.parse((await readArtifact(journal.directory,meta.full)).toString())).toEqual(original);
 expect(JSON.parse((await readArtifact(journal.directory,meta.projected)).toString())).toEqual(result);expect(meta.omittedTextBytes).toBeGreaterThan(0);
 expect(result.details).not.toHaveProperty('nextOffset');expect(result.details).toMatchObject({resume:{path:'artifact:'+meta.full.sha256,offset:0}});
 const core=await CoreTools.create(await temporary(),journal,{}),read=core.definitions().find(d=>d.tool.name==='read')!.tool;
 const first=await read.execute('resume',{path:'artifact:'+meta.full.sha256,limit:1024});expect(first.content[0]).toHaveProperty('text',expect.stringContaining('bytes 0-'));
 }finally{await journal.close();}
});
it('preserves selected images and lets an omitted image be read from its full result by original index',async()=>{
 const workspace=await temporary(),journal=await Journal.open(join(workspace,'session'));
 const images=Array.from({length:5},(_,index)=>({type:'image' as const,mimeType:'image/png',data:Buffer.from('fixture image '+index).toString('base64')}));
 try{
 const tool=recordedTool({name:'images',label:'images',description:'images',parameters:Type.Object({}),execute:async()=>({content:images,details:{}})},journal,{}),result=await tool.execute('images',{});
 expect(result.content.filter(c=>c.type==='image')).toEqual(images.slice(0,4));
 const meta=journal.events.find(e=>e.type==='tool.projection')!.payload as any;expect(meta.omittedImages).toBe(1);
 const core=await CoreTools.create(workspace,journal,{}),read=core.definitions().find(d=>d.tool.name==='read')!.tool;
 expect((await read.execute('image-read',{path:'artifact:'+meta.full.sha256,imageIndex:4})).content).toEqual([images[4]]);
 await expect(read.execute('bad-index',{path:'artifact:'+meta.full.sha256,imageIndex:99})).rejects.toThrow('unavailable');
 await writeFile(join(workspace,'normal.txt'),'normal');await expect(read.execute('bad-path',{path:'normal.txt',imageIndex:0})).rejects.toThrow('requires a saved');
 }finally{await journal.close();}
});
it('links the actual next request and layered measurement to the complete and projected tool artifacts',async()=>{
 const workspace=await temporary(),home=await temporary(),session=join(workspace,'session');await writeFile(join(workspace,'large.txt'),'MODEL_DATA_猫\n'.repeat(8000));let calls=0;const bodies:any[]=[];
 const result=await run({workspace,home,session,apiKey:key,prompt:'read large result',tools:['read'],toolOptions:{outputBytes:200000},fetch:async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return response(++calls===1?[callItem('read',{path:'large.txt',limit:150000})]:[textItem()]);}});
 expect(result.status,result.error).toBe('completed');expect(calls).toBe(2);
 const events=(await readSession(result.session)).events,projection=events.find(e=>e.type==='tool.projection')!,last=events.findLast(e=>e.type==='context.snapshot')!;
 const snapshot=JSON.parse((await readArtifact(result.session,(last.payload as any).artifact)).toString()),meta=projection.payload as any;
 const selected=snapshot.selection.find((selection:any)=>selection.projection);expect(selected.projection).toMatchObject({eventId:projection.eventId,full:meta.full,projected:meta.projected,version:2});
 expect(selected.sources).toEqual(['artifact:'+meta.full.sha256,'artifact:'+meta.projected.sha256]);expect(JSON.stringify(bodies[1])).toContain(meta.full.sha256);
 expect(snapshot.measurement).toMatchObject({mode:'work',targetId:snapshot.target.id,purpose:'work',capabilityRevision:snapshot.capabilityRevision});expect(snapshot.measurement.layers.some((layer:any)=>layer.id==='tool-results')).toBe(true);
 expect(snapshot.measurement.reservations.toolResults).toBeGreaterThan(0);
 const requests=events.filter(e=>e.type==='request.dispatched');for(let index=0;index<requests.length;index++)expect(JSON.parse((await readArtifact(result.session,(requests[index]!.payload as any).body)).toString())).toEqual(bodies[index]);
});
