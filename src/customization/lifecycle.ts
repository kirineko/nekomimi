import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Journal, readSession, hash } from '../journal.js';
import { exists, type Resource } from './resources.js';
import type { CustomizationHost } from './host.js';
import { hostIdentity } from './sdk.js';
import { SDK_VERSION } from './types.js';
import type { LifecycleEvidence, Ability } from '../shared/customization-lifecycle.js';
/** Durable evidence only. State is projected from discovery, grants and active host state. */
export class Lifecycle {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly host: CustomizationHost) {}
  private get path() { return join(this.host.catalog.workspace, '.nekomimi', 'lifecycle-journal'); }
  async record(resource: Resource, stage: LifecycleEvidence['stage'], details: Pick<LifecycleEvidence,'passed'|'sessionId'|'runId'|'contributionId'|'status'|'check'|'sourceBinding'|'diagnostics'> = {}) {
    const operation = this.tail.then(async () => {
      const journal = await Journal.open(this.path);
      try {
        const identity = await hostIdentity();
        const environment = { node: process.version, platform: process.platform, arch: process.arch, sdkVersion: SDK_VERSION, hostBuild: identity.build };
        const status = details.status ?? (details.passed === undefined ? "observed" : details.passed ? "passed" : "failed");
        const evidence: LifecycleEvidence = { version: 1, resourceId: resource.id, revision: resource.hash, stage, at: new Date().toISOString(), host: identity.build, ...details, ...(details.sourceBinding ? { sessionId: details.sourceBinding.sessionId } : {}), status, environment };
        if (stage === "static" || stage === "simulation" || stage === "preview" || stage === "host") evidence.verification = {
          stage, status, hostIntegration: stage !== "host" ? "not_run" : status === "passed" ? "passed" : status === "failed" ? "failed" : "observed",
          resourceId: resource.id, resourceRevision: resource.hash, environment, ...(details.check ? { check: details.check } : {}),
        };
        await journal.append('customization.lifecycle', evidence); return evidence;
      }
      finally { await journal.close(); }
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  async evidence(): Promise<LifecycleEvidence[]> {
    await this.tail;
    if (!await exists(this.path)) return [];
    return (await readSession(this.path)).events.filter(e => e.type === 'customization.lifecycle').map(e => e.payload as LifecycleEvidence);
  }
  async records() {
    await this.tail;
    if (!await exists(this.path)) return [];
    return (await readSession(this.path)).events.filter(event => event.type === 'customization.lifecycle');
  }
  async catalog(resources?: Resource[]): Promise<Ability[]> {
    const { Candidates } = await import('./candidates.js');
    const discovered = resources ?? await this.host.catalog.discover();
    const identity = await hostIdentity();
    const evidence = await this.evidence(), ui = await this.host.themes.describe(), items: Ability[] = [];
    const candidates = new Candidates(this.host.catalog.workspace);
    const failedDrafts: {id:string;error:string}[]=[];
    const drafts = await Promise.all((await candidates.list()).map(async id => { try { return { id, resource:await candidates.read(id), origin:await candidates.origin(id) }; } catch(error) { failedDrafts.push({id,error:String(error)}); return undefined; } }));
    const inputs = [...discovered.filter(r => r.scope !== 'builtin').map(resource => ({resource, candidateId: undefined as string|undefined})), ...drafts.filter(d => !!d).map(d => ({resource:d.resource,candidateId:d.id}))];
    for (const {resource:r,candidateId} of inputs) {
      const grant = await this.host.catalog.grant(r), required = r.manifest?.requiredCapabilities ?? [];
      const granted = grant?.enabled && grant.trusted ? grant.capabilities ?? [] : [];
      const missing = required.filter(c => !granted.includes(c));
      const active = this.host.active?.extensions.find(e => e.resource.id === r.id);
      if(candidateId && active?.resource.hash === r.hash) continue;
      const records = evidence.filter(e => e.resourceId === r.id);
      const matches = (e: LifecycleEvidence) => e.revision === r.hash && e.host === identity.build && e.environment?.node === process.version && e.environment.platform === process.platform && e.environment.arch === process.arch && e.environment.sdkVersion === SDK_VERSION;
      const current = records.filter(matches);
      const source = records.findLast(e => e.stage === 'created' || e.stage === 'updated');
      const times=await Promise.all([...new Set([r.path,...Object.keys(r.files??{}).map(name=>join(r.root,name)),...Object.keys(r.fileHashes??{}).map(name=>join(r.root,name))])].map(path=>stat(path).then(s=>s.mtimeMs).catch(()=>0)));
      const modified=Math.max(...times,source?Date.parse(source.at):0);
      const candidateOrigin = candidateId ? drafts.find(d => d?.id === candidateId)?.origin : undefined;
      const sourceBinding = source?.sourceBinding ?? candidateOrigin?.session;
      const origin = sourceBinding ? { sessionId: sourceBinding.sessionId, runId: source?.runId ?? candidateOrigin?.runId, ownerWorkspace: sourceBinding.ownerWorkspace, target: sourceBinding.target, scope: r.scope as "project" | "user" } : undefined;
      const changeOrigin = source?.revision === r.hash && source.sourceBinding ? "controlled" : source ? "observed" : "unknown";
      const changeKind = changeOrigin === "controlled" ? source!.stage as "created" | "updated" : source && source.revision !== r.hash ? "observed-update" : "unknown";
      const sourceId = origin?.sessionId ?? source?.sessionId;
      const sourceAvailable = sourceId ? await exists(join(this.host.catalog.home,'workspaces',hash(origin?.ownerWorkspace ?? this.host.catalog.workspace),'sessions',sourceId,'journal.jsonl')) : undefined;
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
        items.push({key:`${r.id}:${r.hash}:${c.type}:${c.id ?? ''}:${candidateId ?? ''}`,resourceId:r.id,revision:r.hash,name:c.title,scope:r.scope,type:c.type,localId:c.id,activeRevision:active?.resource.hash,missing,granted,required,phase,evidence:current.filter(e=>!e.contributionId||e.contributionId===c.id),previousEvidence:records.filter(e => !matches(e)).slice(-5),source,origin,changeOrigin,changeKind,sourceAvailable,relatedSessions:[...new Set([...records.map(e => e.sessionId),origin?.sessionId].filter((id): id is string => !!id))],updatedAt:modified?new Date(modified).toISOString():undefined,candidateId,error:r.error});
      }
    }
    for(const draft of failedDrafts) items.push({key:`candidate:${draft.id}`,resourceId:`candidate:${draft.id}`,revision:'unknown',name:draft.id,scope:'project',type:'extension',missing:[],granted:[],required:[],phase:'error',evidence:[],candidateId:draft.id,error:draft.error});
    return items;
  }
}
