import { hash, type JournalEvent } from '../journal.js';
import { ApiError, validId } from '../shared/protocol.js';
import { CoreInstallation } from './installation.js';
import type { CoreSwitchReceipt } from './switches.js';
import type { CoreSwitchCandidate } from './switches.js';
import type { ManagedIdentity } from './managed-child.js';
import { coreTreeManifest } from './manifest.js';
import { coreDistIdentity } from './validation.js';
import { inspectCoreStorage } from './storage-compatibility.js';

/** An old PID is never authority to send a signal. Only observe the recorded group. */
export function observeCoreGroup(group: number): 'absent' | 'present' | 'unknown' {
  if (!['darwin', 'linux'].includes(process.platform) || !Number.isSafeInteger(group) || group <= 1) return 'unknown';
  try { process.kill(-group, 0); return 'present'; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown'; }
}
export interface CoreRecoveryRequest { commandId: string; planHash: string; authorize: boolean }
export interface CoreRecoveryLaunchRequest extends CoreRecoveryRequest { selection: 'last' | 'previous' }
export interface CoreRecoveryLaunchReceipt {
  version: 1; commandId: string; planHash: string; selection: 'last' | 'previous'; status: 'started' | 'failed' | 'unknown';
  running: 'not-observed'; tasksReplayed: false; applied: false; observedBuild?: string; error?: string;
}
export interface CoreConfirmedSelection extends CoreSwitchCandidate { workspace: string; home: string; origin: string; identity: ManagedIdentity }
export interface CoreRecoveryReceipt {
  version: 1; commandId: string; planHash: string; status: 'reconciled';
  running: 'not-observed'; applied: false; tasksReplayed: false; interruptedCommands: string[];
}
/** Read-only recovery planning and explicit installation metadata reconciliation; no candidate execution. */
export class CoreRecovery {
  constructor(readonly installation: CoreInstallation) {}
  private project(events: JournalEvent[]) {
    const terminals = new Set(events.filter(event => event.type === 'core.switch.finished').map(event => (event.payload as CoreSwitchReceipt).commandId));
    const interrupted = events.filter(event => event.type === 'core.switch.intent' && !terminals.has((event.payload as any).request.commandId))
      .map(event => ({ commandId: (event.payload as any).request.commandId as string, planHash: (event.payload as any).request.planHash as string }));
    // Completed cleanups cannot turn a historical selected event into a live identity.
    const selections = events.filter(event => event.type === 'core.launch.selected').map(event => event.payload as Record<string, unknown>);
    const lastSelection = selections.at(-1);
    const previousSelection = selections.slice(0, -1).findLast(selection => selection.buildId !== lastSelection?.buildId || selection.artifactRevision !== lastSelection?.artifactRevision);
    const groups = [...new Set(events.filter(event => event.type === 'core.launch.process.started').map(event => (event.payload as { group: number }).group))]
      .map(group => ({ group, state: observeCoreGroup(group) }));
    let pendingProcess: string | undefined;
    const unobservedProcesses: string[] = [];
    for (const event of events) {
      if (event.type === 'core.launch.process.intent') { if (pendingProcess) unobservedProcesses.push(pendingProcess); pendingProcess = event.eventId; }
      if (event.type === 'core.launch.process.started' || event.type === 'core.launch.finished' && (event.payload as { dispatched?: boolean }).dispatched === false) pendingProcess = undefined;
    }
    if (pendingProcess) unobservedProcesses.push(pendingProcess);
    const head = events.at(-1);
    const plan = { version: 1, installation: this.installation.identity, head: { seq: head?.seq ?? 0, hash: head?.hash ?? '' },
      lastConfirmedSelection: lastSelection ?? null, previousConfirmedSelection: previousSelection ?? null,
      running: 'not-observed' as const, interrupted, groups, blockers: groups.filter(group => group.state !== 'absent'), unobservedProcesses,
      effect: 'installation-metadata-only', tasksReplayed: false, applied: false };
    return { ...plan, planHash: hash(JSON.stringify(plan)) };
  }
  async preview() { return this.project((await this.installation.read()).events); }
  async launchPlan(choice: 'last' | 'previous', events?: JournalEvent[]) {
    if (choice !== 'last' && choice !== 'previous') throw new ApiError(400, 'input', '恢复选择须为 last 或 previous');
    const observation = this.project(events ?? (await this.installation.read()).events);
    if (observation.blockers.length || observation.unobservedProcesses.length) throw new ApiError(409, 'core_busy', '进程清理未确认，保留只读恢复状态');
    const selection = (choice === 'last' ? observation.lastConfirmedSelection : observation.previousConfirmedSelection) as unknown as CoreConfirmedSelection | null;
    if (!selection || ['directory', 'workspace', 'home', 'origin', 'validationId', 'buildId', 'candidateId', 'artifactRevision', 'build'].some(key => typeof (selection as any)[key] !== 'string')) throw new ApiError(409, 'core_recovery', '没有完整且已确认的恢复选择');
    if ((await coreTreeManifest(selection.directory)).revision !== selection.artifactRevision || await coreDistIdentity(selection.directory) !== selection.build) throw new ApiError(409, 'core_conflict', '保留构建已变化，不能恢复启动');
    const storage = await inspectCoreStorage(selection.workspace, selection.home);
    const origin = new URL(selection.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== selection.origin) throw new ApiError(409, 'core_recovery', '历史服务地址无效');
    const plan = { version: 1, choice, selection, observationHash: observation.planHash, storage, effect: 'start-confirmed-artifact-without-task-replay', port: Number(origin.port) };
    return { ...plan, planHash: hash(JSON.stringify(plan)) };
  }
  async launchReceipt(input: CoreRecoveryLaunchRequest, events?: JournalEvent[]): Promise<CoreRecoveryLaunchReceipt | undefined> {
    if (input?.authorize !== true) throw new ApiError(403, 'core_authorization', '恢复启动需要明确授权');
    if (typeof input.commandId !== 'string' || !validId(input.commandId) || typeof input.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.planHash) || !['last', 'previous'].includes(input.selection)) throw new ApiError(400, 'input', '恢复启动确认参数无效');
    const history = events ?? (await this.installation.read()).events;
    const accepted = history.find(event => event.type === 'core.recovery.launch.intent' && (event.payload as any).request.commandId === input.commandId);
    if (!accepted) return undefined;
    const prior = (accepted.payload as any).request as CoreRecoveryLaunchRequest;
    if (prior.planHash !== input.planHash || prior.selection !== input.selection) throw new ApiError(409, 'command_conflict', '恢复启动命令确认内容不同');
    const terminal = history.find(event => event.type === 'core.recovery.launch.finished' && (event.payload as CoreRecoveryLaunchReceipt).commandId === input.commandId);
    return terminal ? terminal.payload as CoreRecoveryLaunchReceipt : { version: 1, commandId: input.commandId, planHash: input.planHash, selection: input.selection, status: 'unknown', running: 'not-observed', tasksReplayed: false, applied: false };
  }
  async reconcile(input: CoreRecoveryRequest): Promise<CoreRecoveryReceipt> {
    if (input?.authorize !== true) throw new ApiError(403, 'core_authorization', '恢复对账需要明确授权');
    if (typeof input.commandId !== 'string' || !validId(input.commandId) || typeof input.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.planHash)) throw new ApiError(400, 'input', '恢复确认参数无效');
    const before = await this.installation.read();
    if (!before.events.length) throw new ApiError(409, 'core_recovery', '此安装没有可对账的托管记录');
    const journal = await this.installation.acquire();
    try {
      const prior = journal.events.find(event => event.type === 'core.recovery.finished' && (event.payload as CoreRecoveryReceipt).commandId === input.commandId)?.payload as CoreRecoveryReceipt | undefined;
      if (prior) {
        if (prior.planHash !== input.planHash) throw new ApiError(409, 'command_conflict', '恢复命令确认内容不同');
        return prior;
      }
      const plan = this.project(journal.events);
      if (plan.planHash !== input.planHash) throw new ApiError(409, 'core_conflict', '安装记录或进程状态已变化，请重新检查');
      if (plan.blockers.length || plan.unobservedProcesses.length) throw new ApiError(409, 'core_busy', '记录的进程组仍存在或无法确认，不能进行恢复对账');
      journal.check();
      // One atomic Journal fact records the projection. Interrupted switch receipts remain
      // unknown; recovery must not invent a successful application or repeat its effects.
      const receipt: CoreRecoveryReceipt = { version: 1, commandId: input.commandId, planHash: input.planHash, status: 'reconciled', running: 'not-observed', applied: false, tasksReplayed: false, interruptedCommands: plan.interrupted.map(item => item.commandId) };
      await journal.append('core.recovery.finished', receipt);
      return receipt;
    } finally { await journal.close(); }
  }
}
