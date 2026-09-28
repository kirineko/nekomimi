import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Journal, readSession, hash } from '../journal.js';
import { exists, type Resource } from './resources.js';
import type { CustomizationHost } from './host.js';
import { hostIdentity } from './sdk.js';
import type { LifecycleEvidence, Ability } from '../shared/customization-lifecycle.js';
/** Durable evidence only. State is projected from discovery, grants and active host state. */
export class Lifecycle {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly host: CustomizationHost) {}
  private get path() { return join(this.host.catalog.workspace, '.nekomimi', 'lifecycle-journal'); }
  async record(resource: Resource, stage: LifecycleEvidence['stage'], details: Pick<LifecycleEvidence,'passed'|'sessionId'|'runId'|'contributionId'> = {}) {
    const operation = this.tail.then(async () => {
      const journal = await Journal.open(this.path);
      try { const evidence: LifecycleEvidence = { version: 1, resourceId: resource.id, revision: resource.hash, stage, at: new Date().toISOString(), host: (await hostIdentity()).build, ...details }; await journal.append('customization.lifecycle', evidence); return evidence; }
      finally { await journal.close(); }
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  async evidence(): Promise<LifecycleEvidence[]> {
    await this.tail;
    if (!await exists(this.path)) return [];
    return (await readSession(this.path)).events.filter(e => e.type === 'customization.lifecycle').map(e => e.payload as LifecycleEvidence);
  }
  async catalog(resources?: Resource[]): Promise<Ability[]> {
    const { Candidates } = await import('./candidates.js');
    const discovered = resources ?? await this.host.catalog.discover();
    const identity = await hostIdentity();
    const evidence = await this.evidence(), ui = await this.host.themes.describe(), items: Ability[] = [];
    const candidates = new Candidates(this.host.catalog.workspace);
    const failedDrafts: {id:string;error:string}[]=[];
    const drafts = await Promise.all((await candidates.list()).map(async id => { try { return { id, resource:await candidates.read(id) }; } catch(error) { failedDrafts.push({id,error:String(error)}); return undefined; } }));
    const inputs = [...discovered.filter(r => r.scope !== 'builtin').map(resource => ({resource, candidateId: undefined as string|undefined})), ...drafts.filter(d => !!d).map(d => ({resource:d.resource,candidateId:d.id}))];
    for (const {resource:r,candidateId} of inputs) {
      const grant = await this.host.catalog.grant(r), required = r.manifest?.requiredCapabilities ?? [];
      const granted = grant?.enabled && grant.trusted ? grant.capabilities ?? [] : [];
      const missing = required.filter(c => !granted.includes(c));
      const active = this.host.active?.extensions.find(e => e.resource.id === r.id);
      if(candidateId && active?.resource.hash === r.hash) continue;
      const records = evidence.filter(e => e.resourceId === r.id), current = records.filter(e => e.revision === r.hash && e.host === identity.build);
      const source = records.findLast(e => e.stage === 'created' || e.stage === 'updated');
      const times=await Promise.all([...new Set([r.path,...Object.keys(r.files??{}).map(name=>join(r.root,name)),...Object.keys(r.fileHashes??{}).map(name=>join(r.root,name))])].map(path=>stat(path).then(s=>s.mtimeMs).catch(()=>0)));
      const modified=Math.max(...times,source?Date.parse(source.at):0);
      const sourceAvailable = source?.sessionId ? await exists(join(this.host.catalog.home,'workspaces',hash(this.host.catalog.workspace),'sessions',source.sessionId,'journal.jsonl')) : undefined;
      const contributions: {type:string;id?:string;title:string}[] = [];
      if (active?.resource.hash === r.hash) {
        for (const t of active.themes ?? []) contributions.push({type:'themes',id:t.id,title:t.title});
        for (const p of active.panels) contributions.push({type:['result','sidebar'].includes(p.slot) ? 'panels' : 'views',id:p.id,title:p.title ?? p.id});
        for (const tool of active.tools) contributions.push({type:'tools',id:tool.name,title:tool.name});
        for (const provider of active.providers) contributions.push({type:'providers',id:provider.id,title:provider.id});
        for (const [id] of active.commands) contributions.push({type:'commands',id,title:id});
        for (const w of active.workflows) contributions.push({type:'workflows',id:w.id,title:w.id});
      }
      for (const type of required.filter(c=>['themes','commands','panels','views','workflows','providers','tools'].includes(c))) if (!contributions.some(c => c.type === type)) contributions.push({type,title:r.name});
      if (!contributions.length) contributions.push({type:r.kind,title:r.name});
      for (const c of contributions) {
        const applied = c.type === 'themes' && ui.active?.resourceId === r.id && ui.active.revision === r.hash && ui.active.id === c.id;
        const lastLoad = current.findLast(e => e.stage === 'loaded' || e.stage === 'load-failed');
        const phase = r.error ? 'error' : missing.length || r.status === 'untrusted' && !(grant?.enabled && grant.trusted) ? 'authorization' : lastLoad?.stage === 'load-failed' ? 'error' : this.host.receipts.some(receipt=>receipt.status==='pending'&&(!receipt.resourceId||receipt.resourceId===r.id)) ? 'pending' : candidateId && active?.resource.hash !== r.hash ? 'draft' : active?.resource.hash !== r.hash && r.manifest ? 'load' : c.type === 'themes' ? applied ? 'applied' : 'apply' : r.status;
        items.push({key:`${r.id}:${r.hash}:${c.type}:${c.id ?? ''}:${candidateId ?? ''}`,resourceId:r.id,revision:r.hash,name:c.title,scope:r.scope,type:c.type,localId:c.id,activeRevision:active?.resource.hash,missing,granted,required,phase,evidence:current.filter(e=>!e.contributionId||e.contributionId===c.id),previousEvidence:records.filter(e => e.revision !== r.hash || e.host !== identity.build).slice(-5),source,sourceAvailable,relatedSessions:[...new Set(records.map(e => e.sessionId).filter((id): id is string => !!id))],updatedAt:modified?new Date(modified).toISOString():undefined,candidateId,error:r.error});
      }
    }
    for(const draft of failedDrafts) items.push({key:`candidate:${draft.id}`,resourceId:`candidate:${draft.id}`,revision:'unknown',name:draft.id,scope:'project',type:'extension',missing:[],granted:[],required:[],phase:'error',evidence:[],candidateId:draft.id,error:draft.error});
    return items;
  }
}
