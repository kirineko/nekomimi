import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Agent,AgentHarness,MemorySessionRepo,BACKGROUND_CONTEXT} from '@earendil-works/pi-agent-core';
import {fauxProvider,fauxAssistantMessage,fauxToolCall,createModels} from '@earendil-works/pi-ai';
import {stream} from '@earendil-works/pi-ai/api/openai-responses';
import {deepseekProvider} from '@earendil-works/pi-ai/providers/deepseek';
const results=[];
async function test(name,fn){try{const detail=await fn();results.push({name,status:'passed',detail});}catch(e){results.push({name,status:'failed',error:e.stack});}console.log(JSON.stringify(results.at(-1)));}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const tool=(exec)=>({name:'echo',label:'echo',description:'Echo',parameters:{type:'object',properties:{value:{type:'string'}},required:['value']},execute:exec});
await test('published-imports',async()=>{const tui=await import('@earendil-works/pi-tui');assert.equal(typeof tui.TuiMainScreen,'function');assert.equal(typeof AgentHarness.create,'function');return {Agent:true,AgentHarness:true,TuiMainScreen:true,TUIIsTypeOnly:true,node:process.version};});
await test('low-loop-awaits-journal-and-context',async()=>{
 const p=fauxProvider({tokensPerSecond:100000});p.setResponses([fauxAssistantMessage(fauxToolCall('echo',{value:'x'}),{stopReason:'toolUse'}),fauxAssistantMessage('done')]);
 let gated=false,executed=0,transformed=0;const order=[];
 const a=new Agent({initialState:{model:p.getModel(),tools:[tool(async()=>{assert.equal(gated,true);order.push('execute');executed++;return {content:[{type:'text',text:'x'}],details:{}};})]},streamFn:p.provider.streamSimple,transformContext:async m=>{transformed++;return m;},beforeToolCall:async()=>{order.push('before');}});
 a.subscribe(async e=>{if(e.type==='tool_execution_start'){order.push('journal-start');await delay(15);gated=true;order.push('journal-done');}});
 await a.prompt('test');assert.equal(executed,1);assert.equal(transformed,2);assert(order.indexOf('journal-done')<order.indexOf('execute'));return {order,modelCalls:p.state.callCount,transformed};
});
await test('low-loop-journal-failure-stops-tool',async()=>{
 const p=fauxProvider({tokensPerSecond:100000});p.setResponses([fauxAssistantMessage(fauxToolCall('echo',{value:'x'}),{stopReason:'toolUse'})]);let executions=0;
 const a=new Agent({initialState:{model:p.getModel(),tools:[tool(async()=>{executions++;return{content:[],details:{}};})]},streamFn:p.provider.streamSimple});
 a.subscribe(async e=>{if(e.type==='tool_execution_start')throw new Error('synthetic disk failure');});
 try{await a.prompt('test');}catch{}assert.equal(executions,0);return{executions,error:a.state.errorMessage};
});
await test('low-loop-explicit-restored-history',async()=>{
 const p=fauxProvider({tokensPerSecond:100000});let seen;p.setResponses([(ctx)=>{seen=structuredClone(ctx.messages);return fauxAssistantMessage('resumed');}]);
 const messages=[{role:'user',content:'old',timestamp:1},fauxAssistantMessage('old answer')];
 const a=new Agent({initialState:{model:p.getModel(),messages},streamFn:p.provider.streamSimple});await a.prompt('new');assert.equal(seen.length,3);return{inputMessages:seen.length};
});
await test('high-harness-public-session-and-provider',async()=>{
 const repo=new MemorySessionRepo();const session=await repo.create({},BACKGROUND_CONTEXT);const p=fauxProvider({tokensPerSecond:100000});p.setResponses([fauxAssistantMessage('ok')]);const models=createModels();models.setProvider(p.provider);
 const {harness}=await AgentHarness.create({session,models,model:p.getModel(),activeToolNames:[],compaction:{enabled:false,reserveTokens:1024,keepRecentTokens:2048}},BACKGROUND_CONTEXT);
 const errors=[];harness.events.on('handler_error',e=>errors.push(e));harness.events.on('message_start',()=>{throw new Error('synthetic journal failure');});
 const lane=await harness.lane('main',BACKGROUND_CONTEXT);const result=await lane.prompt('hi',undefined,BACKGROUND_CONTEXT);const entries=await session.findEntries(undefined,BACKGROUND_CONTEXT);
 assert(p.state.callCount===1);assert(entries.length>0);assert(errors.length>0);
 await harness.close(BACKGROUND_CONTEXT);await repo.close(BACKGROUND_CONTEXT);
 return{providerCalls:p.state.callCount,entries:entries.length,eventFailuresIsolated:errors.length,result};
});
const cost={input:0,output:0,cacheRead:0,cacheWrite:0};
const model={id:'deepseek-flash',name:'DeepSeek',provider:'deepseek',api:'openai-responses',baseUrl:'https://api.deepseek.com',reasoning:true,input:['text','image'],cost,contextWindow:100000,maxTokens:4096};
async function parse(events,opts={}){let sent;const raw=events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');const fetch=async(url,init)=>{sent=JSON.parse(init.body);return new Response(raw,{status:200,headers:{'content-type':'text/event-stream'}});};const s=stream(model,{systemPrompt:'test',messages:[{role:'user',content:'test',timestamp:1}]},{apiKey:'synthetic-placeholder',maxRetries:0,fetch,...opts});const ev=[];for await(const e of s)ev.push(e.type);return{message:await s.result(),sent,ev,raw};}
await test('responses-real-fixture-reasoning-and-unknown',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./live-text.json',import.meta.url)));const unknown={type:'response.future_probe',probe:{keep:true}};const parsed=await parse([unknown,...fixture.events],{onPayload:p=>({...p,instructions:'modified-final'})});
 assert.equal(parsed.sent.instructions,'modified-final');assert(parsed.message.content.some(x=>x.type==='thinking'&&JSON.parse(x.thinkingSignature).type==='reasoning'));assert(!parsed.ev.includes(unknown.type));
 return{reason:parsed.message.stopReason,thinkingPreserved:true,unknownRawCaptured:true,unknownExposedByPi:false,sentRole:parsed.sent.input?.[0]?.role};
});
await test('responses-disconnect-detected',async()=>{const f=JSON.parse(await readFile(new URL('./live-text.json',import.meta.url)));const r=await parse(f.events.filter(e=>e.type!=='response.completed'));assert.equal(r.message.stopReason,'error');return {reason:r.message.stopReason,error:r.message.errorMessage};});
await test('responses-failed-detected',async()=>{const r=await parse([{type:'response.failed',response:{status:'failed',error:{code:'probe',message:'synthetic failure'}}}]);assert.equal(r.message.stopReason,'error');return{error:r.message.errorMessage};});
await test('responses-incomplete-detected',async()=>{const f=JSON.parse(await readFile(new URL('./live-incomplete.json',import.meta.url)));const r=await parse(f.events);assert.equal(r.message.stopReason,'length');return {reason:r.message.stopReason,raw:r.message.rawStopReason};});
await test('deepseek-provider-is-completions',async()=>{const p=deepseekProvider();const models=await p.getModels();const list=Array.isArray(models)?models:Object.values(models);return{apis:[...new Set(list.map(m=>m.api))]};});
await writeFile(new URL('./probe-results.json',import.meta.url),JSON.stringify(results,null,2));
if(results.some(r=>r.status==='failed'))process.exitCode=1;
