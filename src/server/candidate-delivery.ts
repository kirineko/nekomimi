import { Journal, hash, readSession } from '../journal.js';
import { Candidates, type CandidateDelivery } from '../customization/candidates.js';
import type { CustomizationHost } from '../customization/host.js';
import { deliveryContentHash, validateDeliveryVersions } from '../session/delivery.js';
import { checkSessionTarget } from '../session/identity.js';
import { ApiError, type DeliverySnapshot } from '../shared/protocol.js';
import { DATA_FORMAT_VERSION, IncompatibleFormatError, requireNewContract } from '../storage/format.js';

export interface ProjectDeliveryContext {
  delivery: CandidateDelivery;
  snapshot: DeliverySnapshot;
  sourceHost: CustomizationHost;
  workHost: CustomizationHost;
}
export interface ProjectDeliveryRequest {
  sourceSessionId: string;
  targetSessionId: string;
  handoffId: string;
  candidateId: string;
  contentHash: string;
  planHash: string;
  commandId: string;
}
export interface ProjectDeliveryResult { id: string; status: 'activated' | 'failed' | 'unknown'; resourceId?: string; contentHash: string; error?: string }
export async function previewProjectDelivery(context: ProjectDeliveryContext) {
  const { delivery, snapshot, sourceHost, workHost } = context;
  if (delivery.source.mode !== 'create' || delivery.target.mode !== 'work' ||
      delivery.source.ownerWorkspace !== delivery.target.ownerWorkspace ||
      delivery.source.target.root !== sourceHost.catalog.workspace || delivery.target.target.root !== workHost.catalog.workspace ||
      delivery.source.target.scope !== 'project' || snapshot.scope !== 'project' ||
      snapshot.candidateId !== delivery.candidateId || snapshot.revision !== delivery.contentHash ||
      snapshot.developmentTargetId !== delivery.source.target.id || snapshot.workTargetId !== delivery.target.target.id)
    throw new ApiError(403,'delivery_scope','交付快照与来源或工作目标不匹配');
  await checkSessionTarget(delivery.source,workHost.catalog.home);
  await checkSessionTarget(delivery.target,workHost.catalog.home);
  await validateDeliveryVersions(sourceHost,[snapshot]);
  const resource = await new Candidates(delivery.source.target.root).read(delivery.candidateId);
  if (deliveryContentHash(resource) !== snapshot.contentHash) throw new ApiError(409,'delivery_changed','候选内容已变化');
  const settings = await workHost.catalog.decisions(), store = new Candidates(workHost.catalog.workspace);
  const plan = { ...delivery, name: resource.name, host: snapshot.host,
    requiredCapabilities: resource.manifest?.requiredCapabilities ?? [],
    settingsRevision: settings.revision, activeRevision: await store.revision() };
  return { ...plan, planHash: hash(JSON.stringify(plan)), busy: workHost.busy,
    appliesTo: workHost.catalog.workspace, executesCommand: false as const };
}
/** An intent without a terminal record is read as unknown, never dispatched again. */
export async function applyProjectDelivery(directory: string, request: ProjectDeliveryRequest, resolve: () => Promise<ProjectDeliveryContext>, secrets: string[] = []): Promise<ProjectDeliveryResult> {
  const requestHash = hash(JSON.stringify(request));
  const recorded = (events: Awaited<ReturnType<typeof readSession>>['events']): ProjectDeliveryResult | undefined => {
    if (events.length) {
      if (events[0]?.type !== 'candidate.delivery.session') throw new IncompatibleFormatError(directory);
      requireNewContract(events[0].payload, 'candidate', directory);
    }
    const intent = events.find(event => event.type === 'candidate.delivery.intent' && (event.payload as {commandId?:string}).commandId === request.commandId);
    if (!intent) return;
    if ((intent.payload as {requestHash:string}).requestHash !== requestHash) throw new ApiError(409,'delivery_command_conflict','交付命令编号已用于其他参数');
    const finished = events.find(event => event.type === 'candidate.delivery.finished' && (event.payload as {commandId?:string}).commandId === request.commandId);
    return finished ? (finished.payload as {result:ProjectDeliveryResult}).result : {id:request.commandId,status:'unknown',contentHash:request.contentHash};
  };
  try { const result = recorded((await readSession(directory)).events); if (result) return result; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const context = await resolve(), plan = await previewProjectDelivery(context);
  if (plan.planHash !== request.planHash) throw new ApiError(409,'delivery_plan_conflict','交付计划已变化，请重新审阅');
  if (plan.busy) throw new ApiError(409,'busy','工作项目有活动任务，请等待空闲后重新审阅');
  const journal = await Journal.open(directory, { secrets });
  try {
    const existing = recorded(journal.events); if (existing) return existing;
    if (!journal.events.length) await journal.append('candidate.delivery.session',{formatVersion:DATA_FORMAT_VERSION});
    await journal.append('candidate.delivery.intent',{commandId:request.commandId,requestHash,plan}, {mode:'create',targetId:plan.source.target.id,handoffId:plan.handoffId});
    let result:ProjectDeliveryResult;
    try {
      const receipt = await context.workHost.requestProjectDelivery(context.delivery,plan.settingsRevision,plan.activeRevision);
      await context.workHost.reload(receipt);
      result = {id:request.commandId,status:receipt.status === 'activated' ? 'activated' : receipt.status === 'pending' ? 'unknown' : 'failed',resourceId:receipt.resourceId,contentHash:request.contentHash,...(receipt.error ? {error:journal.clean(receipt.error)} : {})};
    } catch (error) { result = {id:request.commandId,status:'failed',contentHash:request.contentHash,error:journal.clean(String(error))}; }
    await journal.append('candidate.delivery.finished',{commandId:request.commandId,result}, {mode:'create',targetId:plan.source.target.id,handoffId:plan.handoffId});
    return result;
  } finally { await journal.close(); }
}
