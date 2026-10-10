import {expect,it} from 'vitest';
import {join} from 'node:path';
import {run} from '../src/runtime.js';
import {Journal,readSession,readArtifact} from '../src/journal.js';
import {readScriptState} from '../src/codemode-state.js';
import {branchHistory} from '../src/customization/history-branch.js';
import {codemodeDefinition} from '../src/codemode.js';
import {recordedTool} from '../src/customization/execution.js';
import {Type} from 'typebox';
import {temporary,key,response,textItem,callItem} from './helpers.js';

it('rejects a concurrent stale state commit without merging it silently',async()=>{
 const journal=await Journal.open(await temporary());let ready=0,release:()=>void=()=>{};
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 const tool=recordedTool({name:'barrier',label:'barrier',description:'barrier',parameters:Type.Object({}),execute:async()=>{if(++ready===2)release();await barrier;return {content:[],details:{}};}},journal,{});
 const script=codemodeDefinition(journal,()=>[{tool,snippet:'',guidance:[]}],new AbortController().signal);
 try{
  const results=await Promise.all([1,2].map(value=>script.tool.execute(`script-${value}`,{code:`await tools.barrier({}); store("x",${value});`})));
  expect(results.filter(r=>(r as any).isError)).toHaveLength(1);
  const state=(await readScriptState(journal.directory,journal.events)).state;expect([1,2]).toContain(state.x);
  expect(journal.events.filter(e=>e.type==='codemode.finished'&&(e.payload as any).state)).toHaveLength(1);
  expect(journal.events.some(e=>e.type==='codemode.finished'&&String((e.payload as any).error).includes('concurrently'))).toBe(true);
 }finally{release();await journal.close();}
});

it('persists only successful script state across reopening and independent history branches',async()=>{
 const workspace=await temporary(),home=await temporary(),session=join(workspace,'source');let calls=0;
 const execute=async(code:string,target=session)=>{
  let request=0;
  const result=await run({workspace,home,session:target,apiKey:key,prompt:'run the script',tools:['codemode'],fetch:async()=>response(++request===1?[callItem('codemode',{code},`script_${++calls}`)]:[textItem('done')])});
  expect(result.status,result.error).toBe('completed');return result;
 };
 const first=await execute('store("x",3); return load("x");');
 const state=async(path:string)=>{const observed=await readSession(path);return (await readScriptState(observed.directory,observed.events)).state;};
 expect(await state(first.session)).toEqual({x:3});
 await execute('store("x",99); throw Error("failed after store");');expect(await state(first.session)).toEqual({x:3});
 const fork=await branchHistory(first.session,join(workspace,'branch'),workspace,true);
 expect(await state(fork.directory)).toEqual({x:3});
 await execute('store("x",load("x")+2);',fork.directory);
 expect(await state(fork.directory)).toEqual({x:5});expect(await state(first.session)).toEqual({x:3});
 await execute('return load("x")??null;',join(workspace,'independent'));expect(await state(join(workspace,'independent'))).toEqual({});
});
it('stores full large output and image bytes separately from bounded model projection',async()=>{
 const journal=await Journal.open(await temporary());
 try{
  const png='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
  const result=await codemodeDefinition(journal,()=>[],new AbortController().signal).tool.execute('script',{code:`text("猫😀".repeat(10000)); image("data:image/png;base64,${png}"); return 7;`});
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(25000);
  expect(JSON.stringify(result)).not.toContain('\ufffd');
  const finished=journal.events.find(e=>e.type==='codemode.finished')!.payload as any;
  const original=JSON.parse((await readArtifact(journal.directory,finished.result)).toString());
  expect(original.content[0].text).toBe('猫😀'.repeat(10000));expect(finished.images).toHaveLength(1);
  expect(await readArtifact(journal.directory,finished.images[0].artifact)).toEqual(Buffer.from(png,'base64'));
  expect(result.content).toContainEqual({type:'image',data:png,mimeType:'image/png'});
 }finally{await journal.close();}
});
it('does not commit state when cancellation arrives during artifact persistence',async()=>{
 const journal=await Journal.open(await temporary()),abort=new AbortController(),original=journal.artifact.bind(journal);
 journal.artifact=async(...args)=>{const result=await original(...args);abort.abort();return result;};
 try{
  await codemodeDefinition(journal,()=>[],abort.signal).tool.execute('script',{code:'store("x",1); return 1;'});
  expect((await readScriptState(journal.directory,journal.events)).state).toEqual({});
  expect(journal.events.find(e=>e.type==='codemode.finished')!.payload).toMatchObject({status:'cancelled'});
 }finally{await journal.close();}
});
