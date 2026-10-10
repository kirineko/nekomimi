import { hash, type JournalEvent } from './journal.js';
import type { contextView } from './context.js';
export function canonicalContext<T>(value:T):T {
  const canonical=(item:any):any=>Array.isArray(item)?item.map(canonical):item&&typeof item==='object'
    ?Object.fromEntries(Object.keys(item).sort().filter(key=>item[key]!==undefined).map(key=>[key,canonical(item[key])])):item;
  return canonical(JSON.parse(JSON.stringify(value)));
}
export function effectiveCapabilityRevision(mode:string,activationRevision:string|null,schemas:unknown) {
  return hash(JSON.stringify(canonicalContext({activationRevision,mode,schemas})));
}
export interface ContextMeasurementIdentity { mode:string; targetId?:string; purpose:string; capabilityRevision:string }
export function contextMeasurementIdentity(view:ReturnType<typeof contextView>,events:readonly JournalEvent[]=[],captured?:{mode:string;target?:{id:string}|null;purpose:string;capabilityRevision:string}):ContextMeasurementIdentity {
  if(captured)return {mode:captured.mode,targetId:captured.target?.id,purpose:captured.purpose,capabilityRevision:captured.capabilityRevision};
  const binding=(events.findLast(event=>event.type==='session.created')?.payload as any)?.binding ?? (events.find(event=>event.type==='durable.session')?.payload as any)?.binding;
  const latest=events.findLast(event=>event.type==='context.snapshot')?.payload as any;
  const runId=events.findLast(event=>event.type==='run.started'||event.type==='context.snapshot')?.runId;
  const activation=(events.findLast(event=>event.type==='capabilities.effective'&&(!runId||event.runId===runId))?.payload as any)?.capabilityRevision ?? null;
  const mode=binding?.mode??latest?.mode??'unbound';
  return {mode,targetId:binding?.target?.id??latest?.targetId,purpose:view.prompt.profile?.id??'unknown',capabilityRevision:effectiveCapabilityRevision(mode,activation,view.prompt.schemas)};
}
