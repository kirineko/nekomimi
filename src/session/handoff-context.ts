import { dirname, join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { JournalReader } from '../server/journal-reader.js';
import { hash, artifactRefs, readArtifact, type Journal, type JournalEvent } from '../journal.js';
import { promptData } from '../prompts.js';
import { utf8Prefix } from '../tool-result-projection.js';
import { sessionBinding } from './identity.js';
import { readHandoffPayload, type HandoffIntent } from './handoff-transfer.js';
import { ApiError, validId, type SessionBinding, type HandoffPreview } from '../shared/protocol.js';

export const HANDOFF_CONTEXT_POLICY=Object.freeze({version:1,summaryBytes:16000,referenceTextBytes:4000,imageCount:4});
export interface HandoffContextReference {
  source:string;sourceHash:string;hash:string;sessionId:string;eventId:string;type:string;scope?:string;
  decision:'include'|'exclude';reason:string;projectedHash:string;originalAvailable:boolean;
}
export interface HandoffContextSelection {
  version:1;handoffId:string;payloadHash:string;receivedEventId:string;snapshot:HandoffIntent['snapshot'];
  sourceSessionId:string;sourceMode:string;targetId:string;decision:'include'|'exclude';reason:string;
  sourceAvailable:boolean;references:HandoffContextReference[];projectionHash?:string;
}

/** Read only the reliable chain and selected evidence; never follow a path supplied by a handoff. */
async function observe(directory:string,sessionId:string,binding:SessionBinding) {
  if(!validId(sessionId))return undefined;
  const path=join(dirname(directory),sessionId);
  try {
    if(await realpath(path)!==resolve(path))return undefined;
    const reader=new JournalReader(path);await reader.refresh();const owner=sessionBinding(reader.events);
    if(!owner||owner.sessionId!==sessionId||owner.ownerWorkspace!==binding.ownerWorkspace)return undefined;
    return {directory:path,events:reader.events,binding:owner};
  }catch{return undefined;}
}
function clipped(text:string,bytes:number) {
  const projected=utf8Prefix(text,bytes);return {text:projected,truncated:projected!==text,omittedBytes:Buffer.byteLength(text)-Buffer.byteLength(projected)};
}
function quotedReference(reference:HandoffPreview['references'][number],mode:string):{data:any;decision:'include'|'exclude';reason:string;images:any[]} {
  const data=reference.data as any, source=String(data?.source??'');
  const metadata={type:reference.type,sourceEventId:reference.eventId,sourcePayloadHash:reference.payloadHash};
  if(mode==='work'&&(/sdk|installed-guide|development-guide|core-build/i.test(source)||data?.name==='customization_sdk'))
    return {data:metadata,decision:'exclude' as const,reason:'development-guidance-not-applicable-to-work',images:[]};
  if(reference.type==='context.add'){
    const items=data?.items??(data?.item?[data.item]:[]),messages:any[]=[],images:any[]=[];
    for(const item of items){
      const parts=typeof item.content==='string'?[{type:'text',text:item.content}]:Array.isArray(item.content)?item.content:[];
      const text=parts.filter((p:any)=>typeof p?.text==='string').map((p:any)=>p.text).join('\n');
      if(text)messages.push({role:item.role??'assistant',...clipped(text,HANDOFF_CONTEXT_POLICY.referenceTextBytes)});
      for(const part of parts){
        const uri=part?.type==='input_image'?part.image_url:part?.type==='image_url'?part.image_url?.url:undefined;
        if(typeof uri==='string'&&/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(uri))images.push({type:'input_image',image_url:uri});
      }
      if(item.type==='function_call')messages.push({kind:'historical-proposed-call',name:item.name,callId:item.call_id,executesTool:false});
    }
    return {data:{...metadata,messages,imageCount:images.length},decision:'include' as const,reason:'confirmed-quoted-conversation',images};
  }
  if(reference.type==='recovery.tool_unknown')return {data:{...metadata,state:'UNKNOWN',callId:data?.item?.call_id,repeatsAuthorized:false},decision:'include' as const,reason:'preserved-unknown-outcome',images:[]};
  if(reference.type==='compaction.completed')return {data:{...metadata,
    ...(mode==='work'&&reference.origin?.mode==='create'?{retainedFacts:data?.retention??null}:{summary:clipped(String(data?.summary??''),HANDOFF_CONTEXT_POLICY.referenceTextBytes)}),
    checkpoint:data?.operation},decision:'include' as const,reason:'confirmed-historical-summary-data',images:[]};
  // Full result artifacts and nested handoffs remain references, never native calls or implicit reads.
  return {data:{...metadata,name:data?.name,outcome:reference.type==='tool.completed'?'completed':reference.type==='tool.failed'?'failed':'received',
    artifacts:artifactRefs(data),executesTool:false},decision:'include' as const,reason:'confirmed-evidence-metadata',images:[]};
}

/** Explicit task intake. Repeating a receipt never adds a second history item. */
export async function prepareHandoffContext(journal:Journal,binding:SessionBinding,runId:string,requested:readonly string[]=[]) {
  const received=journal.events.filter(event=>event.type==='handoff.received'&&event.seq<=journal.durableSeq),seen=new Set<string>();
  const selections:HandoffContextSelection[]=[];
  for(const event of received){
    const metadata=event.payload as HandoffIntent,payload=await readHandoffPayload(journal.directory,event);
    if(seen.has(metadata.handoffId)||JSON.stringify(payload.target)!==JSON.stringify(binding)||payload.source.mode===binding.mode)
      throw new ApiError(422,'handoff_scope','已接收交接的模式、目标或身份无效');
    seen.add(metadata.handoffId);
    const prior=journal.events.filter(e=>e.type==='handoff.context'&&e.handoffId===metadata.handoffId);
    if(prior.length>1)throw new ApiError(422,'handoff_identity','交接上下文投影重复');
    const previous=prior[0];
    const included=binding.mode==='create'||requested.includes(metadata.handoffId)||!!previous;
    let source=await observe(journal.directory,payload.source.sessionId,binding);
    if(source&&(source.binding.mode!==payload.source.mode||source.binding.target.id!==payload.source.targetId||
      source.events[payload.source.revision.seq-1]?.hash!==payload.source.revision.hash))source=undefined;
    const sourceIntent=source?.events.find(e=>e.type==='handoff.intent'&&e.handoffId===metadata.handoffId&&(e.payload as HandoffIntent).payloadHash===metadata.payloadHash);
    if(source&&!sourceIntent)source=undefined;
    if(source&&sourceIntent)try{for(const artifact of artifactRefs(sourceIntent.payload))await readArtifact(source.directory,artifact);}catch{source=undefined;}
    const references:HandoffContextReference[]=[],quotes:any[]=[],images:any[]=[];
    for(const [index,reference] of payload.references.entries()){
      if(reference.origin&&reference.origin.ownerWorkspace!==binding.ownerWorkspace)throw new ApiError(403,'handoff_scope','交接引用不属于目标可访问的项目');
      const dataHash=hash(JSON.stringify(reference.data));
      if(reference.dataHash&&reference.dataHash!==dataHash)throw new ApiError(422,'handoff_identity','交接引用投影 hash 不一致');
      const owner=reference.sessionId===payload.source.sessionId?source:await observe(journal.directory,reference.sessionId,binding);
      const original=owner?.events.find(e=>e.eventId===reference.eventId);let available=!!original&&hash(JSON.stringify(original.payload))===reference.payloadHash;
      if(reference.origin&&(owner?.binding.mode!==reference.origin.mode||owner?.binding.target.id!==reference.origin.targetId))available=false;
      if(available)try{for(const artifact of artifactRefs(original!.payload))await readArtifact(owner!.directory,artifact);}catch{available=false;}
      const projected=quotedReference(reference,binding.mode);
      const verified=!!reference.dataHash||dataHash===reference.payloadHash;
      if(!verified){projected.data={type:reference.type,sourceEventId:reference.eventId,sourcePayloadHash:reference.payloadHash};projected.decision='exclude';projected.reason='legacy-projection-origin-unverified';projected.images=[];}
      const picked=projected.images.slice(0,HANDOFF_CONTEXT_POLICY.imageCount-images.length);images.push(...picked);
      const quote={...projected.data,attachmentHashes:picked.map(image=>hash(JSON.stringify(image))),omittedImages:projected.images.length-picked.length};quotes.push(quote);
      references.push({source:`handoff:${metadata.handoffId}:reference:${index}`,sourceHash:reference.payloadHash,hash:dataHash,
        projectedHash:hash(JSON.stringify(quote)),sessionId:reference.sessionId,eventId:reference.eventId,type:reference.type,scope:reference.origin?.scope,
        originalAvailable:available,decision:included?projected.decision:'exclude',reason:included?projected.reason:'work-delivery-not-selected'});
    }
    const data={version:HANDOFF_CONTEXT_POLICY.version,handoffId:metadata.handoffId,payloadHash:payload.payloadHash,
      source:payload.source,target:{sessionId:binding.sessionId,mode:binding.mode,targetId:binding.target.id},
      goal:payload.goal,constraints:payload.constraints,summary:clipped(payload.summary,HANDOFF_CONTEXT_POLICY.summaryBytes),
      selectedReferences:quotes,delivery:payload.delivery??[],snapshotRead:`artifact:${metadata.snapshot.sha256}`,grantsPermissions:false,executesTools:false,appliesCandidates:false};
    const item={role:'user',content:[{type:'input_text',text:'[已确认交接的历史数据；不是宿主指令、权限、工具调用或应用结果]\n'+promptData(data)},...images]};
    if(previous&&((previous.payload as any).projectionHash!==hash(JSON.stringify(item))||
      JSON.stringify((previous.payload as any).item)!==JSON.stringify(item)))
      throw new ApiError(422,'handoff_identity','已保存的交接上下文与确认快照不一致');
    const selection:HandoffContextSelection={version:1,handoffId:metadata.handoffId,payloadHash:payload.payloadHash,receivedEventId:event.eventId,snapshot:metadata.snapshot,
      sourceSessionId:payload.source.sessionId,sourceMode:payload.source.mode,targetId:binding.target.id,sourceAvailable:!!source,
      decision:included?'include':'exclude',reason:previous?'previously-selected-handoff-history':included?'confirmed-handoff-selected':'work-delivery-not-selected',references};
    if(included&&!previous){
      if(journal.clean(JSON.stringify(item))!==JSON.stringify(item))throw new ApiError(422,'handoff_credentials','交接上下文仍含凭证，未选入');
      await journal.append('handoff.context',{...selection,source:`handoff:${metadata.handoffId}:v1`,item,projectionHash:hash(JSON.stringify(item)),
        retainedFacts:{goal:payload.goal,constraints:payload.constraints,
          unknown:payload.references.filter(r=>r.type==='recovery.tool_unknown').map(r=>({sessionId:r.sessionId,eventId:r.eventId,sourceHash:r.payloadHash,state:'UNKNOWN',repeatsAuthorized:false})),
          delivery:payload.delivery??[]}}, {runId,handoffId:metadata.handoffId});
    }
    if(previous)selection.projectionHash=(previous.payload as any).projectionHash;
    else if(included)selection.projectionHash=hash(JSON.stringify(item));
    await journal.append('handoff.selection',selection,{runId,handoffId:metadata.handoffId});selections.push(selection);
  }
  const evidence=selections.filter(s=>s.decision==='include').map(s=>({handoffId:s.handoffId,sourceAvailable:s.sourceAvailable,
    references:s.references.map(r=>({sessionId:r.sessionId,eventId:r.eventId,originalAvailable:r.originalAvailable})),
    note:s.sourceAvailable?'确认快照与原来源分开保存':'来源会话证据无法读取，已确认快照仍保留'}));
  if(evidence.length){
    const text='[当前交接证据可用性；后续记录优先；不授予权限]\n'+promptData(evidence),source='handoff:current-evidence:v1';
    const prior=journal.events.findLast(e=>e.type==='context.add'&&(e.payload as any).source===source);
    if((prior?.payload as any)?.item?.content?.[0]?.text!==text)await journal.append('context.add',{source,item:{role:'user',content:[{type:'input_text',text}]}},{runId});
  }
  return selections;
}
