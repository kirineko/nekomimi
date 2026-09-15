import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {Agent,createEditTool,BACKGROUND_CONTEXT} from '@earendil-works/pi-agent-core';
import {NodeExecutionEnv} from '@earendil-works/pi-agent-core/node';
import {fauxProvider} from '@earendil-works/pi-ai';
import {stream} from '@earendil-works/pi-ai/api/openai-responses';
const toolDir=await mkdtemp(join(tmpdir(),'harness-tools-probe-'));
const results=[];async function test(name,f){try{results.push({name,status:'passed',detail:await f()});}catch(e){results.push({name,status:'failed',error:e.stack});}console.log(JSON.stringify(results.at(-1)));}
const model={id:'deepseek-flash',name:'DeepSeek',provider:'deepseek',api:'openai-responses',baseUrl:'https://api.deepseek.com',reasoning:true,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:4096,compat:{supportsDeveloperRole:false}};
const context={systemPrompt:'authority',messages:[{role:'user',content:'probe',timestamp:1}]};
const fixture=JSON.parse(await readFile(new URL('./live-text.json',import.meta.url)));
const sse=fixture.events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');
await test('responses-compat-system-role',async()=>{let sent;const s=stream(model,context,{apiKey:'fake',maxRetries:0,fetch:async(u,i)=>{sent=JSON.parse(i.body);return new Response(sse,{headers:{'content-type':'text/event-stream'}});}});for await(const e of s){}assert.equal(sent.input[0].role,'system');return{role:sent.input[0].role};});
await test('responses-retry-disabled',async()=>{let calls=0;const s=stream(model,context,{apiKey:'fake',maxRetries:0,fetch:async()=>{calls++;return new Response('{"error":{"message":"rate limit"}}',{status:429,headers:{'content-type':'application/json'}});}});for await(const e of s){}assert.equal(calls,1);return{calls,reason:(await s.result()).stopReason};});
await test('responses-retry-two-attempts-visible-to-fetch',async()=>{let calls=0;const s=stream(model,context,{apiKey:'fake',maxRetries:1,fetch:async()=>{calls++;return calls===1?new Response('{"error":{"message":"rate limit"}}',{status:429,headers:{'content-type':'application/json','retry-after':'0'}}):new Response(sse,{headers:{'content-type':'text/event-stream'}});}});for await(const e of s){}assert.equal(calls,2);assert.equal((await s.result()).stopReason,'stop');return{calls};});
await test('responses-abort-propagates-to-transport',async()=>{let aborted=false;const ac=new AbortController();const s=stream(model,context,{apiKey:'fake',maxRetries:0,signal:ac.signal,fetch:async(u,i)=>new Promise((r,j)=>{i.signal.addEventListener('abort',()=>{aborted=true;j(new DOMException('Aborted','AbortError'));},{once:true});setTimeout(()=>ac.abort(),10);})});for await(const e of s){}assert(aborted);assert.equal((await s.result()).stopReason,'aborted');return{aborted};});
await test('published-edit-original-matching-and-diff',async()=>{
 const dir=toolDir;await mkdir(dir,{recursive:true});const path=dir+'/sample.txt';await writeFile(path,'\ufeffone\r\ntwo\r\n');const env=new NodeExecutionEnv({cwd:dir});const tool=createEditTool();const invocation={invocationId:'i',operationId:'o',turnId:'t',getMemo:async()=>undefined,setMemo:async()=>{}};
 const r=await tool.execute('t',{path:'sample.txt',edits:[{oldText:'one',newText:'two'},{oldText:'two',newText:'three'}]},()=>{},{env},invocation,BACKGROUND_CONTEXT);assert.equal(await readFile(path,'utf8'),'\ufefftwo\r\nthree\r\n');assert(r.details.diff&&r.details.patch);
 await writeFile(path,'repeat repeat');await assert.rejects(()=>tool.execute('t',{path:'sample.txt',edits:[{oldText:'repeat',newText:'x'}]},()=>{},{env},invocation,BACKGROUND_CONTEXT));assert.equal(await readFile(path,'utf8'),'repeat repeat');
 return{originalMatching:true,bomCrlfPreserved:true,ambiguousRejected:true,diffSeparate:true,readBeforeEditRequired:false};
});
await test('published-edit-fuzzy-fallback',async()=>{
 const dir=toolDir;const path=dir+'/fuzzy.txt';await writeFile(path,'const x = “hello”;\n');const env=new NodeExecutionEnv({cwd:dir});const tool=createEditTool();const r=await tool.execute('t',{path:'fuzzy.txt',edits:[{oldText:'const x = "hello";',newText:'const x = "bye";'}]},()=>{},{env},{invocationId:'i',operationId:'o',turnId:'t',getMemo:async()=>undefined,setMemo:async()=>{}},BACKGROUND_CONTEXT);
 assert((await readFile(path,'utf8')).includes('bye'));return{nonExactMatchAccepted:true,detailsKeys:Object.keys(r.details)};
});
await writeFile(new URL('./extra-results.json',import.meta.url),JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
