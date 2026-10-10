import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { id, hash } from '../journal.js';
import { ApiError } from '../shared/protocol.js';
import { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from '../shared/versions.js';
import { CoreCandidates } from './candidates.js';
import { coreOperationBlockers, reserveCoreOperations } from './operation-fence.js';
import { CoreSwitches, type CoreSwitchCandidate, type CoreSwitchPhase } from './switches.js';
import { startManagedChild, type ManagedChild, type ManagedIdentity } from './managed-child.js';
import { inspectDataHome } from '../storage/format.js';
import { CoreInstallation } from './installation.js';
import { CoreBuilds } from './builds.js';
import { CoreValidations } from './validations.js';
import { coreDistIdentity } from './validation.js';
import { coreTreeManifest } from './manifest.js';
import { CoreRecovery, type CoreRecoveryLaunchRequest, type CoreRecoveryLaunchReceipt } from './recovery.js';
import { type CoreProcessResult } from './build-process.js';

export async function coreLaunchInfo(builds: CoreBuilds, buildId: string, installation?: CoreInstallation) {
  const checked = await builds.inspect(buildId);
  if (!checked.validForCurrent || !checked.result.artifact) throw new ApiError(409, 'core_conflict', '候选构建已失效，请重新构建后核验启动路径');
  const owner = installation ?? await CoreInstallation.locate();
  return {
    installation: owner.identity, currentMode: 'unmanaged', switchSupported: false, applied: false,
    managedLaunchSupported: owner.identity.entry.endsWith('.js') && ['darwin', 'linux'].includes(process.platform),
    buildId, artifactRevision: checked.result.artifact.revision,
    manual: { executable: process.execPath, args: [join(checked.result.artifact.directory, 'dist/cli.js'), 'web', '--workspace', await realpath(builds.candidates.ownerWorkspace), '--home', builds.candidates.home, '--no-open'] },
    explanation: 'An ordinary web/source process cannot switch itself. Use the explicit candidate command or an authorized core launch with a passed validation; neither changes PATH or the global installation.',
  };
}
export interface ManagedCoreHandle {
  launchId: string; installation: CoreInstallation; readonly origin: string; readonly url: string; readonly identity: ManagedIdentity;
  done: Promise<CoreProcessResult>; stop(): Promise<CoreProcessResult>; control(action: string, value?: Record<string, unknown>): Promise<unknown>;
}
const selectValidatedCore = async (store: CoreValidations, validationId: string, switching = false): Promise<CoreSwitchCandidate> => {
    const verified = await store.inspect(validationId);
    if (switching && !verified.result.report?.checks.includes('core-switch-control')) throw Error('Candidate has not passed the controlled switch protocol check');
    if (!verified.validForCurrent) throw Error('Candidate requires a current passed isolated validation and confirmed artifact revision');
    const build = await store.builds.inspect(verified.result.buildId);
    if (!build.validForCurrent || !build.result.artifact || build.result.artifact.revision !== verified.result.artifactRevision) throw Error('Core build changed');
    return { validationId, buildId: build.result.buildId, candidateId: verified.result.candidateId, artifactRevision: build.result.artifact.revision, directory: build.result.artifact.directory, build: await coreDistIdentity(build.result.artifact.directory) };
  };

export async function launchManagedCore(validations: CoreValidations, input: { validationId: string; artifactRevision: string; authorize: boolean; port?: number }, options: { installation?: CoreInstallation; signal?: AbortSignal; checkpoint?: (phase: CoreSwitchPhase) => Promise<void> } = {}): Promise<ManagedCoreHandle> {
  if (input.authorize !== true) throw Error('Explicit managed candidate launch authorization required');
  const installation = options.installation ?? await CoreInstallation.locate();
  if (!installation.identity.entry.endsWith('.js') || !['darwin', 'linux'].includes(process.platform)) throw Error('This launch mode cannot supervise candidates; use core launch-info for explicit manual startup');
  const port = input.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid managed port');
  const initial = await selectValidatedCore(validations, input.validationId);
  if (initial.artifactRevision !== input.artifactRevision) throw Error('Candidate requires confirmed artifact revision');
  const workspace = await realpath(validations.builds.candidates.ownerWorkspace), home = validations.builds.candidates.home;
  return runManagedCore(initial, workspace, home, installation, { ...options, port });
}
export async function resumeManagedCore(installation: CoreInstallation, input: CoreRecoveryLaunchRequest, options: { signal?: AbortSignal; checkpoint?: (phase: CoreSwitchPhase) => Promise<void> } = {}): Promise<ManagedCoreHandle | CoreRecoveryLaunchReceipt> {
  const recovery = new CoreRecovery(installation), prior = await recovery.launchReceipt(input);
  if (prior) return prior;
  const plan = await recovery.launchPlan(input.selection);
  if (plan.planHash !== input.planHash) throw new ApiError(409, 'core_conflict', '恢复计划已变化，请重新检查确认');
  const reservation = await reserveCoreOperations(plan.selection.home);
  try { reservation.check(); return await runManagedCore(plan.selection, plan.selection.workspace, plan.selection.home, installation, { ...options, port: plan.port, recovery: input }); }
  finally { await reservation.release(); }
}
async function runManagedCore(initial: CoreSwitchCandidate, workspace: string, home: string, installation: CoreInstallation, options: { signal?: AbortSignal; port: number; recovery?: CoreRecoveryLaunchRequest; checkpoint?: (phase: CoreSwitchPhase) => Promise<void> }): Promise<ManagedCoreHandle> {
  if (!installation.identity.entry.endsWith('.js') || !['darwin', 'linux'].includes(process.platform)) throw Error('Unsupported managed recovery launcher');
  const port = options.port;
  await inspectDataHome(home); options.signal?.throwIfAborted();
  const browserToken = randomBytes(32).toString('hex');
  const secrets = [...Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key)).map(([, value]) => value).filter((value): value is string => !!value), browserToken];
  const journal = await installation.acquire(secrets), controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  try {
    const observation = await new CoreRecovery(installation).preview();
    if (observation.blockers.length || observation.unobservedProcesses.length) throw new ApiError(409, 'core_busy', '安装仍有未确认的进程状态，请先检查恢复信息');
  } catch (error) { await journal.close(); throw error; }
  if (options.recovery) {
    try {
      const recovery = new CoreRecovery(installation);
      if (await recovery.launchReceipt(options.recovery, journal.events)) throw new ApiError(409, 'core_conflict', '此恢复启动已被接受，请查询原命令');
      const plan = await recovery.launchPlan(options.recovery.selection, journal.events);
      if (plan.planHash !== options.recovery.planHash) throw new ApiError(409, 'core_conflict', '取得安装租约前恢复计划已变化');
      await journal.append('core.recovery.launch.intent', { request: options.recovery, plan });
    } catch (error) { await journal.close(); throw error; }
  }
  const launchId = id();
  let current: { child: ManagedChild; selection: CoreSwitchCandidate } | undefined, lastIdentity: ManagedIdentity, origin = '', changing = false, finished = false;
  let resolveDone!: (result: CoreProcessResult) => void;
  const done = new Promise<CoreProcessResult>(resolve => { resolveDone = resolve; });
  const fallback: CoreProcessResult = { status: 'failed', exitCode: null, signal: null, cleanup: 'confirmed', cleanupScope: 'process-group', bytes: 0, dispatched: false };
  let terminalFailure: CoreProcessResult | undefined;
  const finish = async (result: CoreProcessResult) => {
    if (finished) return; finished = true; options.signal?.removeEventListener('abort', externalStop);
    try { await journal.append('core.launch.finished', { launchId, ...result }); }
    catch (error) { result = { ...result, status: 'unknown', error: journal.clean(String(error)) }; }
    try { await journal.close(); } catch (error) { result = { ...result, status: 'unknown', error: journal.clean(String(error)) }; }
    resolveDone(result);
  };
  const watch = (child: ManagedChild) => { void child.done.then(async result => {
    if (changing || current?.child !== child) return;
    await switches.settled();
    if (!changing && current?.child === child) { current = undefined; await finish(result); }
  }).catch(async error => { if (!changing) await finish({ ...fallback, status: 'unknown', error: String(error) }); }); };
  const selected = async (child: ManagedChild, selection: CoreSwitchCandidate) => {
    await journal.append('core.launch.selected', { launchId, ...selection, workspace, home, identity: child.ready.identity, origin: child.ready.origin }, { candidateId: selection.candidateId });
    current = { child, selection }; lastIdentity = child.ready.identity; origin = child.ready.origin;
  };
  const start = (selection: CoreSwitchCandidate, selectedPort: number, initialCoreFence?: string, requireStorageCompatibility = false): Promise<ManagedChild> => startManagedChild({ directory: selection.directory, workspace, home, port: selectedPort, expectedBuild: selection.build,
    browserToken, journal, candidateId: selection.candidateId, signal, secrets, initialCoreFence, requireStorageCompatibility, control: (action, value) => control(action, value) });
  const switches: CoreSwitches = new CoreSwitches({ installationId: installation.identity.id, workspace, home, journal, checkpoint: options.checkpoint,
    current: () => current ? { identity: current.child.ready.identity, artifactRevision: current.selection.artifactRevision, buildId: current.selection.buildId } : undefined,
    async inspect(validationId) {
      if (!current) throw Error('No managed host is running');
      const identity = current.child.ready.identity;
      // The supervisor stays at its original build; candidates target the observed running child.
      const target = { id: hash(identity.entry), build: identity.build, sdkVersion: SDK_CONTRACT_VERSION, dataFormatVersion: DATA_FORMAT_VERSION };
      return selectValidatedCore(new CoreValidations(new CoreBuilds(new CoreCandidates(workspace, home, target))), validationId, true);
    },
    async prepare(token) {
      signal.throwIfAborted();
      if (!current?.child.ready.switchSupported) throw new ApiError(409, 'core_unmanaged', '当前候选不提供受控切换协议，请使用明确启动路径');
      return current.child.command('prepare', { token });
    },
    async release(token) { if (current) await current.child.command('release', { token }); },
    async replace(selection, token): Promise<ManagedIdentity> {
      signal.throwIfAborted(); if (!current) throw Error('No managed host is running');
      changing = true;
      const old = current, fixedPort = Number(new URL(origin).port); current = undefined;
      let next: ManagedChild | undefined, retained: ManagedChild | undefined, oldCleanupConfirmed = false;
      try {
        const stopped = await old.child.stop();
        await journal.append('core.switch.old-stopped', { commandId: token, buildId: old.selection.buildId, outcome: stopped });
        if (stopped.cleanup !== 'confirmed') throw new ApiError(503, 'core_unknown', '旧宿主清理未确认，不能启动另一版本');
        oldCleanupConfirmed = true;
        await options.checkpoint?.('old-stopped');
        next = await start(selection, fixedPort, token);
        if (!next.ready.switchSupported) throw Error('Candidate lacks the controlled switch protocol');
        await options.checkpoint?.('candidate-ready');
        await selected(next, selection);
        await options.checkpoint?.('selection-written');
        await next.command('release', { token });
        changing = false; watch(next); return next.ready.identity;
      } catch (error) {
        try {
          const outcome = next ? await next.stop() : (error as { processOutcome?: CoreProcessResult }).processOutcome;
          current = undefined;
          if (outcome) await journal.append('core.switch.candidate-stopped', { commandId: token, buildId: selection.buildId, outcome });
          if (outcome?.cleanup === 'unknown') error = new ApiError(503, 'core_unknown', '候选清理未确认');
          await journal.append('core.switch.health-failed', { commandId: token, buildId: selection.buildId, error: journal.clean(String(error)) });
          // Only a confirmed-clean failure may attempt the retained version. Its own readers
          // must admit the current storage before startWeb can perform any writes.
          if (oldCleanupConfirmed && !(error instanceof ApiError && error.code === 'core_unknown') && !signal.aborted) {
            let restored: ManagedChild | undefined;
            try {
              if ((await coreTreeManifest(old.selection.directory)).revision !== old.selection.artifactRevision) throw Error('Retained artifact changed; recovery requires explicit inspection');
              await journal.append('core.switch.rollback.intent', { commandId: token, selection: old.selection });
              restored = retained = await start(old.selection, fixedPort, token, true);
              await selected(restored, old.selection);
              await restored.command('release', { token });
              await journal.append('core.switch.rollback.finished', { commandId: token, status: 'restored', identity: restored.ready.identity, storageCompatibility: restored.ready.storageCompatibility });
              changing = false; watch(restored);
            } catch (recoveryError) {
              const cleanup = restored ? await restored.stop() : (recoveryError as { processOutcome?: CoreProcessResult }).processOutcome;
              current = undefined;
              await journal.append('core.switch.rollback.finished', { commandId: token, status: 'recovery-required', error: journal.clean(String(recoveryError)), ...(cleanup ? { cleanup } : {}) });
              if (cleanup?.cleanup === 'unknown') error = new ApiError(503, 'core_unknown', '回退宿主清理未确认');
            }
          }
        } catch (recordingError) {
          controller.abort();
          await Promise.allSettled([old.child.stop(), next?.stop(), retained?.stop()]);
          current = undefined;
          error = new ApiError(503, 'core_unknown', `切换故障记录无法确认：${journal.clean(String(recordingError))}`);
        }
        changing = false;
        if (!current) terminalFailure = { ...fallback, status: error instanceof ApiError && error.code === 'core_unknown' ? 'unknown' : 'failed', cleanup: error instanceof ApiError && error.code === 'core_unknown' ? 'unknown' : 'confirmed', error: String(error) };
        void switches.settled().then(async () => { if (!current) await finish(terminalFailure ?? fallback); });
        throw error;
      }
    },
  });
  async function control(action: string, value: Record<string, unknown> = {}): Promise<unknown> {
    if (action === 'status') return { mode: 'managed', installation: installation.identity, switchSupported: !!current?.child.ready.switchSupported, phase: switches.busy ? 'switching' : current ? 'running' : 'stopped', identity: current?.child.ready.identity,
      blockers: [...await coreOperationBlockers(home), ...(current ? (await current.child.command('status')).blockers : [])] };
    if (action === 'recovery') return (await import('./recovery-view.js')).coreRecoveryView(installation);
    if (action === 'preview') return switches.preview(value.validationId as string);
    if (action === 'receipt') return { receipt: switches.receipt(String(value.commandId ?? '')) ?? null };
    if (action === 'switch') return switches.switch(value as any);
    throw new ApiError(400, 'core_control', '核心控制操作无效');
  }
  let stopping: Promise<CoreProcessResult> | undefined;
  const stop = () => stopping ??= (async () => {
    await Promise.resolve(); controller.abort();
    const child = current?.child, result = child ? await child.stop() : fallback;
    await switches.settled(); current = undefined; await finish(terminalFailure ?? result); return done;
  })();
  const externalStop = () => { void stop(); };
  options.signal?.addEventListener('abort', externalStop, { once: true });
  let bootChild: ManagedChild | undefined;
  try {
    await journal.append('core.launch.intent', { launchId, ...initial, workspace, home, port }, { candidateId: initial.candidateId });
    const child = bootChild = await start(initial, port, options.recovery?.commandId, !!options.recovery);
    await selected(child, initial);
    if (options.recovery) {
      const receipt: CoreRecoveryLaunchReceipt = { version: 1, commandId: options.recovery.commandId, planHash: options.recovery.planHash, selection: options.recovery.selection, status: 'started', running: 'not-observed', tasksReplayed: false, applied: false, observedBuild: child.ready.identity.build };
      await child.command('release', { token: options.recovery.commandId });
      await journal.append('core.recovery.launch.finished', receipt);
    }
    watch(child);
    if (signal.aborted) await stop();
    return { launchId, installation, get origin() { return origin; }, get url() { return `${origin}/#token=${browserToken}`; }, get identity() { return lastIdentity; }, done, stop, control };
  } catch (error) {
    controller.abort(); const outcome = bootChild ? await bootChild.stop() : (error as { processOutcome?: CoreProcessResult }).processOutcome ?? fallback;
    if (options.recovery) {
      const receipt: CoreRecoveryLaunchReceipt = { version: 1, commandId: options.recovery.commandId, planHash: options.recovery.planHash, selection: options.recovery.selection, status: outcome.cleanup === 'confirmed' ? 'failed' : 'unknown', running: 'not-observed', tasksReplayed: false, applied: false, error: journal.clean(String(error)) };
      await journal.append('core.recovery.launch.finished', receipt).catch(() => {});
    }
    await finish({ ...outcome, error: String(error) }); throw error;
  }
}
