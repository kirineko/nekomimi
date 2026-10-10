import {readArtifact,type JournalEvent,type Artifact} from './journal.js';
import {CODEMODE_LIMITS} from './pi/codemode.js';
export function scriptStateEvent(events:readonly JournalEvent[]){
 return events.findLast(e=>(e.type==='codemode.finished'&&(e.payload as any).status==='completed'||e.type==='codemode.state_seed')&&(e.payload as any).state);
}
export async function readScriptState(directory:string,events:readonly JournalEvent[]):Promise<{state:Record<string,unknown>;eventId:string|undefined}>{
 const event=scriptStateEvent(events),artifact=(event?.payload as {state?:Artifact}|undefined)?.state;
 if(!artifact)return {state:{},eventId:undefined};
 const text=(await readArtifact(directory,artifact)).toString(),state=JSON.parse(text);
 checkScriptState(state);return {state:state as Record<string,unknown>,eventId:event!.eventId};
}
export function checkScriptState(state:unknown):asserts state is Record<string,unknown>{
 if(!state||typeof state!=='object'||Array.isArray(state)||JSON.stringify(state).length>CODEMODE_LIMITS.storeTotalChars||
  Object.values(state).some(v=>(JSON.stringify(v)?.length??0)>CODEMODE_LIMITS.storeValueChars))throw Error('Script state exceeds its fixed limits');
}
