import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { exists, safePath, type Resource, type Resources } from './resources.js';
export interface ResourceAccessState { id:string; available:boolean; present:boolean; reason:string; status:string; capturedRevision:string; currentRevision?:string }
type RootIdentity = { path:string; device:string; inode:string };
export class ResourceScopeError extends Error {
  constructor(readonly resourceIds:string[]) { super(`Resource scope revoked: ${resourceIds.join(', ')}`); }
}
async function rootIdentity(root:string):Promise<RootIdentity> { const path=await realpath(root),value=await stat(path,{bigint:true});return {path,device:String(value.dev),inode:String(value.ino)}; }
function scopeIdentity(resource:Resource, pinned:boolean) {
  const binding=resource.ruleBinding;
  const location=resource.authorityLocation ?? {root:resource.root,path:resource.path};
  return JSON.stringify([resource.kind,resource.scope,pinned && resource.packageId ? resource.source : [location.root,location.path],resource.packageId,binding && [binding.workspace,binding.root,[...binding.include].sort()]]);
}
/** Fresh metadata and authorization only. Never loads factories or replaces captured bodies. */
export class ResourceAccess {
  private constructor(readonly catalog:Resources, private captured:Map<string,Resource>, private roots:Map<string,RootIdentity|undefined>,private pinned:boolean,private trial:boolean) {}
  static async create(catalog:Resources, resources:Resource[], pinned=false, trial=false) {
    const captures=resources.map(resource=>structuredClone({...resource,text:"",files:undefined,binaryFiles:undefined,config:undefined}));
    // Earlier SDK 3 workflow snapshots retained the original manifest source,
    // but omitted this explicit location when moving execution to the copy.
    if(pinned)for(const resource of captures)if(!resource.packageId && resource.manifest && !resource.authorityLocation && isAbsolute(resource.source) && resource.source!==resource.path)
      resource.authorityLocation={root:dirname(resource.source),path:resource.source};
    const roots=new Map<string,RootIdentity|undefined>();
    for(const root of new Set(captures.flatMap(resource=>[resource.root,...(resource.authorityLocation?[resource.authorityLocation.root]:[])]))) roots.set(root,await rootIdentity(root).catch(()=>undefined));
    return new ResourceAccess(catalog,new Map(captures.map(resource=>[resource.id,resource])),roots,pinned,trial);
  }
  async inspect(ids?:ReadonlySet<string>) {
    // An escaped captured path must be attributable even when discovery itself
    // refuses to traverse that path. The caller still fails closed.
    const escaped:string[]=[];
    for(const resource of this.captured.values()) {
      if(resource.status!=='enabled' || ids && !ids.has(resource.id))continue;
      try {
        const path=await safePath(resource.root,resource.path.split('#')[0]!);
        if(resource.kind==='skill' && await exists(path) && (await lstat(path)).isSymbolicLink())escaped.push(resource.id);
      }catch {escaped.push(resource.id);}
    }
    if(escaped.length)throw new ResourceScopeError(escaped);
    const current=new Map((await this.catalog.discover()).map(resource=>[resource.id,resource]));
    const identities=new Map<string,Promise<RootIdentity|undefined>>();
    const states:ResourceAccessState[]=[];
    for(const resource of this.captured.values()) {
      if(ids && !ids.has(resource.id))continue;
      let live=current.get(resource.id);
      // Explicitly authorized candidate trials use mock host services before
      // activation. A current grant is still required; production cannot use it.
      // A candidate update can share its logical identity with an older active
      // revision. Explicit simulation must execute the captured candidate, while
      // still honoring disabled resources and current capability revocation.
      const candidateUpdate = live?.status === 'enabled' && live.hash !== resource.hash &&
        live.source === resource.source && live.kind === resource.kind && live.scope === resource.scope;
      if(this.trial && resource.manifest && (!live || candidateUpdate)) {
        const grant=await this.catalog.grant(resource);
        if(grant?.enabled && grant.trusted && !resource.manifest.requiredCapabilities?.some(capability=>!grant.capabilities?.includes(capability)))live=resource;
      }
      let reason=resource.status!=='enabled'?'not-activated':!live?'unavailable':live.status!=='enabled'?live.status:scopeIdentity(resource,this.pinned)!==scopeIdentity(live,this.pinned)?'scope-changed':'available';
      if(reason==='available') {
        if(!identities.has(resource.root))identities.set(resource.root,rootIdentity(resource.root).catch(()=>undefined));
        const identity=await identities.get(resource.root),captured=this.roots.get(resource.root);
        if(!identity || !captured || JSON.stringify(identity)!==JSON.stringify(captured))reason='scope-changed';
        else {
          try {if(!await exists(await safePath(resource.root,resource.path.split('#')[0]!)))reason='unavailable';}
          catch {reason='scope-changed';}
        }
        if(reason==='available' && resource.authorityLocation) {
          const original=await rootIdentity(resource.authorityLocation.root).catch(()=>undefined),capturedOriginal=this.roots.get(resource.authorityLocation.root);
          if(!original || !capturedOriginal || JSON.stringify(original)!==JSON.stringify(capturedOriginal))reason='scope-changed';
        }
        if(reason==='available' && ['extension','mcp','provider','workflow','panel'].includes(resource.kind)) {
          const grant=await this.catalog.grant(resource);
          if(!grant?.enabled || !grant.trusted || resource.manifest?.requiredCapabilities?.some(capability=>!grant.capabilities?.includes(capability)))reason='permissions-revoked';
        }
      }
      states.push({id:resource.id,available:reason==='available',present:!!live && reason!=='scope-changed',reason,status:reason==='available'?'enabled':live?.status==='disabled'?'disabled':reason,capturedRevision:resource.hash,currentRevision:live?.hash});
    }
    return states;
  }
  async assert(ids:Iterable<string>) {
    const selected=new Set(ids);if(!selected.size)return;
    for(const id of selected)if(!this.captured.has(id))throw new Error(`Resource unavailable in captured activation: ${id}`);
    const states=await this.inspect(selected),blocked=states.filter(state=>!state.available);
    if(blocked.length)throw new Error(`Resource authorization or scope revoked, or source missing: ${blocked.map(state=>`${state.id} (${state.reason})`).join(', ')}`);
  }
}
