import { hash, type Journal } from '../journal.js';
import { ApiError, validId } from '../shared/protocol.js';
import { API_VERSION } from '../shared/protocol.js';
import { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from '../shared/versions.js';
import { reserveCoreOperations } from './operation-fence.js';
import type { ManagedIdentity } from './managed-child.js';
import type { CoreSwitchReadiness } from './switch-gate.js';
export interface CoreSwitchCandidate { validationId: string; buildId: string; candidateId: string; artifactRevision: string; directory: string; build: string }
export interface CoreSwitchRequest { commandId: string; planHash: string; validationId: string; artifactRevision: string; authorize: boolean }
export interface CoreSwitchReceipt { version: 1; commandId: string; planHash: string; status: 'applied' | 'failed' | 'unknown'; applied: boolean; actualBuild?: string; error?: string }
export type CoreSwitchPhase = 'intent-written' | 'old-stopped' | 'candidate-ready' | 'selection-written' | 'receipt-written';
export interface CoreSwitchRuntime {
  installationId: string; workspace: string; home: string; journal: Journal;
  current(): { identity: ManagedIdentity; artifactRevision: string; buildId: string } | undefined;
  inspect(validationId: string): Promise<CoreSwitchCandidate>;
  prepare(token: string): Promise<CoreSwitchReadiness>;
  release(token: string): Promise<void>;
  replace(candidate: CoreSwitchCandidate, token: string): Promise<ManagedIdentity>;
  /** Storage-boundary fault injection for integration verification; never a CLI/environment option. */
  checkpoint?(phase: CoreSwitchPhase): Promise<void>;
}
export class CoreSwitches {
  private pending?: { request: CoreSwitchRequest; done: Promise<CoreSwitchReceipt> };
  constructor(private readonly runtime: CoreSwitchRuntime) {}
  get busy() { return !!this.pending; }
  async settled() { await this.pending?.done.catch(() => {}); }
  async preview(validationId: string) {
    if (typeof validationId !== 'string' || !validId(validationId)) throw new ApiError(400, 'input', '候选验证 ID 无效');
    const current = this.runtime.current();
    if (!current) throw new ApiError(503, 'core_unavailable', '当前没有已确认运行的托管宿主');
    const candidate = await this.runtime.inspect(validationId);
    const plan = { version: 1, installationId: this.runtime.installationId, from: current, candidate,
      impact: { workspace: this.runtime.workspace, home: this.runtime.home, action: 'replace-supervised-web-process', activeInstallationFilesChanged: false, healthFailure: 'restore-retained-version-only-after-storage-admission' },
      contracts: { api: API_VERSION, sdk: SDK_CONTRACT_VERSION, data: DATA_FORMAT_VERSION }, node: process.version, platform: process.platform, arch: process.arch };
    return { ...plan, planHash: hash(JSON.stringify(plan)) };
  }
  receipt(commandId: string): CoreSwitchReceipt | undefined {
    if (typeof commandId !== 'string' || !validId(commandId)) throw new ApiError(400, 'input', '切换命令 ID 无效');
    const intent = this.runtime.journal.events.find(event => event.type === 'core.switch.intent' && (event.payload as any).request.commandId === commandId);
    if (!intent) return undefined;
    const terminal = this.runtime.journal.events.find(event => event.type === 'core.switch.finished' && (event.payload as CoreSwitchReceipt).commandId === commandId);
    return terminal ? terminal.payload as CoreSwitchReceipt : { version: 1, commandId, planHash: (intent.payload as any).request.planHash, status: 'unknown', applied: false, actualBuild: this.runtime.current()?.identity.build, error: 'Accepted switch has no durable terminal; it will not run again automatically' };
  }
  switch(request: CoreSwitchRequest): Promise<CoreSwitchReceipt> {
    if (!request || request.authorize !== true) return Promise.reject(new ApiError(403, 'core_authorization', '核心切换需要明确执行授权'));
    if ([request.commandId, request.validationId, request.planHash, request.artifactRevision].some(value => typeof value !== 'string') || !validId(request.commandId) || !validId(request.validationId) || !/^[a-f0-9]{64}$/.test(request.planHash) || !/^[a-f0-9]{64}$/.test(request.artifactRevision)) return Promise.reject(new ApiError(400, 'input', '核心切换确认参数无效'));
    const same = (a: CoreSwitchRequest, b: CoreSwitchRequest) => a.planHash === b.planHash && a.validationId === b.validationId && a.artifactRevision === b.artifactRevision;
    if (this.pending) {
      if (this.pending.request.commandId === request.commandId) {
        if (same(this.pending.request, request)) return this.pending.done;
        return Promise.reject(new ApiError(409, 'command_conflict', '同一切换命令的确认内容不同'));
      }
      return Promise.reject(new ApiError(409, 'core_busy', '另一个核心切换仍在进行'));
    }
    const intent = this.runtime.journal.events.find(event => event.type === 'core.switch.intent' && (event.payload as any).request.commandId === request.commandId);
    if (intent) {
      if (!same((intent.payload as any).request, request)) return Promise.reject(new ApiError(409, 'command_conflict', '同一切换命令的确认内容不同'));
      return Promise.resolve(this.receipt(request.commandId)!);
    }
    const owned = { ...request };
    const done = this.execute(owned).finally(() => { this.pending = undefined; });
    this.pending = { request: owned, done };
    return done;
  }
  private async execute(request: CoreSwitchRequest): Promise<CoreSwitchReceipt> {
    const plan = await this.preview(request.validationId);
    if (plan.planHash !== request.planHash || plan.candidate.artifactRevision !== request.artifactRevision) throw new ApiError(409, 'core_conflict', '候选或当前宿主已变化，请重新预览确认');
    const reservation = await reserveCoreOperations(this.runtime.home);
    let frozen = false, accepted = false, replaced = false;
    try {
      const ready = await this.runtime.prepare(request.commandId);
      if (!ready.ready) throw new ApiError(409, 'core_busy', `核心切换被阻止：${ready.blockers.map(blocker => `${blocker.kind}${blocker.id ? '/' + blocker.id : ''}`).join(', ')}`);
      frozen = true; reservation.check();
      if ((await this.preview(request.validationId)).planHash !== request.planHash) throw new ApiError(409, 'core_conflict', '候选在确认后变化');
      await this.runtime.journal.append('core.switch.intent', { request, plan }, { candidateId: plan.candidate.candidateId }); accepted = true;
      await this.runtime.checkpoint?.('intent-written');
      reservation.check();
      const actual = await this.runtime.replace(plan.candidate, request.commandId); replaced = true;
      if (actual.build !== plan.candidate.build) throw Error('Replacement identity mismatch');
      const receipt: CoreSwitchReceipt = { version: 1, commandId: request.commandId, planHash: request.planHash, status: 'applied', applied: true, actualBuild: actual.build };
      await this.runtime.journal.append('core.switch.finished', receipt, { candidateId: plan.candidate.candidateId });
      await this.runtime.checkpoint?.('receipt-written').catch(() => {});
      return receipt;
    } catch (error) {
      if (!accepted) throw error;
      const receipt: CoreSwitchReceipt = { version: 1, commandId: request.commandId, planHash: request.planHash, status: error instanceof ApiError && error.code === 'core_unknown' ? 'unknown' : 'failed', applied: false, actualBuild: this.runtime.current()?.identity.build, error: this.runtime.journal.clean(String(error)) };
      await this.runtime.journal.append('core.switch.finished', receipt, { candidateId: plan.candidate.candidateId }); return receipt;
    } finally {
      try { if (frozen && !replaced) await this.runtime.release(request.commandId); } finally { await reservation.release(); }
    }
  }
}
