import { hash, type JournalEvent } from './journal.js';
import type { contextView } from './context.js';
import type { ContextOccupancy } from './shared/protocol.js';
export interface ContextModel { id:string; provider:string; baseUrl?:string; contextIdentity?:string; contextWindow:number; maxTokens:number }
/** Deterministic conservative estimate, not a provider tokenizer. Never price image bytes as text. */
export function estimateTokens(value:unknown):number {
  if(typeof value==='string') {
    if(value.startsWith('data:image/'))return 2048;
    let wide=0,ascii=0;for(const c of value){if(c.codePointAt(0)!>127)wide++;else ascii++;}
    return Math.ceil(wide+ascii/3);
  }
  if(Array.isArray(value))return value.reduce((n,v)=>n+estimateTokens(v),0)+value.length*2;
  if(value&&typeof value==='object'){
    const obj=value as Record<string,unknown>;
    if(['input_image','image','image_url'].includes(String(obj.type)))return 2048;
    return Object.entries(obj).reduce((n,[k,v])=>n+estimateTokens(k)+estimateTokens(v)+2,0);
  }
  return value===undefined?0:estimateTokens(String(value));
}
export function envelopeKey(view:ReturnType<typeof contextView>,model:ContextModel){return hash(JSON.stringify([model.provider,model.id,model.baseUrl,model.contextWindow,model.contextIdentity,view.prompt.text,view.prompt.schemas,view.checkpoint]));}
const cache = new WeakMap<JournalEvent[], {key:string;value:ContextOccupancy}>();
export function measureContext(view:ReturnType<typeof contextView>,model:ContextModel,events:JournalEvent[]=[]):ContextOccupancy {
  const key=envelopeKey(view,model);
  const sample=events.findLast(e=>e.type==='context.usage'&&(e.payload as any).key===key)?.payload as {input:number;heuristic:number;attemptId:string}|undefined;
  const cacheKey=JSON.stringify([view.revision,key,sample]);
  const cached=cache.get(events);if(cached?.key===cacheKey)return cached.value;
  let systemTokens=estimateTokens(view.prompt.text),toolsTokens=estimateTokens(view.prompt.schemas),messageTokens=estimateTokens(view.nodes.map(n=>n.item));
  const heuristic=systemTokens+toolsTokens+messageTokens;
  const total=sample?Math.max(heuristic,Math.round(sample.input+heuristic-sample.heuristic)):heuristic;
  const correction=total-heuristic;
  if(correction>0 && heuristic){const systemExtra=Math.floor(correction*systemTokens/heuristic),toolsExtra=Math.floor(correction*toolsTokens/heuristic);systemTokens+=systemExtra;toolsTokens+=toolsExtra;messageTokens+=correction-systemExtra-toolsExtra;}
  const value:ContextOccupancy = {revision:view.revision,model:model.id,provider:model.provider,contextWindow:Number.isSafeInteger(model.contextWindow)&&model.contextWindow>0?model.contextWindow:undefined,systemTokens,toolsTokens,messageTokens,totalTokens:total,method:sample?'calibrated':'estimated',imageEstimate:view.nodes.some(n=>/"(?:input_image|image_url|image)"/.test(JSON.stringify(n.item))),anchor:sample?.attemptId};
  cache.set(events,{key:cacheKey,value});return value;
}
export function inputBudget(model:ContextModel){
 const available=model.contextWindow-model.maxTokens-Math.max(1024,Math.ceil(model.contextWindow*.02));
 return {available,threshold:Math.min(Math.floor(model.contextWindow*.8),available),keep:Math.min(Math.floor(model.contextWindow*.16),Math.floor(Math.max(0,available)*.5))};
}
