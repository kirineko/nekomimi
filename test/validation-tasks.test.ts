import { expect, it } from 'vitest';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Sessions } from '../src/server/sessions.js';
import { Candidates } from '../src/customization/candidates.js';
import { Journal, readSession } from '../src/journal.js';
import { ValidationTasks } from '../src/customization/validation-tasks.js';
import { temporary } from './helpers.js';

async function fixture() {
  const development = await temporary(), store = new Candidates(development), candidate = await store.scaffold('validation');
  const sessions = await Sessions.open({ workspace: await temporary(), home: await temporary(), naming: false });
  await sessions.waitInitialization();
  const session = await sessions.create('validation', { commandId: 'target', mode: 'create', target: { root: development, kind: 'extension', scope: 'project' } });
  const input = { action: 'candidate-validation-start', sessionId: session.id, id: candidate.id, contentHash: (await store.read(candidate.id)).hash, commandId: 'compile-one' };
  return { sessions, session, store, candidate, input };
}
it('runs a pinned compiler snapshot off the event loop, deduplicates commands and persists diagnostics across service restart', async () => {
  const f = await fixture();
  await writeFile(join(f.candidate.path, 'index.ts'), 'const broken: string = 42; throw new Error("factory must never execute"); export default () => {};');
  f.input.contentHash = (await f.store.read(f.candidate.id)).hash;
  try {
    const started = await f.sessions.customizationAction(f.input);
    expect(started).toMatchObject({ id: f.input.commandId, status: 'running', stage: 'static' });
    expect(await f.sessions.customizationAction(f.input)).toMatchObject({ id: f.input.commandId });
    expect((await f.sessions.coreSwitchBlockers()).some(item => item.kind === 'validation')).toBe(true);
    // The compiler is in another thread; regular asynchronous service reads still complete.
    expect((await f.sessions.list(0, 10)).sessions.some(item => item.id === f.session.id)).toBe(true);
    await expect.poll(async () => (await f.sessions.validationTasks.read(f.input.commandId))?.status, { timeout: 20000 }).toBe('failed');
    const view = await f.sessions.candidateView(f.candidate.id, f.session.id);
    expect(view.validationTasks[0]?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'index.ts', stage: 'type' })]));
    expect(view.evidence).toHaveLength(1);
    const history = await readSession(join(f.sessions.paths.root, 'validation-tasks', f.input.commandId));
    expect(history.events.filter(event => event.type === 'validation.intent')).toHaveLength(1);
    expect(history.events.filter(event => event.type === 'validation.finished')).toHaveLength(1);
    const observer = new ValidationTasks(f.sessions.paths.root);
    expect(await observer.read(f.input.commandId)).toMatchObject({ status: 'failed', logs: expect.any(Array) });
    await expect(f.sessions.customizationAction({ ...f.input, contentHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'candidate_changed' });
  } finally { await f.sessions.close(); }
});
it('records a cancellation request and acknowledges worker termination without recording successful validation', async () => {
  const f = await fixture();
  try {
    await f.sessions.customizationAction(f.input);
    await f.sessions.customizationAction({ action: 'candidate-validation-cancel', taskId: f.input.commandId, sessionId: f.session.id });
    await expect.poll(async () => (await f.sessions.validationTasks.read(f.input.commandId))?.status).toBe('cancelled');
    expect(await f.sessions.validationTasks.read(f.input.commandId)).toMatchObject({ cancelRequested: true, finishedAt: expect.any(String) });
    expect((await f.sessions.candidateView(f.candidate.id, f.session.id)).evidence).toHaveLength(0);
    expect(await f.sessions.customizationAction(f.input)).toMatchObject({ status: 'cancelled' });
    const work = await f.sessions.create('work', { mode: 'work', commandId: 'work' });
    await expect(f.sessions.customizationAction({ ...f.input, sessionId: work.id })).rejects.toMatchObject({ status: 403 });
  } finally { await f.sessions.close(); }
});
it('observes an unfinished durable intent as unknown and never reruns it', async () => {
  const f = await fixture();
  try {
    const view = await f.sessions.candidateView(f.candidate.id, f.session.id);
    const path = join(f.sessions.paths.root, 'validation-tasks', f.input.commandId), journal = await Journal.open(path);
    await journal.append('validation.intent', { version: 1, id: f.input.commandId, sessionId: f.session.id, candidateId: f.candidate.id, contentHash: f.input.contentHash, hostBuild: view.host.build, target: view.target!.root, stage: 'static', startedAt: new Date().toISOString(), status: 'running', cancelRequested: false, logs: [] });
    await journal.close();
    const before = (await readSession(path)).events;
    expect(await f.sessions.customizationAction(f.input)).toMatchObject({ status: 'unknown' });
    expect(f.sessions.validationTasks.busy()).toHaveLength(0);
    expect((await readSession(path)).events).toEqual(before);
    expect((await f.sessions.candidateView(f.candidate.id, f.session.id)).validationTasks[0]?.status).toBe('unknown');
  } finally { await f.sessions.close(); }
});
it('keeps a running snapshot verdict separate when candidate bytes change during compilation', async () => {
  const f = await fixture();
  try {
    await f.sessions.customizationAction(f.input);
    await writeFile(join(f.candidate.path, 'index.ts'), 'const changed: string = 123; export default () => {};');
    await expect.poll(async () => (await f.sessions.validationTasks.read(f.input.commandId))?.status, { timeout: 20000 }).toBe('passed');
    const current = await f.sessions.candidateView(f.candidate.id, f.session.id);
    expect(current.contentHash).not.toBe(f.input.contentHash);
    expect(current.evidence).toHaveLength(0);
    expect(current.previousEvidence[0]).toMatchObject({ revision: f.input.contentHash, passed: true });
    expect(current.validationTasks[0]?.contentHash).toBe(f.input.contentHash);
  } finally { await f.sessions.close(); }
});
it('runs the emitted JavaScript compiler worker without the source Jiti loader', async () => {
  const modulePath = new URL('../dist/customization/validation-tasks.js', import.meta.url).href;
  const { ValidationTasks: CompiledTasks } = await import(modulePath) as { ValidationTasks: typeof ValidationTasks };
  const development = await temporary(), store = new Candidates(development), candidate = await store.scaffold('compiled');
  const resource = await store.read(candidate.id), tasks = new CompiledTasks(await temporary());
  let recorded = 0;
  try {
    await tasks.start({ id: 'compiled', sessionId: 'session', candidateId: candidate.id, contentHash: resource.hash, hostBuild: 'fixture', target: development, stage: 'static' }, resource, async report => { expect(report.passed).toBe(true); recorded++; });
    await expect.poll(async () => (await tasks.read('compiled'))?.status, { timeout: 20000 }).toBe('passed');
    expect(recorded).toBe(1);
  } finally { await tasks.close(); }
});
