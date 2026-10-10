import { hash, type JournalEvent } from './journal.js';
import { contextView, promptEscape } from './context.js';
import { BUDGET_POLICY } from './context-budget.js';
import { contextMeasurementIdentity, type ContextMeasurementIdentity } from './context-meta.js';
import type { ContextOccupancy } from './shared/protocol.js';
export interface ContextModel { id:string; provider:string; baseUrl?:string; contextIdentity?:string; contextWindow:number; maxTokens:number }
/** Deterministic conservative estimate, not a provider tokenizer. Never price image bytes as text. */
export function estimateTokens(value:unknown):number {
  if(typeof value==='string') {
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
function images(value:unknown, path=""):Array<{path:string;hash:string}> {
 if(!value || typeof value!=="object")return [];
 if(!Array.isArray(value) && ["input_image","image","image_url"].includes(String((value as any).type)))return [{path,hash:hash(JSON.stringify(value))}];
 return Object.entries(value).flatMap(([key,item])=>images(item,`${path}/${key}`));
}
export function envelopeKey(view:ReturnType<typeof contextView>,model:ContextModel,identity=contextMeasurementIdentity(view)) {
 return hash(JSON.stringify([BUDGET_POLICY.version,model.provider,model.id,model.baseUrl,model.contextWindow,model.maxTokens,model.contextIdentity,
  identity,view.prompt.text,view.prompt.schemas,view.checkpoint,images(view.nodes.map(node=>node.item))]));
}
const cache = new WeakMap<JournalEvent[], {key:string;value:ContextOccupancy}>();
export function measureContext(view:ReturnType<typeof contextView>,model:ContextModel,events:JournalEvent[]=[],identity=contextMeasurementIdentity(view,events)):ContextOccupancy {
 const key=envelopeKey(view,model,identity);
 const sample=events.findLast(event=>{
  if(event.type!=='context.usage'||(event.payload as any).key!==key)return false;
  const payload=event.payload as any,attemptId=event.attemptId??payload.attemptId;
  const purpose=payload.purpose??(events.findLast(candidate=>candidate.type==='attempt.started'&&candidate.attemptId===attemptId)?.payload as any)?.purpose;
  return !purpose||['work','create'].includes(purpose);
 })?.payload as {input:number;heuristic:number;attemptId:string}|undefined;
 const valid=sample&&Number.isSafeInteger(sample.input)&&sample.input>=0&&Number.isSafeInteger(sample.heuristic)&&sample.heuristic>=0?sample:undefined;
 const cacheKey=JSON.stringify([view.revision,key,valid]);const cached=cache.get(events);if(cached?.key===cacheKey)return cached.value;
 const layers:NonNullable<ContextOccupancy['layers']>=[];
 const add=(id:string,category:'system'|'tools'|'messages',tokens:number,source:{source:string;hash:string;scope?:string;eventId?:string})=>{
  let layer=layers.find(layer=>layer.id===id&&layer.category===category);
  if(!layer){layer={id,category,tokens:0,estimatedTokens:0,adjustmentTokens:0,sources:[]};layers.push(layer);}
  layer.estimatedTokens+=tokens;layer.tokens+=tokens;layer.sources.push(source);
 };
 const systemEstimate=estimateTokens(view.prompt.text),fragments=view.prompt.fragments;
 const weights=fragments.map(fragment=>estimateTokens(`<${fragment.section} source="${promptEscape(fragment.source,true)}"${fragment.scope?` scope="${promptEscape(fragment.scope,true)}"`:''}>\n${fragment.text}\n</${fragment.section}>`));
 const weightTotal=weights.reduce((sum,value)=>sum+value,0);let systemAssigned=0;
 fragments.forEach((fragment,index)=>{
  const tokens=index===fragments.length-1?systemEstimate-systemAssigned:Math.floor(systemEstimate*(weights[index]??0)/Math.max(1,weightTotal));systemAssigned+=tokens;
  const id=fragment.section==='rules'?(fragment.scope==='user'?'user-rules':fragment.scope==='.'?'project-rules':'directory-rules'):fragment.section??'instructions';
  add(id,'system',tokens,{source:fragment.source,hash:fragment.hash,scope:fragment.scope});
 });
 if(!fragments.length&&systemEstimate)add('unattributed-system','system',systemEstimate,{source:'captured:serialized-prompt',hash:hash(view.prompt.text)});
 const toolsEstimate=estimateTokens(view.prompt.schemas);let toolsAssigned=0;
 const schemaWeights=view.prompt.schemas.map(estimateTokens),schemaTotal=schemaWeights.reduce((a,b)=>a+b,0);
 view.prompt.schemas.forEach((schema,index)=>{const tokens=index===view.prompt.schemas.length-1?toolsEstimate-toolsAssigned:Math.floor(toolsEstimate*(schemaWeights[index]??0)/Math.max(1,schemaTotal));toolsAssigned+=tokens;
  add('schemas','tools',tokens,{source:schema.name,hash:hash(JSON.stringify(schema))});});
 // Even empty arrays have a defined zero cost; no placeholder source is invented.
 view.nodes.forEach(node=>{
  const attachments=images(node.item),imageTokens=attachments.length*2048,total=estimateTokens(node.item)+2;
  const source={source:node.source,hash:node.hash,eventId:node.eventId};
  const id=node.source==='runtime:environment:v1'?'environment':node.source==='compaction:summary'?'compaction':node.source.startsWith('handoff:')?'handoff':node.item.type==='function_call_output'?'tool-results':'history';
  add(id,'messages',Math.max(0,total-imageTokens),source);if(imageTokens)add('images','messages',imageTokens,source);
 });
 const heuristic=systemEstimate+toolsEstimate+estimateTokens(view.nodes.map(node=>node.item));
 const total=valid?Math.max(heuristic,Math.round(valid.input+heuristic-valid.heuristic)):heuristic,correction=total-heuristic;
 let assigned=0;layers.forEach((layer,index)=>{const extra=index===layers.length-1?correction-assigned:Math.floor(correction*layer.estimatedTokens/Math.max(1,heuristic));assigned+=extra;layer.adjustmentTokens=extra;layer.tokens+=extra;});
 const exclusions:NonNullable<ContextOccupancy['exclusions']>=(view.prompt.excludedInstructions??[]).map(item=>({source:item.source,hash:item.hash,scope:item.scope,reason:item.reason}));
 const selected=new Set(view.nodes.map(node=>`${node.eventId}:${node.itemIndex}`));
 for(const node of contextView(events,view.prompt,true).nodes)if(!selected.has(`${node.eventId}:${node.itemIndex}`))exclusions.push({source:node.source,hash:node.hash,eventId:node.eventId,reason:'not-selected-in-current-projection'});
 const withdrawn=new Map(events.filter(event=>event.type==='instruction.withdrawn').map(event=>[(event.payload as any).source,event]));
 for(const [source,event] of withdrawn)if(!view.prompt.fragments.some(fragment=>fragment.source===source)){const value=event.payload as any;exclusions.push({source,hash:value.hash,scope:value.scope,eventId:event.eventId,reason:`resource-${value.reason}`});}
 const sum=(category:string)=>layers.filter(layer=>layer.category===category).reduce((sum,layer)=>sum+layer.tokens,0);
 const value:ContextOccupancy={revision:view.revision,model:model.id,provider:model.provider,contextWindow:knownCapacity(model)?model.contextWindow:undefined,
  systemTokens:sum('system'),toolsTokens:sum('tools'),messageTokens:sum('messages'),totalTokens:total,heuristicTokens:heuristic,
  method:valid?'calibrated':'estimated',imageEstimate:layers.some(layer=>layer.id==='images'),anchor:valid?.attemptId,sampledInputTokens:valid?.input,
  policyVersion:BUDGET_POLICY.version,...identity,reservations:budgetDetails(model,view.prompt.schemas.length),layers,exclusions};
 cache.set(events,{key:cacheKey,value});return value;
}
function knownCapacity(model:ContextModel){return Number.isSafeInteger(model.contextWindow)&&model.contextWindow>0;}
export function inputBudget(model:ContextModel,toolCount=0){
 const safety=Math.max(BUDGET_POLICY.safetyMinimum,Math.ceil(model.contextWindow*BUDGET_POLICY.safetyFraction));
 const toolResults=toolCount>0?Math.min(BUDGET_POLICY.toolResultMaximum,Math.floor(model.contextWindow*BUDGET_POLICY.toolResultFraction)):0;
 const available=model.contextWindow-model.maxTokens-safety-toolResults;
 return {available,threshold:Math.min(Math.floor(model.contextWindow*BUDGET_POLICY.pressureFraction),available),keep:Math.min(Math.floor(model.contextWindow*BUDGET_POLICY.recentFraction),Math.floor(Math.max(0,available)*.5))};
}
export function budgetDetails(model:ContextModel,toolCount=0):NonNullable<ContextOccupancy['reservations']>{
 if(!knownCapacity(model))return {output:model.maxTokens,capacity:'unknown'};
 const budget=inputBudget(model,toolCount);
 return {output:model.maxTokens,safety:Math.max(BUDGET_POLICY.safetyMinimum,Math.ceil(model.contextWindow*BUDGET_POLICY.safetyFraction)),
  toolResults:toolCount>0?Math.min(BUDGET_POLICY.toolResultMaximum,Math.floor(model.contextWindow*BUDGET_POLICY.toolResultFraction)):0,
  availableInput:budget.available,pressureThreshold:budget.threshold,capacity:'known'};
}
