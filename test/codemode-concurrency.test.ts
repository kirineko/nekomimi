import {expect,it} from 'vitest';
import {Type} from 'typebox';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {Journal} from '../src/journal.js';
import {recordedTool} from '../src/customization/execution.js';
import {codemodeDefinition} from '../src/codemode.js';
import {CoreTools} from '../src/tools.js';
import {temporary,delay} from './helpers.js';

it('rejects calls beyond the fixed per-script budget',async()=>{
 const journal=await Journal.open(await temporary());let effects=0;
 const tool=recordedTool({name:'count',label:'count',description:'count',parameters:Type.Object({}),execute:async()=>{effects++;return {content:[],details:{}};}},journal,{});
 try{
  const result=await codemodeDefinition(journal,()=>[{tool,snippet:'',guidance:[]}],new AbortController().signal).tool.execute('parent',{code:'const r=await Promise.allSettled(Array.from({length:129},()=>tools.count({}))); return {errors:r.filter(x=>x.status==="rejected").map(x=>x.reason.message)};'});
  expect((result.details as any).result).toMatchObject({ok:true,value:{errors:['Script child call limit exceeded']}});expect(effects).toBe(128);
  expect(journal.events.filter(e=>e.type==='tool.intent')).toHaveLength(128);
 }finally{await journal.close();}
// Allow the existing 30s sandbox deadline and cleanup to report their own outcome.
},40000);

it('allows concurrent reads within global and resource budgets',async()=>{
 const journal=await Journal.open(await temporary());let active=0,peak=0;
 let release!:()=>void;const firstWave=new Promise<void>(resolve=>{release=resolve;});
 const per=new Map<string,number>(),peaks=new Map<string,number>();
 const definitions=['a','b','c'].map(name=>({source:name,snippet:'',guidance:[],tool:recordedTool({name,label:name,description:name,parameters:Type.Object({}),execute:async()=>{
  active++;peak=Math.max(peak,active);per.set(name,(per.get(name)??0)+1);peaks.set(name,Math.max(peaks.get(name)??0,per.get(name)!));
  if(active===4)release();await firstWave;active--;per.set(name,per.get(name)!-1);return {content:[],details:{}};
 }},journal,{})}));
 try{
  const result=await codemodeDefinition(journal,()=>definitions,new AbortController().signal).tool.execute('parent',{code:'return await Promise.all(Array.from({length:12},(_,i)=>tools[["a","b","c"][i%3]]({})));'});
  expect((result.details as any).result.ok).toBe(true);expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(4);
  expect([...peaks.values()].every(n=>n<=2)).toBe(true);expect(journal.events.filter(e=>e.type==='tool.completed')).toHaveLength(12);
 }finally{await journal.close();}
});
it('serializes competing file writes against the version each caller observed',async()=>{
 const workspace=await temporary(),journal=await Journal.open(join(workspace,'session'));await writeFile(join(workspace,'file'),'original');
 const tools=await CoreTools.create(workspace,journal,{}),definitions=tools.definitions();
 try{
  await definitions.find(d=>d.tool.name==='read')!.tool.execute('read',{path:'file'});
  const result=await codemodeDefinition(journal,()=>definitions,new AbortController().signal).tool.execute('parent',{code:'return await Promise.allSettled([tools.write({path:"file",content:"first"}),tools.write({path:"file",content:"second"})]);'});
  const values=(result.details as any).result.value;expect(values.map((v:any)=>v.status).sort()).toEqual(['fulfilled','rejected']);
  expect(['first','second']).toContain(await readFile(join(workspace,'file'),'utf8'));
  expect(journal.events.filter(e=>e.type==='file.change_prepared')).toHaveLength(1);
  await definitions.find(d=>d.tool.name==='read')!.tool.execute('reread',{path:'file'});
  await definitions.find(d=>d.tool.name==='write')!.tool.execute('fresh',{path:'file',content:'fresh'});
  expect(await readFile(join(workspace,'file'),'utf8')).toBe('fresh');
 }finally{await journal.close();}
});
it('cancels queued work without starting more executors',async()=>{
 const journal=await Journal.open(await temporary()),abort=new AbortController();let effects=0,cancelled=0;
 const tool=recordedTool({name:'slow',label:'slow',description:'slow',parameters:Type.Object({}),execute:async(_id,_args,signal)=>{
  effects++;await new Promise<void>((resolve)=>signal!.addEventListener('abort',()=>{cancelled++;resolve();},{once:true}));throw Error('UNKNOWN after cancellation');
 }},journal,{});
 try{
  const running=codemodeDefinition(journal,()=>[{source:'server',tool,snippet:'',guidance:[]}],abort.signal).tool.execute('parent',{code:'return await Promise.all(Array.from({length:20},()=>tools.slow({})));'});
  while(effects<2)await delay(5);abort.abort();
  const result=await running;expect((result.details as any).result).toMatchObject({ok:false,error:{kind:'aborted'}});
  expect(effects).toBe(2);expect(cancelled).toBe(2);expect(journal.events.filter(e=>e.type==='tool.intent')).toHaveLength(2);
 }finally{abort.abort();await journal.close();}
});
it('records unknown for an unawaited uncooperative child and never repeats it',async()=>{
 const journal=await Journal.open(await temporary());let effects=0,cancelled=false,finish:()=>void=()=>{};
 const slow=recordedTool({name:'slow',label:'slow',description:'slow',parameters:Type.Object({}),execute:async(_id,_args,signal)=>{
  effects++;signal!.addEventListener('abort',()=>{cancelled=true;},{once:true});await new Promise<void>(resolve=>{finish=resolve;});return {content:[],details:{}};
 }},journal,{});
 const barrier=recordedTool({name:'barrier',label:'barrier',description:'barrier',parameters:Type.Object({}),execute:async()=>{while(!effects)await delay(2);return {content:[],details:{}};}},journal,{});
 try{
  const result=await codemodeDefinition(journal,()=>[slow,barrier].map(tool=>({tool,snippet:'',guidance:[]})),new AbortController().signal).tool.execute('parent',{code:'void tools.slow({}); await tools.barrier({}); return "finished";'});
  expect(effects).toBe(1);expect(cancelled).toBe(true);expect((result.details as any).unsettled).toMatchObject([{state:'unknown'}]);
  expect(journal.events.some(e=>e.type==='tool.execution_error'&&(e.payload as any).unknown)).toBe(true);
  finish();while(!journal.events.some(e=>e.type==='tool.result'&&(e.payload as any).name==='slow'))await delay(5);
  expect(effects).toBe(1);
 }finally{finish();await journal.close();}
},5000);
