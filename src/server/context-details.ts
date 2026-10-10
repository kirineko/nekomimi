import {readArtifact,artifactRefs} from '../journal.js';
import {sessionBinding} from '../session/identity.js';
import {ApiError} from '../shared/protocol.js';
import type {ContextDetailsView} from '../shared/context-details.js';
import type {RequestContextSnapshot} from '../context-snapshot.js';
import type {Entry,Sessions} from './sessions.js';
/** Reads captured Journal/artifacts only. Never acquires extensions, models or tool resources. */
export async function contextDetails(sessions:Sessions,entry:Entry,sessionId:string,options:{snapshot?:string;offset:number;decision?:string;compactionBefore:number;snapshotBefore?:number;checkpoint?:string;referenceOffset?:number;handoffOffset?:number}):Promise<ContextDetailsView>{
  if(options.decision&&!['include','exclude'].includes(options.decision))throw new ApiError(400,'context_filter','上下文筛选无效');
  const events=entry.reader.events,binding=sessionBinding(events),current=await sessions.context(entry);
  const snapshots=events.filter(event=>event.type==='context.snapshot');
  const selected=options.snapshot?snapshots.find(event=>event.eventId===options.snapshot):snapshots.findLast(event=>(event.payload as {purpose?:string}).purpose===binding?.mode)??snapshots.at(-1);
  if(options.snapshot&&!selected)throw new ApiError(404,'context_snapshot','此会话未记录指定请求快照');
  let snapshot:ContextDetailsView['snapshot'];
  if(selected){
    const ref=artifactRefs(selected.payload)[0];if(!ref)throw new ApiError(422,'context_snapshot','请求快照缺少附件引用');
    if(ref.bytes>32*1024*1024)throw new ApiError(422,'context_snapshot','请求快照超过明细读取上限，请导出完整证据');
    let captured:RequestContextSnapshot;
    try{captured=JSON.parse((await readArtifact(entry.directory,ref)).toString('utf8'));}catch{throw new ApiError(422,'context_snapshot','请求快照附件缺失或完整性检查失败');}
    if(captured.version!==1||!Array.isArray(captured.selection)||captured.revision!==(selected.payload as {revision:string}).revision)throw new ApiError(422,'context_snapshot','请求快照契约或版本无效');
    const filtered=captured.selection.filter(item=>!options.decision||item.decision===options.decision);
    snapshot={eventId:selected.eventId,seq:selected.seq,revision:captured.revision,contextRevision:captured.contextRevision,purpose:captured.purpose,mode:captured.mode,targetId:captured.target?.id,model:{id:captured.model.id,provider:captured.model.provider,protocol:captured.model.protocol},capabilityRevision:captured.capabilityRevision,handoffs:(captured.handoffs??[]).slice(options.handoffOffset??0,(options.handoffOffset??0)+40).map(({handoffId,payloadHash,sourceSessionId,sourceMode,decision,reason,sourceAvailable})=>({handoffId,payloadHash,sourceSessionId,sourceMode,decision,reason,sourceAvailable})),nextHandoff:(options.handoffOffset??0)+40<(captured.handoffs?.length??0)?(options.handoffOffset??0)+40:undefined,artifact:ref,
      selection:filtered.slice(options.offset,options.offset+40).map(({id,source,hash,role,layer,scope,decision,reason,eventId,itemIndex,version,sourceHash,sources,transformations,projection})=>({id,source,hash,role,layer,scope,decision,reason,eventId,itemIndex,version,sourceHash,sources,transformations,projection})),total:filtered.length,included:captured.selection.filter(item=>item.decision==='include').length,excluded:captured.selection.filter(item=>item.decision==='exclude').length,next:options.offset+40<filtered.length?options.offset+40:undefined};
  }
  const history=events.filter(event=>event.type.startsWith('compaction.')&&(options.checkpoint?event.eventId===options.checkpoint:event.seq<options.compactionBefore)).reverse();
  if(options.checkpoint&&!history.length)throw new ApiError(404,'context_checkpoint','此会话未记录指定压缩证据');
  const referenceOffset=options.referenceOffset??0;
  const snapshotChoices=snapshots.filter(event=>event.seq<(options.snapshotBefore??Number.MAX_SAFE_INTEGER)).reverse();
  const compactions=history.slice(0,20).map(event=>{
    const value=event.payload as {operation?:string;sourceRevision?:string;before?:number;after?:number;summary?:string;error?:string;references?:Array<{eventId:string;itemIndex:number;hash:string}>;previous?:string;source?:unknown;retention?:unknown;retainedFrom?:unknown;summaryHash?:string;attemptIds?:string[]};
    return {eventId:event.eventId,seq:event.seq,status:event.type.slice('compaction.'.length),runId:event.runId,operation:value.operation,sourceRevision:value.sourceRevision,before:value.before,after:value.after,summary:value.summary?.slice(0,12000),summaryTruncated:(value.summary?.length??0)>12000,error:value.error?.slice(0,12000),referenceCount:value.references?.length??0,references:value.references?.slice(referenceOffset,referenceOffset+40)??[],nextReference:referenceOffset+40<(value.references?.length??0)?referenceOffset+40:undefined,source:value.source,retention:value.retention,retainedFrom:value.retainedFrom,summaryHash:value.summaryHash,artifact:artifactRefs(event.payload)[0],previous:value.previous,attemptIds:value.attemptIds?.slice(0,40)??[]};
  });
  return {sessionId,mode:binding?.mode,targetId:binding?.target.id,compacting:current.compacting,unavailableReason:current.context?undefined:events.some(event=>event.type==='context.measured')?'当前能力未加载或版本已变化，未把历史测量当作当前统计。':'尚无可用的当前请求测量。',measurement:current.context,
    nextSnapshotBefore:snapshotChoices.length>40?snapshotChoices[39]?.seq:undefined,snapshots:snapshotChoices.slice(0,40).map(event=>({eventId:event.eventId,seq:event.seq,revision:(event.payload as {revision:string}).revision,purpose:(event.payload as {purpose:string}).purpose,modelCallId:event.modelCallId})),snapshot,compactions,nextCompactionBefore:history.length>20?compactions.at(-1)?.seq:undefined};
}
