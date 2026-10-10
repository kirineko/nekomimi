import { artifactRefs, type JournalEvent } from '../journal.js';
import { ApiError } from '../shared/protocol.js';
import type { InspectionNode,InspectionView,AttemptView } from '../shared/inspection.js';
import type { Entry } from './sessions.js';
import { safeView } from './http.js';
const payload=(event:JournalEvent|undefined):Record<string,any>=>event?.payload && typeof event.payload==='object' ? event.payload as Record<string,any> : {};
const numeric=(...values:unknown[]):number|null=>{const value=values.find(item=>typeof item==='number'&&Number.isFinite(item)&&item>=0);return typeof value==='number'?value:null;};
const modelId=(id:string)=>`model:${id}`,toolId=(id:string)=>`tool:${id}`;
const toolEvent=(event:JournalEvent)=>!!event.toolCallId&&(event.type.startsWith('tool.')||event.type.startsWith('codemode.')||event.type.startsWith('shell.')||event.type.startsWith('file.')||event.type==='recovery.tool_unknown');
const attemptStatus=(events:JournalEvent[],active:boolean)=>{const terminal=events.findLast(event=>event.type==='attempt.finished');return terminal?String(payload(terminal).status??payload(terminal).outcome??'unknown'):active?'running':'unknown';};
/** Disposable, read-only index over authority records. Never loads a provider, factory or preview. */
export function inspectSession(entry:Entry,sessionId:string,options:{run?:string;runBefore?:number;parent?:string;node?:string;attempt?:string;offset:number;attemptOffset:number;eventOffset:number;group?:string},activeRunId?:string):InspectionView {
  if(options.group&&!['request','response','sources','usage'].includes(options.group))throw new ApiError(400,'inspection_group','证据分组无效');
  const all=entry.reader.events,runs=new Map<string,number>();
  for(const event of all)if(event.runId)runs.set(event.runId,event.seq);
  const choices=[...runs].map(([id,seq])=>({id,seq})).sort((a,b)=>b.seq-a.seq).filter(run=>run.seq<(options.runBefore??Number.MAX_SAFE_INTEGER));
  const runId=options.run??[...runs].sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(options.run&&!runs.has(options.run))throw new ApiError(404,'inspection_run','此会话未记录指定运行');
  const events=runId?all.filter(event=>event.runId===runId):[],nodes=new Map<string,InspectionNode>(),nodeEvents=new Map<string,JournalEvent[]>(),attemptEvents=new Map<string,JournalEvent[]>();
  const add=(id:string,event:JournalEvent,kind:'model'|'tool')=>{
    let node=nodes.get(id);const p=payload(event);
    if(!node){node={id,kind,mode:event.mode,targetId:event.targetId,label:kind==='model'?'模型调用':p.name??'工具调用',seq:event.seq,status:activeRunId===runId?'running':'unknown',children:0,...(kind==='model'?{modelCallId:event.modelCallId}:{toolCallId:event.toolCallId})};nodes.set(id,node);nodeEvents.set(id,[]);}
    nodeEvents.get(id)!.push(event);
    if(kind==='model'){
      if(event.parentToolCallId)node.parent=toolId(event.parentToolCallId);else if(event.parentModelCallId)node.parent=modelId(event.parentModelCallId);
      if(event.type==='attempt.started'){node.model=p.model;node.provider=p.provider;node.operation=p.operation;node.purpose=p.purpose;node.label=p.operation??p.purpose??'模型调用';}
    }else{
      if(event.parentToolCallId)node.parent=toolId(event.parentToolCallId);else if(event.modelCallId)node.parent=modelId(event.modelCallId);
      if(p.name)node.label=p.name;
      if(['tool.completed','tool.result'].includes(event.type))node.status=p.isError||p.details?.isError?'failed':'completed';
      if(['tool.failed','tool.blocked'].includes(event.type))node.status=p.unknown?'unknown':'failed';
      if(event.type==='codemode.finished')node.status=p.status??'unknown';
      if(event.type==='recovery.tool_unknown'||event.type==='tool.execution_error')node.status=p.unknown!==false?'unknown':'failed';
    }
  };
  for(const event of events){
    // Child model evidence inherits a tool link but is charged and inspected only as a model attempt.
    if(event.modelCallId&&!toolEvent(event))add(modelId(event.modelCallId),event,'model');
    if(toolEvent(event))add(toolId(event.toolCallId!),event,'tool');
    if(event.attemptId&&!toolEvent(event)){const list=attemptEvents.get(event.attemptId)??[];list.push(event);attemptEvents.set(event.attemptId,list);}
  }
  const attempts=new Map<string,AttemptView>();
  for(const [id,list] of attemptEvents){
    if(!list.some(event=>event.type==='attempt.started'||event.type==='request.dispatched'||event.type==='attempt.finished'))continue;
    const start=list.find(event=>event.type==='attempt.started'),finish=list.findLast(event=>event.type==='attempt.finished'),p=payload(finish),meta=payload(start),usage=p.usage??{};
    attempts.set(id,{id,seq:list[0]!.seq,status:attemptStatus(list,activeRunId===runId),model:meta.model,provider:meta.provider,operation:meta.operation,purpose:meta.purpose,
      input:numeric(usage.input_tokens,usage.prompt_tokens,usage.inputTokens,usage.input),output:numeric(usage.output_tokens,usage.completion_tokens,usage.outputTokens,usage.output),cacheRead:numeric(usage.input_tokens_details?.cached_tokens,usage.prompt_tokens_details?.cached_tokens,usage.cacheRead,usage.cache_read_input_tokens,usage.prompt_cache_hit_tokens),elapsedMs:p.elapsedMs,firstByteMs:p.firstByteMs,httpStatus:p.httpStatus,retry:safeView(payload(list.findLast(event=>event.type==='attempt.retry')))});
  }
  for(const node of nodes.values()){
    const script=nodeEvents.get(node.id)?.findLast(event=>event.type==='codemode.finished');
    if(script)node.status=String(payload(script).status??'unknown');
    if(node.kind==='model'){const owned=[...attempts.values()].filter(attempt=>attemptEvents.get(attempt.id)?.some(event=>event.modelCallId===node.modelCallId));node.status=owned.at(-1)?.status??'unknown';}
    const visited=new Set([node.id]);let parent=node.parent;
    while(parent){if(visited.has(parent)||!nodes.has(parent)){node.parentMissing=true;node.parentReference=node.parent;node.parent=undefined;break;}visited.add(parent);parent=nodes.get(parent)?.parent;}
  }
  for(const node of nodes.values())if(node.parent)nodes.get(node.parent)!.children++;
  if(options.parent&&!nodes.has(options.parent))throw new ApiError(404,'inspection_parent','此运行未记录指定父调用');
  const children=[...nodes.values()].filter(node=>node.parent===(options.parent||undefined)).sort((a,b)=>a.seq-b.seq),values=[...attempts.values()];
  const result:InspectionView={sessionId,runId,runs:choices.slice(0,40),nextRunBefore:choices.length>40?choices[39]!.seq:undefined,nodes:children.slice(options.offset,options.offset+40),total:children.length,next:options.offset+40<children.length?options.offset+40:undefined,
    usage:{attempts:values.length,input:values.reduce((sum,item)=>sum+(item.input??0),0),output:values.reduce((sum,item)=>sum+(item.output??0),0),cacheRead:values.reduce((sum,item)=>sum+(item.cacheRead??0),0),missingInput:values.filter(item=>item.input===null).length,missingOutput:values.filter(item=>item.output===null).length,missingCache:values.filter(item=>item.cacheRead===null).length,cost:null,unknownCostAttempts:values.length}};
  if(options.node){
    const node=nodes.get(options.node);if(!node)throw new ApiError(404,'inspection_node','此运行未记录指定调用');
    const owned=nodeEvents.get(node.id)!,ownedAttempts=values.filter(attempt=>owned.some(event=>event.attemptId===attempt.id));
    if(options.attempt&&!ownedAttempts.some(attempt=>attempt.id===options.attempt))throw new ApiError(404,'inspection_attempt','此调用未记录指定 attempt');
    const groups:Record<string,string[]>={request:['attempt.started','request.dispatched','request.blocked','request.transform'],response:['response.headers','response.chunk','model.operation.result','attempt.finished','attempt.retry'],sources:['context.snapshot','context.view','request.transform','capabilities.effective','handoff.context'],usage:['attempt.finished','attempt.retry']};
    const selected=owned.filter(event=>(!options.attempt||event.attemptId===options.attempt)&&(!options.group||groups[options.group]!.includes(event.type)));
    result.detail={node,attempts:ownedAttempts.slice(options.attemptOffset,options.attemptOffset+40),nextAttempt:options.attemptOffset+40<ownedAttempts.length?options.attemptOffset+40:undefined,eventTotal:selected.length,
      events:selected.slice(options.eventOffset,options.eventOffset+40).map(event=>({eventId:event.eventId,seq:event.seq,type:event.type,timestamp:event.timestamp,attemptId:event.attemptId,payload:safeView(event.payload),links:Object.fromEntries(Object.entries(event).filter(([key])=>['mode','targetId','runId','modelCallId','toolCallId','parentToolCallId','parentModelCallId','parentAttemptId','resourceId','resourceRevision','candidateId','validationTaskId','workflowId','stepId','frameworkTaskId'].includes(key))),artifacts:artifactRefs(event.payload),images:(['model.operation.result','codemode.finished'].includes(event.type)?payload(event).attachments??payload(event).images??[]:[]).filter((image:any)=>image.artifact?.kind==='artifact').map((image:any)=>({index:image.index,mimeType:image.mimeType,artifact:image.artifact}))})),nextEvent:options.eventOffset+40<selected.length?options.eventOffset+40:undefined};
  }
  return result;
}
