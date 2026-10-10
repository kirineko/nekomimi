import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { rename, writeFile } from 'node:fs/promises';
import { CoreOperations } from '../src/core/operations.js';
import { Journal, hash, readSession } from '../src/journal.js';
import { Sessions } from '../src/server/sessions.js';
import { CoreBuilds } from '../src/core/builds.js';
import { temporary } from './helpers.js';
import { coreViewFixture } from './fixtures/core-view.js';

const input = { commandId: 'operation', sessionId: 'session', candidateId: 'candidate', target: '/fixture', hostBuild: 'host', kind: 'build' as const, inputHash: 'a'.repeat(64) };
it('deduplicates admission and records cancellation before waiting for a real terminal outcome', async () => {
  const operations = new CoreOperations(await temporary());
  let release!: () => void, received = false;
  const ended = new Promise<void>(resolve => { release = resolve; });
  const execute = vi.fn(async (signal: AbortSignal) => { signal.addEventListener('abort', () => { received = true; }); await ended; return { status: 'cancelled' as const, resultId: 'build' }; });
  try {
    expect(await operations.start(input, execute)).toMatchObject({ status: 'running' });
    expect(await operations.start(input, execute)).toMatchObject({ status: 'running' }); expect(execute).toHaveBeenCalledTimes(1);
    await expect(operations.start({ ...input, inputHash: 'b'.repeat(64) }, execute)).rejects.toMatchObject({ status: 409 });
    expect(await operations.cancel(input.commandId, input.sessionId)).toMatchObject({ status: 'cancelling', cancelRequested: true }); expect(received).toBe(true);
    release(); await expect.poll(async () => (await operations.read(input.commandId))?.status).toBe('cancelled');
    expect(await operations.start(input, execute)).toMatchObject({ status: 'cancelled', resultId: 'build' }); expect(execute).toHaveBeenCalledTimes(1);
  } finally { release(); await operations.close(); }
});
it('does not redispatch an accepted historical command and does not turn thrown errors into confirmed cleanup', async () => {
  const root = await temporary(), operations = new CoreOperations(root), journal = await Journal.open(join(root, 'core-operations', input.commandId));
  await journal.append('core.operation.accepted', { ...input, version: 1, requestHash: hash(JSON.stringify(input)), status: 'running', startedAt: new Date().toISOString(), cancelRequested: false }); await journal.close();
  const execute = vi.fn(async () => ({ status: 'passed' as const }));
  try {
    expect(await operations.start(input, execute)).toMatchObject({ status: 'unknown' }); expect(execute).not.toHaveBeenCalled();
    await operations.start({ ...input, commandId: 'transport-error' }, async () => { throw Error('terminal write failed'); });
    await expect.poll(async () => (await operations.read('transport-error'))?.status).toBe('unknown');
  } finally { await operations.close(); }
});
it('binds Web execution to the core session and refuses stale plans before accepting a task', async () => {
  const f = await coreViewFixture(), sessions = await Sessions.open({ workspace: f.workspace, home: f.home, naming: false });
  try {
    const session = await sessions.create('core', { commandId: 'session', mode: 'create', target: { kind: 'core', root: f.candidate.directory } });
    const plan = await new CoreBuilds(f.candidates).plan(f.candidate.id);
    const request = { action: 'candidate-core-build', sessionId: session.id, commandId: 'build', inputHash: plan.inputHash, authorize: true };
    await expect(sessions.customizationAction({ ...request, authorize: false })).rejects.toMatchObject({ status: 400 });
    await writeFile(join(f.candidate.directory, 'src/cli.ts'), '// edited after plan');
    await expect(sessions.customizationAction(request)).rejects.toMatchObject({ status: 409, code: 'core_build_changed' });
    expect(await sessions.coreOperationView(session.id)).toEqual([]);
    const work = await sessions.create('work', { commandId: 'work', mode: 'work' });
    await expect(sessions.customizationAction({ ...request, sessionId: work.id })).rejects.toMatchObject({ status: 403 });
  } finally { await sessions.close(); }
});
it('runs and cancels an actual Web-admitted build process without dispatching it again', async () => {
  const f = await coreViewFixture();
  await writeFile(join(f.candidate.directory, 'forbidden-build.cjs'), 'console.log("build waiting for cancellation"); setInterval(() => {}, 100);');
  const sessions = await Sessions.open({ workspace: f.workspace, home: f.home, naming: false });
  try {
    await sessions.waitInitialization();
    const session = await sessions.create('core', { commandId: 'session', mode: 'create', target: { kind: 'core', root: f.candidate.directory } });
    const plan = await new CoreBuilds(f.candidates).plan(f.candidate.id), request = { action: 'candidate-core-build', sessionId: session.id, commandId: 'real-build', inputHash: plan.inputHash, authorize: true };
    expect(await sessions.customizationAction(request)).toMatchObject({ status: 'running' });
    await expect.poll(async () => (await new CoreBuilds(f.candidates).records()).some(event => event.type === 'core.build.process.started' && (event.payload as { step: number }).step === 1), { timeout: 30000 }).toBe(true);
    expect((await sessions.coreSwitchBlockers()).some(item => item.kind === 'core-operation')).toBe(true);
    await expect(sessions.remove(session.id)).rejects.toMatchObject({ status: 409, code: 'busy' });
    await rename(f.candidate.directory, f.candidate.directory + '.moved');
    await expect(sessions.coreCandidateView(session.id)).rejects.toThrow();
    expect((await sessions.coreOperationView(session.id))[0]?.status).toBe('running');
    await sessions.customizationAction({ action: 'candidate-core-cancel', sessionId: session.id, commandId: 'real-build' });
    await expect.poll(async () => (await sessions.coreOperationView(session.id))[0]?.status, { timeout: 15000 }).toBe('cancelled');
    await rename(f.candidate.directory + '.moved', f.candidate.directory);
    const before = (await readSession(join(f.home, 'core-builds', 'journal'))).events;
    expect(await sessions.customizationAction(request)).toMatchObject({ status: 'cancelled' });
    expect((await readSession(join(f.home, 'core-builds', 'journal'))).events).toEqual(before);
  } finally { await sessions.close(); }
}, 60000);
