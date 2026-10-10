import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { CoreInstallation } from '../src/core/installation.js';
import { CoreRecovery } from '../src/core/recovery.js';
import { resumeManagedCore, type ManagedCoreHandle } from '../src/core/managed.js';
import { coreTreeManifest } from '../src/core/manifest.js';
import { Journal } from '../src/journal.js';
import { workspacePaths } from '../src/storage/paths.js';
import { temporary } from './helpers.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fixture() {
  const root = await temporary(), workspace = join(root, 'workspace'), home = join(root, 'home'), registry = join(root, 'registry'); await mkdir(workspace);
  const paths = await workspacePaths(workspace, home), history = join(paths.sessions, 'unknown-tool');
  const journal = await Journal.open(history); await journal.append('tool.intent', { tool: 'unknown-external-effect', args: {} }); await journal.close();
  await mkdir(resolve('node_modules/.cache'), { recursive: true });
  const artifacts = await mkdtemp(resolve('node_modules/.cache/core-crash-')), old = join(artifacts, 'old'), next = join(artifacts, 'next');
  for (const directory of [old, next]) { await mkdir(directory); await cp(resolve('dist'), join(directory, 'dist'), { recursive: true }); await cp(resolve('package.json'), join(directory, 'package.json')); }
  await writeFile(join(next, 'dist/crash-fixture.js'), 'export const fixture = "different-build";');
  const digest = createHash('sha256'), dist = join(next, 'dist');
  const walk = async (path: string): Promise<void> => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name); if (entry.isDirectory()) await walk(file); else if (entry.name !== 'build-identity.json') digest.update(relative(dist, file)).update('\0').update(await readFile(file)).update('\0');
    }
  };
  await walk(dist); const nextBuild = digest.digest('hex'); await writeFile(join(dist, 'build-identity.json'), JSON.stringify({ version: 1, sha256: nextBuild }));
  return { root, workspace, home, registry, history, artifacts, old, next, oldRevision: (await coreTreeManifest(old)).revision, nextRevision: (await coreTreeManifest(next)).revision,
    oldBuild: JSON.parse(await readFile(join(old, 'dist/build-identity.json'), 'utf8')).sha256 as string, nextBuild };
}

// Candidate admission is explicitly a fixture; the supervisor, durable phase boundaries,
// SIGKILL, orphan shutdown, storage checks, restored Web service and receipts are real.
it.each(['intent-written', 'old-stopped', 'candidate-ready', 'selection-written', 'receipt-written'] as const)('recovers after actual supervisor SIGKILL at %s without replaying business history', async phase => {
  const f = await fixture(), installation = await CoreInstallation.locate({ entry: resolve('dist/cli.js'), registry: f.registry });
  const module = (path: string) => JSON.stringify(pathToFileURL(resolve('dist/core', path)).href);
  const code = `
    import {launchManagedCore} from ${module('managed.js')};
    import {CoreInstallation} from ${module('installation.js')};
    import {CoreBuilds} from ${module('builds.js')};
    import {CoreValidations} from ${module('validations.js')};
    const f=${JSON.stringify(f)}, phase=${JSON.stringify(phase)};
    CoreValidations.prototype.inspect=async()=>({validForCurrent:true,result:{buildId:'next-build',candidateId:'next-candidate',artifactRevision:f.nextRevision,report:{checks:['core-switch-control']}}});
    CoreBuilds.prototype.inspect=async()=>({validForCurrent:true,result:{buildId:'next-build',candidateId:'next-candidate',artifact:{directory:f.next,revision:f.nextRevision}}});
    const builds={candidates:{ownerWorkspace:f.workspace,home:f.home},inspect:async()=>({validForCurrent:true,result:{buildId:'old-build',candidateId:'old-candidate',artifact:{directory:f.old,revision:f.oldRevision}}})};
    const validations={builds,inspect:async()=>({validForCurrent:true,result:{buildId:'old-build',candidateId:'old-candidate',artifactRevision:f.oldRevision}})};
    const installation=await CoreInstallation.locate({entry:${JSON.stringify(resolve('dist/cli.js'))},registry:f.registry});
    const managed=await launchManagedCore(validations,{validationId:'initial',artifactRevision:f.oldRevision,authorize:true},{installation,checkpoint:async value=>{if(value===phase){process.send({phase:value});await new Promise(()=>{});}}});
    const plan=await managed.control('preview',{validationId:'next-validation'});
    await managed.control('switch',{commandId:'crash-switch',validationId:'next-validation',artifactRevision:f.nextRevision,planHash:plan.planHash,authorize:true});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = '', recovered: ManagedCoreHandle | undefined; child.stderr!.on('data', chunk => { errors += String(chunk); });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`Phase timeout: ${errors}`)), 15000);
      child.on('message', value => { if ((value as any).phase === phase) { clearTimeout(timer); resolve(); } });
      child.once('exit', () => { clearTimeout(timer); reject(Error(`Early supervisor exit: ${errors}`)); }); child.once('error', reject);
    });
    child.kill('SIGKILL'); await exited;
    const recovery = new CoreRecovery(installation);
    for (let i = 0; i < 100 && (await recovery.preview()).blockers.length; i++) await pause(50);
    const observation = await recovery.preview(); expect(observation.blockers).toEqual([]); expect(observation.running).toBe('not-observed');
    const expected = ['selection-written', 'receipt-written'].includes(phase) ? f.nextBuild : f.oldBuild;
    expect((observation.lastConfirmedSelection?.identity as any).build).toBe(expected);
    // Let the actual stale writer lease expire. Never unlink it or impersonate its owner.
    await pause(10500);
    const before = await readFile(join(f.history, 'journal.jsonl'), 'utf8'), plan = await recovery.launchPlan('last');
    const input = { commandId: 'recover-after-kill', selection: 'last' as const, planHash: plan.planHash, authorize: true };
    const result = await resumeManagedCore(installation, input); if (!('done' in result)) throw Error('Expected a recovered service'); recovered = result;
    expect(recovered.identity.build).toBe(expected); expect((await fetch(recovered.origin)).status).toBe(200);
    const receipt = await recovered.control('receipt', { commandId: 'crash-switch' }) as any;
    expect(receipt.receipt.status).toBe(phase === 'receipt-written' ? 'applied' : 'unknown');
    expect(await readFile(join(f.history, 'journal.jsonl'), 'utf8')).toBe(before);
    const count = (await installation.read()).events.filter(event => event.type === 'core.launch.process.started').length;
    expect(await resumeManagedCore(installation, input)).toMatchObject({ status: 'started', running: 'not-observed', tasksReplayed: false });
    expect((await installation.read()).events.filter(event => event.type === 'core.launch.process.started')).toHaveLength(count);
    if (phase === 'receipt-written') {
      await recovered.stop();
      const previous = await recovery.launchPlan('previous'); expect(previous.selection.build).toBe(f.oldBuild);
      const rollback = await resumeManagedCore(installation, { commandId: 'explicit-previous', selection: 'previous', planHash: previous.planHash, authorize: true });
      if (!('done' in rollback)) throw Error('Expected the retained previous service'); recovered = rollback;
      expect(recovered.identity.build).toBe(f.oldBuild); expect((await fetch(recovered.origin)).status).toBe(200);
      expect(await readFile(join(f.history, 'journal.jsonl'), 'utf8')).toBe(before);
    }
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } if (recovered) await recovered.stop(); await rm(f.artifacts, { recursive: true, force: true }); }
}, 45000);
