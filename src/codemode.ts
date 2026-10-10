import {Type} from 'typebox';
import type {ToolDefinition} from './context.js';
import {Journal,id,type Artifact} from './journal.js';
import {prepareToolCall,ReportedToolError} from './customization/execution.js';
import {ScriptSandbox,CODEMODE_LIMITS} from './pi/codemode.js';
import {ScriptSlots} from './codemode-budget.js';
import {readScriptState,scriptStateEvent,checkScriptState} from './codemode-state.js';
import {projectToolResult} from './tool-result-projection.js';

/** Discovery is a per-script snapshot, never an authorization grant. */
export function codemodeDefinition(journal:Journal,definitions:()=>ToolDefinition[],runSignal:AbortSignal):ToolDefinition {
 const slots=new ScriptSlots(CODEMODE_LIMITS.concurrentCalls),resources=new Map<string,ScriptSlots>();
 return {
  source:'builtin:codemode:v1',snippet:'Compose enabled tools in a bounded JavaScript sandbox.',
  guidance:['Codemode provides tools and ALL_TOOLS (including input schemas), text(), image(), and return. No host I/O or nested scripts. Child effects remain recorded even if the script fails.'],
  tool:{name:'codemode',label:'Codemode',description:'Execute an async JavaScript function body with enabled tools. Empty code returns resource limits.',
   parameters:Type.Object({code:Type.String({maxLength:CODEMODE_LIMITS.sourceBytes})}),
   execute:async(parentId,args,signal)=>{
    const {code}=args as {code:string};
    if(!code.trim())return {content:[{type:'text',text:JSON.stringify(CODEMODE_LIMITS)}],details:{limits:CODEMODE_LIMITS}};
    const active=AbortSignal.any([runSignal,...(signal?[signal]:[])]),pending=new Map<string,Promise<unknown>>();
    const priorState=await readScriptState(journal.directory,journal.events);
    let calls=0;
    const catalog=definitions().filter(d=>d.tool.name!=='codemode');
    const sandbox=new ScriptSandbox(catalog.map(definition=>({name:definition.tool.name,
     description:definition.tool.description+'\nInput JSON Schema: '+JSON.stringify(definition.tool.parameters),
     execute:(args,context)=>{
      const callId=id(),links={toolCallId:callId,parentToolCallId:parentId};
      const child=journal.withLinks(links,async()=>{
       const childSignal=AbortSignal.any([active,context.signal]);childSignal.throwIfAborted();journal.check();
       if(++calls>CODEMODE_LIMITS.childCalls)throw new Error('Script child call limit exceeded');
       await journal.append('tool.requested',{name:definition.tool.name,args,origin:'codemode'},links);
       let release:(()=>void)|undefined,releaseResource:(()=>void)|undefined;
       try{
        release=await slots.enter(childSignal);
        if(definition.source){
         let resource=resources.get(definition.source);
         if(!resource){resource=new ScriptSlots(CODEMODE_LIMITS.concurrentResourceCalls);resources.set(definition.source,resource);}
         releaseResource=await resource.enter(childSignal);
        }
        const prepared=await prepareToolCall(definition.tool,callId,args,childSignal);
        const result=await prepared.execute(childSignal);
        await journal.append('tool.result',{name:definition.tool.name,details:result,origin:'codemode'},links);
        return result;
       }catch(error){
        await journal.append('tool.failed',{name:definition.tool.name,error:journal.clean(String(error)),origin:'codemode'},links);
        if(error instanceof ReportedToolError)return error.result;
        throw error;
       }finally{releaseResource?.();release?.();}
      });
      pending.set(callId,child);void child.finally(()=>pending.delete(callId)).catch(()=>{});return child;
     },
    })));
    try{
     const result=await sandbox.execute(code,{signal:active,store:priorState.state});
     // Unawaited calls receive cancellation from the VM; do not wait forever for an uncooperative executor.
     let timer:ReturnType<typeof setTimeout>|undefined;
     await Promise.race([Promise.allSettled([...pending.values()]),new Promise<void>(resolve=>{timer=setTimeout(resolve,CODEMODE_LIMITS.cancelGraceMs);})]);
     if(timer)clearTimeout(timer);
     const unsettled=[];
     for(const callId of pending.keys()){
      const intended=journal.events.some(e=>e.type==='tool.intent'&&e.toolCallId===callId);
      unsettled.push({callId,state:intended?'unknown':'not-dispatched'});
      await journal.append(intended?'tool.execution_error':'tool.blocked',{origin:'codemode',message:'Script ended before child settled',unknown:intended,repeatsAuthorized:false},{toolCallId:callId,parentToolCallId:parentId});
     }
     const content=result.output.length?result.output:[{type:'text' as const,text:result.ok?JSON.stringify(result.value)??'Script completed':result.error.message}];
     if(unsettled.length)content.push({type:'text',text:'Unsettled child calls: '+JSON.stringify(unsettled)+'. Cancellation does not prove rollback; do not retry automatically.'});
     const full=await journal.artifact(JSON.stringify({content,details:{result,limits:CODEMODE_LIMITS,unsettled}}));
     const images=[];
     for(const [index,item] of content.entries())if(item.type==='image')images.push({index,mimeType:item.mimeType,artifact:await journal.artifact(Buffer.from(item.data,'base64'))});
     let state:Artifact|undefined,commitError:string|undefined;
     if(result.ok&&!active.aborted){
      try{
       const next=Object.assign(Object.create(null),priorState.state,result.storeWrites.set);
       for(const key of result.storeWrites.delete)delete next[key];checkScriptState(next);
       state=await journal.artifact(JSON.stringify(next));
      }catch(error){commitError=String(error);}
     }
     const payload={version:1,status:result.ok&&!commitError?'completed':'failed',limits:CODEMODE_LIMITS,result:full,images,unsettled,...(state?{state}:{}),...(commitError?{error:commitError}:{})};
     const committed=await journal.appendIf('codemode.finished',payload,()=>!active.aborted&&(!state||scriptStateEvent(journal.events)?.eventId===priorState.eventId),{toolCallId:parentId});
     if(!committed){
      commitError=active.aborted?'Script cancelled before state commit':'Script state changed concurrently; no state writes committed';
      await journal.append('codemode.finished',{...payload,status:active.aborted?'cancelled':'failed',state:undefined,error:commitError},{toolCallId:parentId});
     }
     // Keep complete output in artifacts; small return values remain convenient to inspect.
     const summary=result.ok?{ok:!commitError,...(JSON.stringify(result.value)?.length<4096?{value:result.value}:{}),...(commitError?{error:{message:commitError}}:{})}:{ok:false,error:result.error};
     let imageBytes=0;
     const selected=content.map((item,index)=>{
      if(item.type==='image'&&(imageBytes+=Buffer.byteLength(item.data))>3*1024*1024)return {type:'text' as const,text:`[Image ${index} retained in artifact:${full.sha256}; read with imageIndex:${index}]`};
      return item;
     });
     if(commitError)selected.push({type:'text',text:commitError});
     return projectToolResult({content:selected,details:{result:summary,limits:CODEMODE_LIMITS,unsettled,fullResult:full,images},...(!result.ok||commitError?{isError:true}:{})},full).result;
    }finally{await sandbox.close();}
   },
  },
 };
}
