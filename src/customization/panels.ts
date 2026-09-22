import { Value } from 'typebox/value';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Journal, id, hash } from '../journal.js';
import type { CustomizationHost } from './host.js';
import type { BuiltPanel } from './panel-build.js';
import type { Json } from './types.js';
import { Candidates } from './candidates.js';
import { ExtensionProcess } from './process.js';
import { panelDocument } from './panel-document.js';
interface Instance {candidatePreview?:boolean;html:string; nonce:string; panel:BuiltPanel; expires:number; window:number; messages:number; lastId:number; workflow?:{id:string;waitId?:string;revision:number}; preview:boolean}
export class Panels {
  private instances = new Map<string,Instance>();
  constructor(readonly host:CustomizationHost) {}
  catalog() {return this.host.active?.extensions.flatMap(e=>e.panels.map(({bundle,css,resource,...p})=>({...p,resourceId:resource.id,revision:resource.hash}))) ?? [];}
  private async authorized(panel:BuiltPanel) {
    const grant = await this.host.catalog.grant(panel.resource);
    if (!grant?.enabled || !grant.trusted || !grant.capabilities?.includes('panels')) throw new Error('Panel authorization revoked');
    const current = this.host.active?.extensions.flatMap(e=>e.panels).find(p=>p.resource.id===panel.resource.id && p.id===panel.id);
    if (!current || current.resource.hash!==panel.resource.hash || current.bundleHash!==panel.bundleHash) throw new Error('Panel revision no longer active');
  }
  async mount(resourceId:string, panelId:string, revision:string, props:Json, workflowId?:string, preview=false, themeName?:string) {
    for (const [key,value] of this.instances) if(value.expires<Date.now()) this.instances.delete(key);
    if(this.instances.size>=64) throw new Error('Panel instance limit');
    const panel=this.host.active?.extensions.flatMap(e=>e.panels).find(p=>p.resource.id===resourceId && p.id===panelId && p.resource.hash===revision);
    if(!panel) throw new Error('Panel revision unavailable; use saved fallback');
    await this.authorized(panel);
    if(Buffer.byteLength(JSON.stringify(props))>32768 || !Value.Check(panel.propsSchema,props)) throw new Error('Panel props schema/size invalid');
    if(themeName && !Object.hasOwn(panel.themes ?? {},themeName)) throw new Error('Unknown panel theme');
    const theme=themeName?panel.themes![themeName]:panel.theme;
    let workflow:Instance['workflow'];
    if(workflowId) {const state=await this.host.workflows.inspect(workflowId); if(state.resourceId!==resourceId) throw new Error('Panel workflow resource mismatch'); workflow={id:workflowId,waitId:state.wait?.id,revision:state.revision};}
    return this.attach(panel,props,workflow,preview,theme);
  }
  private async attach(panel:BuiltPanel,props:Json,workflow:Instance['workflow'],preview:boolean,theme:BuiltPanel['theme'],candidatePreview=false) {
    for(const [key,value] of this.instances)if(value.expires<Date.now())this.instances.delete(key);
    if(this.instances.size>=64)throw new Error('Panel instance limit');
    const resourceId=panel.resource.id,panelId=panel.id,revision=panel.resource.hash;
    const instanceId=id(),nonce=randomBytes(24).toString('base64url');
    const journal=await Journal.open(join(this.host.catalog.workspace,'.nekomimi/panel-history'));
    try {await journal.append('panel.mounted',{uiVersion:1,instanceId,panelId,revision,bundleHash:panel.bundleHash,fallback:panel.fallback,props:await journal.artifact(JSON.stringify(props)),workflow,preview},{resourceId,resourceRevision:revision,instanceId});} finally {await journal.close();}
    const html=panelDocument({instanceId,nonce,bundle:panel.bundle,css:panel.css,props,actions:preview?[]:panel.actions,theme});
    this.instances.set(instanceId,{candidatePreview,html,nonce,panel,workflow,preview,expires:Date.now()+30*60_000,window:Date.now(),messages:0,lastId:0});
    return {instanceId,nonce,url:`/api/v1/panels/${instanceId}/frame`,fallback:panel.fallback,bundleHash:panel.bundleHash};
  }
  async previewCandidate(candidateId:string,expectedHash:string,panelId:string|undefined,props:Json,authorize:boolean) {
    if(!authorize)throw new Error('Candidate panel factory preview requires explicit trusted Node authorization');
    const {resource}=await new Candidates(this.host.catalog.workspace).prepare(candidateId,expectedHash);
    const history=await Journal.open(join(this.host.catalog.workspace,'.nekomimi/panel-history'));
    try{await history.append('panel.preview.intent',{candidateId,contentHash:expectedHash,panelId,simulated:true,boundary:'Trusted Node factory; no host bridge actions'},{resourceId:resource.id,resourceRevision:resource.hash});}finally{await history.close();}
    const process=new ExtensionProcess(resource,this.host.catalog);
    try {
      const registrations=await process.start(),panel=registrations.flatMap(r=>r.panels).find(p=>!panelId||p.id===panelId);
      if(!panel || Buffer.byteLength(JSON.stringify(props))>32768 || !Value.Check(panel.propsSchema,props))throw new Error('Candidate panel identity or props schema invalid');
      const {bundle,css,resource:owner,...descriptor}=panel;
      return {panel:{...descriptor,resourceId:owner.id,revision:owner.hash},frame:await this.attach(panel,props,undefined,true,panel.theme,true)};
    }finally{await process.stop();}
  }
  async document(instanceId:string) {
    const instance=this.instances.get(instanceId);
    if(!instance || instance.expires<Date.now()) throw new Error('Panel instance expired');
    if(!instance.candidatePreview)await this.authorized(instance.panel);
    return {html:instance.html,nonce:instance.nonce};
  }
  unmount(instanceId:string) {this.instances.delete(instanceId); return {status:'closed'};}
  async action(instanceId:string, sequence:number, action:string, value:Json) {
    const instance=this.instances.get(instanceId);
    if(!instance || instance.expires<Date.now()) throw new Error('Panel instance expired');
    if(Date.now()-instance.window>=1000) {instance.window=Date.now();instance.messages=0;}
    if(++instance.messages>30 || !Number.isSafeInteger(sequence) || sequence<=instance.lastId || Buffer.byteLength(JSON.stringify(value))>32768) throw new Error('Panel message identity/rate/size invalid');
    instance.lastId=sequence;
    if(instance.preview || !instance.panel.actions.includes(action) || !instance.workflow) throw new Error('Panel action not authorized or workflow unbound');
    await this.authorized(instance.panel);
    const bound=instance.workflow, state=await this.host.workflows.inspect(bound.id);
    if(action==='workflow.state') return {id:state.id,status:state.status,revision:state.revision,wait:state.wait,output:state.output};
    if(action==='workflow.answer') {
      if(!bound.waitId) throw new Error('Panel has no bound interaction');
      const digest=hash(JSON.stringify([bound.id,bound.waitId,'answer',value])), commandId=`${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
      // Journal answer CAS and deduplication are authoritative across iframe rebuilds/windows.
      const result=await this.host.workflows.answer(bound.id,bound.waitId,commandId,value,bound.revision);
      return {id:result.id,status:result.status,revision:result.revision};
    }
    if(action==='workflow.cancel') return this.host.workflows.cancel(bound.id,bound.revision);
    throw new Error('Unsupported panel action');
  }
  close() {this.instances.clear();}
}
