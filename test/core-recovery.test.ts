import { expect, it } from 'vitest';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { CoreInstallation } from '../src/core/installation.js';
import { CoreRecovery, observeCoreGroup } from '../src/core/recovery.js';
import { coreTreeManifest } from '../src/core/manifest.js';
import { temporary } from './helpers.js';

async function fixture() {
  const root = await temporary(), entry = join(root, 'cli.js'); await writeFile(entry, '// never executed');
  const installation = await CoreInstallation.locate({ entry, registry: join(root, 'registry') });
  return { root, installation, recovery: new CoreRecovery(installation) };
}
it('reads an absent installation without creating or executing anything', async () => {
  const f = await fixture(), before = await coreTreeManifest(f.root);
  expect(await f.recovery.preview()).toMatchObject({ lastConfirmedSelection: null, running: 'not-observed', interrupted: [], groups: [], applied: false });
  await expect(f.recovery.reconcile({ commandId: 'empty', planHash: (await f.recovery.preview()).planHash, authorize: true })).rejects.toMatchObject({ code: 'core_recovery' });
  expect((await coreTreeManifest(f.root)).revision).toBe(before.revision); expect(await readdir(f.root)).toEqual(['cli.js']);
});
it('projects interrupted phases without treating a historical selection as currently running', async () => {
  const f = await fixture(), journal = await f.installation.acquire();
  const old = { buildId: 'old', identity: { build: 'a'.repeat(64) } }, next = { buildId: 'next', identity: { build: 'b'.repeat(64) } };
  try {
    await journal.append('core.launch.selected', old);
    await journal.append('core.switch.intent', { request: { commandId: 'interrupted', planHash: 'c'.repeat(64) } });
    expect(await f.recovery.preview()).toMatchObject({ lastConfirmedSelection: old, interrupted: [{ commandId: 'interrupted' }], running: 'not-observed' });
    await journal.append('core.switch.old-stopped', { commandId: 'interrupted' });
    expect((await f.recovery.preview()).lastConfirmedSelection).toEqual(old);
    await journal.append('core.launch.selected', next);
    expect(await f.recovery.preview()).toMatchObject({ lastConfirmedSelection: next, previousConfirmedSelection: old, applied: false, running: 'not-observed' });
    await journal.append('core.launch.selected', next);
    expect((await f.recovery.preview()).previousConfirmedSelection).toEqual(old);
  } finally { await journal.close(); }
});
it('reconciles only metadata with exact confirmation, preserves business bytes and returns the original receipt', async () => {
  const f = await fixture(), home = join(f.root, 'business'); await mkdir(home); await writeFile(join(home, 'nekomimi-format.json'), '{"formatVersion":999}');
  const business = await coreTreeManifest(home), journal = await f.installation.acquire();
  await journal.append('core.switch.intent', { request: { commandId: 'unknown-switch', planHash: 'a'.repeat(64) } }); await journal.close();
  const plan = await f.recovery.preview(), input = { commandId: 'recover-once', planHash: plan.planHash, authorize: true };
  await expect(f.recovery.reconcile({ ...input, authorize: false })).rejects.toMatchObject({ code: 'core_authorization' });
  await expect(f.recovery.reconcile({ ...input, planHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'core_conflict' });
  const receipt = await f.recovery.reconcile(input), count = (await f.installation.read()).events.length;
  expect(receipt).toMatchObject({ status: 'reconciled', applied: false, tasksReplayed: false, interruptedCommands: ['unknown-switch'] });
  expect(await f.recovery.reconcile(input)).toEqual(receipt); expect((await f.installation.read()).events).toHaveLength(count);
  await expect(f.recovery.reconcile({ ...input, planHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'command_conflict' });
  expect((await coreTreeManifest(home)).revision).toBe(business.revision);
  expect((await f.installation.read()).events.some(event => event.type === 'core.switch.finished')).toBe(false);
});
it('refuses an active installation writer even when no child has been recorded', async () => {
  const f = await fixture(), journal = await f.installation.acquire();
  try { const plan = await f.recovery.preview(); await expect(f.recovery.reconcile({ commandId: 'active', planHash: plan.planHash, authorize: true })).rejects.toThrow('busy'); }
  finally { await journal.close(); }
});
it('retains read-only recovery when a process intent has no durable PID observation', async () => {
  const f = await fixture(), journal = await f.installation.acquire();
  await journal.append('core.launch.process.intent', { executable: process.execPath }); await journal.close();
  const plan = await f.recovery.preview(); expect(plan.unobservedProcesses).toHaveLength(1);
  await expect(f.recovery.launchPlan('last')).rejects.toMatchObject({ code: 'core_busy' });
  await expect(f.recovery.reconcile({ commandId: 'unobserved', planHash: plan.planHash, authorize: true })).rejects.toMatchObject({ code: 'core_busy' });
});
it('returns an unknown recovery launch receipt after an accepted command loses its terminal', async () => {
  const f = await fixture(), journal = await f.installation.acquire();
  const request = { commandId: 'accepted-recovery', selection: 'last' as const, planHash: 'd'.repeat(64), authorize: true };
  await journal.append('core.recovery.launch.intent', { request }); await journal.close();
  expect(await f.recovery.launchReceipt(request)).toMatchObject({ status: 'unknown', running: 'not-observed', applied: false, tasksReplayed: false });
  await expect(f.recovery.launchReceipt({ ...request, selection: 'previous' })).rejects.toMatchObject({ code: 'command_conflict' });
});
it('observes an owned live process group conservatively without signalling or launching it', async () => {
  const f = await fixture();
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => { child.stdout!.once('data', () => resolve()); child.once('error', reject); });
    const journal = await f.installation.acquire(); await journal.append('core.launch.process.started', { group: child.pid, pid: child.pid }); await journal.close();
    const plan = await f.recovery.preview(); expect(plan.blockers).toEqual([{ group: child.pid, state: 'present' }]);
    await expect(f.recovery.reconcile({ commandId: 'live', planHash: plan.planHash, authorize: true })).rejects.toMatchObject({ code: 'core_busy' });
    expect(observeCoreGroup(child.pid!)).toBe('present');
  } finally { child.kill('SIGTERM'); await exited; }
  expect(observeCoreGroup(child.pid!)).toBe('absent'); expect(observeCoreGroup(0)).toBe('unknown');
  const plan = await f.recovery.preview(); expect(await f.recovery.reconcile({ commandId: 'after-exit', planHash: plan.planHash, authorize: true })).toMatchObject({ status: 'reconciled', applied: false });
});
