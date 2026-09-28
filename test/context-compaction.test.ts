import {expect,it} from 'vitest';
import {join} from 'node:path';
import {Journal,readSession,hash} from '../src/journal.js';
import {assemblePrompt,contextView,unpairedCalls} from '../src/context.js';
import {compactContext,planCompaction} from '../src/compaction.js';
import {estimateTokens,measureContext,envelopeKey,inputBudget} from '../src/context-meter.js';
import {exportSession,importBundle} from '../src/export.js';
import {ConfigStore} from '../src/config/store.js';
import {temporary} from './helpers.js';
const model={id:'fixture',provider:'test',contextWindow:20000,maxTokens:2000};
const prompt=assemblePrompt([]);
async function history(){const journal=await Journal.open(await temporary());await journal.append('session.created',{});for(let i=0;i<5;i++){await journal.append('context.add',{item:{role:'user',content:'task '+i+' 中'.repeat(1000)}});await journal.append('context.add',{items:[{type:'reasoning',id:'r'+i,content:[]},{role:'assistant',content:'answer '+i+' x'.repeat(1000)}]});}return journal;}
const options=(journal:Journal)=>({journal,prompt,model,protocol:'responses',runId:'run',signal:new AbortController().signal,manual:true,notify:()=>{},summarize:async()=> 'Retain objectives and pending work.'});
it('measures mixed content deterministically, image bytes bounded, unknown capacities and isolated usage',async()=>{
 const journal=await history();try{
 const view=contextView(journal.events,prompt),base=measureContext(view,model);
 expect(base.method).toBe('estimated');expect(base.totalTokens).toBe(base.systemTokens+base.toolsTokens+base.messageTokens);
 expect(estimateTokens('你好')).toBe(2);expect(estimateTokens('abcdef')).toBe(2);
 expect(estimateTokens({type:'input_image',image_url:'data:image/png;base64,'+'a'.repeat(100000)})).toBe(2048);
 expect(measureContext(view,{...model,contextWindow:0}).contextWindow).toBeUndefined();
 await journal.append('context.usage',{key:envelopeKey(view,model),input:base.totalTokens+1000,heuristic:base.totalTokens,attemptId:'a'});
 const measured=measureContext(view,model,journal.events);expect(measureContext(view,model,journal.events)).toBe(measured);expect(measured.method).toBe('calibrated');expect(measured.totalTokens).toBe(base.totalTokens+1000);
 expect(measured.systemTokens+measured.toolsTokens+measured.messageTokens).toBe(measured.totalTokens);
 expect(measureContext(view,{...model,id:'other'},journal.events).method).toBe('estimated');
 expect(measureContext({...view,prompt:{...prompt,schemas:[{type:'function',name:'x',parameters:{},description:'x'}]}},model,journal.events).method).toBe('estimated');
 await compactContext(options(journal));expect(measureContext(contextView(journal.events,prompt),model,journal.events).method).toBe('estimated');
 }finally{await journal.close();}
});
it('chains checkpoints, preserves raw history and imported projection without executing tools',async()=>{
 const journal=await history(),directory=journal.directory;let closed=false;try{
 const raw=contextView(journal.events,prompt,true);await compactContext(options(journal));
 const first=contextView(journal.events,prompt);expect(first.nodes.length).toBeLessThan(raw.nodes.length);expect(contextView(journal.events,prompt,true).nodes).toEqual(raw.nodes);
 for(let i=0;i<4;i++)await journal.append('context.add',{item:{role:'user',content:'later '+i+'中'.repeat(1500)}});
 await compactContext(options(journal));const view=contextView(journal.events,prompt);expect(view.nodes.filter(n=>n.source==='compaction:summary')).toHaveLength(1);
 expect(journal.events.filter(e=>e.type==='compaction.completed')).toHaveLength(2);
 const broken=structuredClone(journal.events);(broken.find(e=>e.type==='compaction.completed')!.payload as any).references[0].hash='bad';expect(()=>contextView(broken,prompt)).toThrow('引用');
 await journal.close();closed=true;const bundle=join(await temporary(),'bundle');await exportSession(directory,{output:bundle,format:'bundle'});const dest=join(await temporary(),'import');await importBundle(bundle,dest);expect(contextView((await readSession(dest)).events,prompt).nodes).toEqual(view.nodes);
 }finally{if(!closed)await journal.close();}
});
it('retains whole parallel tool and reasoning groups and all unknown calls',async()=>{
 const journal=await history();try{
 await journal.append('context.add',{item:{role:'user',content:'latest'}});
 await journal.append('context.add',{items:[{type:'reasoning',id:'private'},{type:'function_call',call_id:'a'},{type:'function_call',call_id:'b'}]});
 await journal.append('tool.result',{item:{type:'function_call_output',call_id:'a',output:'done'}});
 const plan=planCompaction(contextView(journal.events,prompt),0,'responses');expect(plan.tail.map(n=>n.item.type)).toContain('reasoning');expect(plan.tail.some(n=>n.item.call_id==='b')).toBe(true);
 await compactContext(options(journal));expect(unpairedCalls(journal.events)).toEqual([{type:'function_call',call_id:'b'}]);
 expect(()=>planCompaction(contextView(journal.events,prompt),0,'opaque-v1')).toThrow('协议');
 }finally{await journal.close();}
});
for(const mode of ['cancel','late','empty','growth','network','artifact-race'] as const)it(`does not commit on ${mode}`,async()=>{
 const journal=await history(),abort=new AbortController();const original=contextView(journal.events,prompt).revision;
 const artifact=journal.artifact.bind(journal);if(mode==='artifact-race')journal.artifact=async (...args)=>{const r=await artifact(...args);await journal.append('context.add',{item:{role:'user',content:'late'}});return r;};
 try{await expect(compactContext({...options(journal),signal:abort.signal,summarize:async()=>{
  if(mode==='cancel')abort.abort();if(mode==='late')await journal.append('context.add',{item:{role:'user',content:'late'}});
  if(mode==='network')throw new Error('Network failure');return mode==='empty'?'':mode==='growth'?'中'.repeat(20000):'small summary';
 }})).rejects.toThrow();expect(journal.events.some(e=>e.type==='compaction.completed')).toBe(false);if(!['late','artifact-race'].includes(mode))expect(contextView(journal.events,prompt).revision).toBe(original);
 }finally{await journal.close();}
});
it('splits only complete groups and stays within summary input budget',async()=>{
 const journal=await history();let calls=0;try{
 for(let i=0;i<12;i++)await journal.append('context.add',{item:{role:'user',content:'中'.repeat(1800)}});
 await compactContext({...options(journal),manual:false,summarize:async events=>{calls++;expect(estimateTokens((events[0]!.payload as any).item)+estimateTokens(prompt.text)+2000+1024).toBeLessThan(model.contextWindow);return 'summary';}});
 expect(calls).toBeGreaterThan(1);expect(inputBudget(model)).toEqual({available:16976,threshold:16000,keep:3200});
 expect(measureContext(contextView(journal.events,prompt),model).totalTokens).toBeLessThan(16000);
 }finally{await journal.close();}
});
it('empty and indivisible contexts cannot send an unsafe summary request',async()=>{
 const journal=await Journal.open(await temporary());try{
 expect(await compactContext(options(journal))).toContain('暂无');
 await journal.append('context.add',{item:{role:'user',content:'中'.repeat(25000)}});await journal.append('context.add',{item:{role:'user',content:'中'.repeat(3500)}});
 await expect(compactContext({...options(journal),summarize:async()=>{throw new Error('must not call');}})).rejects.toThrow('完整交互过大');
 }finally{await journal.close();}
});
it('config defaults auto on, persists off and rejects stale or malformed settings',async()=>{
 const store=new ConfigStore(await temporary()),s=await store.describe();expect(s.autoCompact).toBe(true);
 await store.save('settings',{...s,autoCompact:false});expect((await new ConfigStore(store.home).settings()).autoCompact).toBe(false);
 await expect(store.save('settings',s)).rejects.toThrow('更新');await expect(store.save('settings',{...s,revision:1,autoCompact:'no'})).rejects.toThrow('配置');
});

it('summaries do not treat retained image encodings as conversation text',async()=>{
 const journal=await history();try{
 await journal.append('context.add',{item:{role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+'a'.repeat(500000)}]}});
 await journal.append('context.add',{item:{role:'user',content:'中'.repeat(3500)}});
 let seen=false;await compactContext({...options(journal),summarize:async events=>{const input=JSON.stringify(events[0]!.payload);expect(input).not.toContain('data:image/');if(input.includes('图片附件'))seen=true;return 'summary';}});expect(seen).toBe(true);
 }finally{await journal.close();}
});
