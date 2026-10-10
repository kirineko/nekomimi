import { expect, it, vi } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CoreInstallation } from '../src/core/installation.js';
import { launchManagedCore, resumeManagedCore } from '../src/core/managed.js';
import { CoreRecovery } from '../src/core/recovery.js';
import { Journal } from '../src/journal.js';
import { workspacePaths } from '../src/storage/paths.js';
import { CoreBuilds } from '../src/core/builds.js';
import { CoreValidations } from '../src/core/validations.js';
import { coreTreeManifest } from '../src/core/manifest.js';
import { temporary } from './helpers.js';

async function identity(directory: string) {
  const root = join(directory, 'dist'), digest = createHash('sha256');
  const walk = async (path: string): Promise<void> => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name !== 'build-identity.json') digest.update(relative(root, file)).update('\0').update(await readFile(file)).update('\0');
    }
  };
  await walk(root); const build = digest.digest('hex'); await writeFile(join(root, 'build-identity.json'), JSON.stringify({ version: 1, sha256: build })); return build;
}
async function fixture(incompatible: boolean) {
  const root = await temporary(), workspace = join(root, 'workspace'), home = join(root, 'home'); await mkdir(workspace); await mkdir(home);
  // Admission is a fixture; copied compiled services, process cleanup and rollback are real.
  // Dependencies resolve from this repository, not a separately built installation package.
  await mkdir(resolve('node_modules/.cache'), { recursive: true });
  const directory = await mkdtemp(resolve('node_modules/.cache/core-rollback-'));
  const old = join(directory, 'old'), next = join(directory, 'next');
  for (const path of [old, next]) { await mkdir(path); await cp(resolve('dist'), join(path, 'dist'), { recursive: true }); await cp(resolve('package.json'), join(path, 'package.json')); }
  const broken = `import {writeFile} from 'node:fs/promises';import {join} from 'node:path';export async function startWeb(options){${incompatible ? `await writeFile(join(options.home,'nekomimi-format.json'),JSON.stringify({product:'nekomimi',formatVersion:999}));` : ''}throw Error('injected candidate startup failure');}`;
  await writeFile(join(next, 'dist/server/app.js'), broken); await identity(next);
  const oldRevision = (await coreTreeManifest(old)).revision, nextRevision = (await coreTreeManifest(next)).revision;
  const installation = await CoreInstallation.locate({ entry: resolve('dist/cli.js'), registry: join(root, 'registry') });
  const builds = { candidates: { ownerWorkspace: workspace, home }, inspect: async () => ({ validForCurrent: true, result: { buildId: 'old-build', candidateId: 'old-candidate', artifact: { directory: old, revision: oldRevision } } }) } as unknown as CoreBuilds;
  const validations = { builds, inspect: async () => ({ validForCurrent: true, result: { buildId: 'old-build', candidateId: 'old-candidate', artifactRevision: oldRevision } }) } as unknown as CoreValidations;
  const checked = vi.spyOn(CoreValidations.prototype, 'inspect').mockResolvedValue({ validForCurrent: true, result: { buildId: 'next-build', candidateId: 'next-candidate', artifactRevision: nextRevision, report: { checks: ['core-switch-control'] } } } as any);
  const built = vi.spyOn(CoreBuilds.prototype, 'inspect').mockResolvedValue({ validForCurrent: true, result: { buildId: 'next-build', candidateId: 'next-candidate', artifact: { directory: next, revision: nextRevision } } } as any);
  try {
    const managed = await launchManagedCore(validations, { validationId: 'initial', artifactRevision: oldRevision, authorize: true }, { installation });
    return { root, workspace, home, old, next, managed, installation, async dispose() { await managed.stop(); checked.mockRestore(); built.mockRestore(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { checked.mockRestore(); built.mockRestore(); await rm(directory, { recursive: true, force: true }); throw error; }
}
it('restores the retained actual Web child after a clean startup failure and reports a failed switch with the old identity', async () => {
  const f = await fixture(false), oldIdentity = f.managed.identity;
  try {
    const plan = await f.managed.control('preview', { validationId: 'next-validation' }) as any;
    const input = { commandId: 'failed-switch', validationId: 'next-validation', artifactRevision: plan.candidate.artifactRevision, planHash: plan.planHash, authorize: true };
    const receipt = await f.managed.control('switch', input);
    expect(receipt).toMatchObject({ status: 'failed', applied: false, actualBuild: oldIdentity.build });
    expect(f.managed.identity).toEqual(oldIdentity); expect((await fetch(f.managed.origin)).status).toBe(200);
    const before = (await f.installation.read()).events;
    expect(before.some(event => event.type === 'core.switch.rollback.finished' && (event.payload as any).status === 'restored')).toBe(true);
    expect(before.some(event => event.type === 'core.launch.storage-compatible')).toBe(true);
    expect(await f.managed.control('switch', input)).toEqual(receipt);
    expect((await f.installation.read()).events).toHaveLength(before.length);
  } finally { await f.dispose(); }
}, 30000);
it('leaves incompatible data intact and enters recovery-required without restoring the old service', async () => {
  const f = await fixture(true);
  try {
    const plan = await f.managed.control('preview', { validationId: 'next-validation' }) as any;
    const receipt = await f.managed.control('switch', { commandId: 'incompatible-switch', validationId: 'next-validation', artifactRevision: plan.candidate.artifactRevision, planHash: plan.planHash, authorize: true });
    expect(receipt).toMatchObject({ status: 'failed', applied: false }); expect((receipt as any).actualBuild).toBeUndefined();
    expect(await f.managed.done).toMatchObject({ status: 'failed', cleanup: 'confirmed' });
    expect(JSON.parse(await readFile(join(f.home, 'nekomimi-format.json'), 'utf8')).formatVersion).toBe(999);
    await expect(fetch(f.managed.origin)).rejects.toThrow();
    const events = (await f.installation.read()).events;
    expect(events.filter(event => event.type === 'core.launch.selected')).toHaveLength(1);
    expect(events.some(event => event.type === 'core.switch.rollback.finished' && (event.payload as any).status === 'recovery-required')).toBe(true);
  } finally { await f.dispose(); }
}, 30000);
it('explicitly restarts a confirmed artifact on the same port without replaying unfinished business history or repeating the recovery command', async () => {
  const f = await fixture(false); let resumed: Awaited<ReturnType<typeof resumeManagedCore>> | undefined;
  try {
    const origin = f.managed.origin; await f.managed.stop();
    const paths = await workspacePaths(f.workspace, f.home), history = join(paths.sessions, 'pending-history');
    const journal = await Journal.open(history); await journal.append('tool.intent', { tool: 'never-execute', args: { sentinel: 'unknown result' } }); await journal.close();
    const before = await readFile(join(history, 'journal.jsonl'), 'utf8');
    const recovery = new CoreRecovery(f.installation), plan = await recovery.launchPlan('last');
    const input = { commandId: 'recover-confirmed', selection: 'last' as const, planHash: plan.planHash, authorize: true };
    const activeBuild = await Journal.open(join(f.home, 'core-builds/journal'));
    try { await expect(resumeManagedCore(f.installation, input)).rejects.toMatchObject({ code: 'core_busy' }); }
    finally { await activeBuild.close(); }
    resumed = await resumeManagedCore(f.installation, input);
    expect('done' in resumed).toBe(true); if (!('done' in resumed)) throw Error('Expected managed service');
    expect(resumed.origin).toBe(origin); expect(resumed.identity.build).toBe(f.managed.identity.build);
    expect((await fetch(resumed.origin)).status).toBe(200);
    const count = (await f.installation.read()).events.filter(event => event.type === 'core.launch.process.started').length;
    expect(await resumeManagedCore(f.installation, input)).toMatchObject({ status: 'started', running: 'not-observed', tasksReplayed: false });
    expect((await f.installation.read()).events.filter(event => event.type === 'core.launch.process.started')).toHaveLength(count);
    expect(await readFile(join(history, 'journal.jsonl'), 'utf8')).toBe(before);
  } finally { if (resumed && 'done' in resumed) await resumed.stop(); await f.dispose(); }
}, 30000);
it('terminates owned children and reports unknown when failure evidence cannot be persisted', async () => {
  const f = await fixture(false), append = Journal.prototype.append;
  const failure = vi.spyOn(Journal.prototype, 'append').mockImplementation(function (this: Journal, type, ...args) {
    if (type === 'core.switch.health-failed') return Promise.reject(Error('injected journal failure'));
    return append.call(this, type, ...args);
  });
  try {
    const plan = await f.managed.control('preview', { validationId: 'next-validation' }) as any;
    expect(await f.managed.control('switch', { commandId: 'unrecordable-failure', validationId: 'next-validation', artifactRevision: plan.candidate.artifactRevision, planHash: plan.planHash, authorize: true })).toMatchObject({ status: 'unknown', applied: false });
    expect(await f.managed.done).toMatchObject({ status: 'unknown', cleanup: 'unknown' });
    await expect(fetch(f.managed.origin)).rejects.toThrow();
  } finally { failure.mockRestore(); await f.dispose(); }
}, 30000);
it('exposes the confirmed recovery plan and foreground recovery through the actual compiled CLI', async () => {
  const f = await fixture(false); await f.managed.stop();
  const osHome = join(f.root, 'os-home'); await mkdir(join(osHome, '.nekomimi'), { recursive: true });
  await rename(join(f.root, 'registry'), join(osHome, '.nekomimi/installations'));
  const cli = resolve('dist/cli.js'), env = { ...process.env, HOME: osHome }, execute = promisify(execFile);
  const plan = JSON.parse((await execute(process.execPath, [cli, 'core', 'recover-plan', JSON.stringify({ selection: 'last' })], { env, timeout: 15000 })).stdout);
  const input = { commandId: 'cli-recover', selection: 'last', planHash: plan.planHash, authorize: true };
  const args = [cli, 'core', 'recover', JSON.stringify(input)], child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stderr!.on('data', data => { errors += String(data); });
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  let origin: string | undefined;
  try {
    const ready = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Recovery CLI readiness timeout: ' + errors)), 15000);
      child.stdout!.on('data', data => { output += String(data); try { const value = JSON.parse(output.split('\n')[0]!); if (value.mode === 'managed') { clearTimeout(timer); resolve(value); } } catch {} });
      void exit.then(() => { clearTimeout(timer); reject(Error('Recovery CLI exited before readiness: ' + errors)); });
    });
    origin = new URL(ready.url).origin;
    expect(ready.identity.build).toBe(f.managed.identity.build); expect((await fetch(origin)).status).toBe(200);
    const repeated = JSON.parse((await execute(process.execPath, args, { env, timeout: 15000 })).stdout);
    expect(repeated).toMatchObject({ status: 'started', commandId: input.commandId, tasksReplayed: false, running: 'not-observed' });
  } finally { child.kill('SIGTERM'); expect(await exit).toBe(0); await f.dispose(); }
  await expect(fetch(origin!)).rejects.toThrow();
}, 30000);
