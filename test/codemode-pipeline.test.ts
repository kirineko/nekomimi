import {expect,it} from 'vitest';
import {Type} from 'typebox';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {Journal,readSession,readArtifact} from '../src/journal.js';
import {bindToolPolicy,recordedTool} from '../src/customization/execution.js';
import {codemodeDefinition} from '../src/codemode.js';
import {run} from '../src/runtime.js';
import {temporary,key,response,textItem,callItem} from './helpers.js';

it('lets scripts handle structured remote errors while retaining the failed child fact',async()=>{
 const journal=await Journal.open(await temporary());
 const tool=recordedTool({name:'remote',label:'remote',description:'remote',parameters:Type.Object({}),execute:async()=>({content:[{type:'text' as const,text:'remote rejected'}],details:{reason:'conflict'},isError:true})},journal,{});
 try{
  const result=await codemodeDefinition(journal,()=>[{tool,snippet:'',guidance:[]}],new AbortController().signal).tool.execute('parent',{code:'const r=await tools.remote({}); return {handled:r.isError,reason:r.details.reason};'});
  expect((result.details as any).result).toMatchObject({ok:true,value:{handled:true,reason:'conflict'}});
  expect(journal.events.filter(e=>e.type==='tool.failed')).toHaveLength(1);
  expect(journal.events.find(e=>e.type==='tool.execution_error')!.payload).toMatchObject({unknown:false});
 }finally{await journal.close();}
});

it('uses one recorded admission per child, captures schemas and preserves parent identity',async()=>{
 const journal=await Journal.open(await temporary());let effects=0,before=0,after=0;
 const tool=bindToolPolicy({name:'count',label:'Count',description:'Count once',parameters:Type.Object({value:Type.Number()}),execute:async()=>{effects++;return {content:[{type:'text',text:'done'}],details:{effects}};}},
  {revision:'fixed',before:async()=>{before++;return undefined;},after:async()=>{after++;}},journal,{runId:'run'});
 const definitions=[{tool,snippet:'',guidance:[]}],script=codemodeDefinition(journal,()=>definitions,new AbortController().signal);
 try{
  const result=await script.tool.execute('parent',{code:'text(ALL_TOOLS); return await tools.count({value:7});'});
  expect(JSON.stringify(result)).toContain('Input JSON Schema');expect({effects,before,after}).toEqual({effects:1,before:1,after:1});
  const intent=journal.events.find(e=>e.type==='tool.intent')!;
  expect(intent.parentToolCallId).toBe('parent');expect(intent.toolCallId).not.toBe('parent');expect(intent.payload).toMatchObject({args:{value:7},capabilityRevision:'fixed'});
  for(const type of ['tool.requested','tool.intent','tool.completed','tool.result'])expect(journal.events.filter(e=>e.type===type&&e.toolCallId===intent.toolCallId)).toHaveLength(1);
 }finally{await journal.close();}
});
it.each(['schema','revoked','intent'])('blocks %s failures before the child effect',async fault=>{
 const journal=await Journal.open(await temporary());let effects=0,allowed=true;
 const tool=bindToolPolicy({name:'effect',label:'Effect',description:'Effect',parameters:Type.Object({value:Type.Number()}),execute:async()=>{effects++;return {content:[],details:{}};}},
  {revision:'fixed',before:async()=>{if(!allowed)throw Error('revoked');return undefined;},after:async()=>{}},journal,{});
 const original=journal.append.bind(journal);
 if(fault==='intent')journal.append=async(type,...args)=>{if(type==='tool.intent')throw Error('intent persistence failed');return original(type,...args);};
 const script=codemodeDefinition(journal,()=>{if(fault==='revoked')allowed=false;return [{tool,snippet:'',guidance:[]}];},new AbortController().signal);
 try{
  const result=await script.tool.execute('parent',{code:`return await tools.effect({value:${fault==='schema'?'"invalid"':'7'}});`});
  expect((result.details as any).result.ok).toBe(false);expect(effects).toBe(0);expect(journal.events.some(e=>e.type==='tool.intent')).toBe(false);
 }finally{await journal.close();}
});
it('keeps a successful child when the enclosing script fails and excludes nested VMs',async()=>{
 const journal=await Journal.open(await temporary());let effects=0;
 const tool=recordedTool({name:'effect',label:'Effect',description:'Effect',parameters:Type.Object({}),execute:async()=>{effects++;return {content:[],details:{}};}},journal,{});
 const definitions:any[]=[{tool,snippet:'',guidance:[]}],script=codemodeDefinition(journal,()=>definitions,new AbortController().signal);definitions.push(script);
 try{
  const result=await script.tool.execute('parent',{code:'await tools.effect({}); if(ALL_TOOLS.some(t=>t.name==="codemode")) throw Error("nested VM exposed"); throw Error("after effect");'});
  expect((result.details as any).result).toMatchObject({ok:false,error:{message:'after effect'}});expect(effects).toBe(1);
  expect(journal.events.filter(e=>e.type==='tool.completed')).toHaveLength(1);
 }finally{await journal.close();}
});
it('runs real model-selected scripts through work filtering and records child reads',async()=>{
 const workspace=await temporary(),home=await temporary();await writeFile(join(workspace,'input.txt'),'SOURCE_CONTENT');let requests=0;
 const result=await run({workspace,home,session:join(workspace,'session'),apiKey:key,prompt:'read using script',tools:['codemode','read'],fetch:async()=>{
  requests++;return response(requests===1?[callItem('codemode',{code:'if(ALL_TOOLS.some(t=>t.name==="customization_candidate"))throw Error("create tool leaked"); const r=await tools.read({path:"input.txt"}); text(r);'})]:[textItem('done')]);
 }});
 expect(result.status,result.error).toBe('completed');expect(requests).toBe(2);
 const events=(await readSession(result.session)).events,intents=events.filter(e=>e.type==='tool.intent');
 expect(intents.map(e=>(e.payload as any).name).sort()).toEqual(['codemode','read']);
 expect(intents.find(e=>(e.payload as any).name==='read')!.parentToolCallId).toBe(intents.find(e=>(e.payload as any).name==='codemode')!.toolCallId);
 const finished=events.find(e=>e.type==='codemode.finished')!;
 expect((await readArtifact(result.session,(finished.payload as any).result)).toString()).toContain('SOURCE_CONTENT');
});
