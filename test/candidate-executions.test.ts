import { expect, it } from 'vitest';
import { writeFile, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Sessions } from '../src/server/sessions.js';
import { startWeb } from '../src/server/app.js';
import { Candidates } from '../src/customization/candidates.js';
import { readSession, Journal } from '../src/journal.js';
import { temporary } from './helpers.js';

async function fixture(template = 'command') {
  const workspace = await temporary(), home = await temporary(), development = await temporary();
  const store = new Candidates(development), candidate = await store.scaffold('execution', template);
  const sessions = await Sessions.open({ workspace, home, naming: false });
  await sessions.waitInitialization();
  const session = await sessions.create('execution', { commandId: 'create', mode: 'create', target: { kind: 'extension', root: development } });
  const input = { action: 'candidate-execution-start', id: candidate.id, sessionId: session.id, commandId: 'execute', contentHash: (await store.read(candidate.id)).hash, stage: template === 'panel' ? 'preview' : 'simulation', authorize: true, command: '/execution' };
  return { workspace, home, development, store, candidate, sessions, session, input };
}
it('persists simulation results and links trial evidence without repeating a command or accepting changed inputs', async () => {
  const f = await fixture();
  try {
    await expect(f.sessions.customizationAction({ ...f.input, authorize: false })).rejects.toMatchObject({ status: 400 });
    expect(await f.sessions.validationTaskView(f.session.id)).toEqual([]);
    await f.sessions.customizationAction(f.input);
    await expect.poll(async () => (await f.sessions.validationTasks.read('execute'))?.status, { timeout: 15000 }).toBe('passed');
    const task = (await f.sessions.validationTaskView(f.session.id))[0]!;
    expect(task).toMatchObject({ stage: 'simulation', result: { text: 'Ready', trialSession: expect.any(String) } });
    expect((await readSession(task.result!.trialSession!)).events.find(event => event.type === 'trial.started')?.validationTaskId).toBe('execute');
    const before = (await readSession(task.result!.trialSession!)).events;
    expect(await f.sessions.customizationAction(f.input)).toMatchObject({ status: 'passed', id: 'execute' });
    expect((await readSession(task.result!.trialSession!)).events).toEqual(before);
    await expect(f.sessions.customizationAction({ ...f.input, command: '/execution different' })).rejects.toMatchObject({ status: 409 });
    expect((await f.sessions.candidateView(f.candidate.id, f.session.id)).evidence.at(-1)).toMatchObject({ runId: 'execute', sessionId: f.session.id, stage: 'simulation' });
  } finally { await f.sessions.close(); }
});
it('reuses prepared preview frames and reports expiration after close or restart without factory replay', async () => {
  const f = await fixture('panel'); let closed = false;
  try {
    await f.sessions.customizationAction(f.input);
    await expect.poll(async () => (await f.sessions.validationTasks.read('execute'))?.status, { timeout: 15000 }).toBe('passed');
    const first = await f.sessions.validationPreview(f.session.id, 'execute');
    expect(await f.sessions.validationPreview(f.session.id, 'execute')).toEqual(first);
    const history = join(f.development, '.nekomimi/panel-history');
    expect((await readSession(history)).events.filter(event => event.type === 'panel.preview.intent')).toEqual([expect.objectContaining({ validationTaskId: 'execute' })]);
    await f.sessions.customizationAction({ action: 'panel-unmount', sessionId: f.session.id, instanceId: first.frame.instanceId });
    await expect(f.sessions.validationPreview(f.session.id, 'execute')).rejects.toMatchObject({ status: 410 });
    await f.sessions.close(); closed = true;
    const restarted = await Sessions.open({ workspace: f.workspace, home: f.home, naming: false });
    try {
      expect(await restarted.customizationAction(f.input)).toMatchObject({ status: 'passed' });
      await expect(restarted.validationPreview(f.session.id, 'execute')).rejects.toMatchObject({ status: 410 });
      expect((await readSession(history)).events.filter(event => event.type === 'panel.preview.intent')).toHaveLength(1);
    } finally { await restarted.close(); }
  } finally { if (!closed) await f.sessions.close(); }
});
it('cancels a stuck preview factory even after its target directory becomes unavailable', async () => {
  const f = await fixture('panel'), marker = join(f.workspace, 'pid');
  await writeFile(join(f.candidate.path, 'index.ts'), `import {writeFileSync} from 'node:fs';export default()=>{writeFileSync(${JSON.stringify(marker)},String(process.pid));while(true){}};`);
  f.input.contentHash = (await f.store.read(f.candidate.id)).hash;
  try {
    await f.sessions.customizationAction(f.input);
    await expect.poll(() => readFile(marker, 'utf8').catch(() => ''), { timeout: 15000 }).not.toBe('');
    const pid = Number(await readFile(marker, 'utf8'));
    await expect(f.sessions.remove(f.session.id)).rejects.toMatchObject({ status: 409 });
    await rename(f.development, f.development + '-moved');
    expect((await f.sessions.validationTaskView(f.session.id))[0]?.status).toBe('running');
    await f.sessions.customizationAction({ action: 'candidate-validation-cancel', sessionId: f.session.id, taskId: 'execute' });
    await expect.poll(async () => (await f.sessions.validationTasks.read('execute'))?.status, { timeout: 15000 }).toBe('cancelled');
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(readFile(join(f.development, '.nekomimi/lifecycle-journal/journal.jsonl'))).rejects.toThrow();
    await rename(f.development + '-moved', f.development);
  } finally { await f.sessions.close(); }
});
it('does not execute a persisted preview intent that has no terminal or current owner', async () => {
  const f = await fixture('panel');
  try {
    const original = await f.sessions.candidateView(f.candidate.id, f.session.id);
    const journal = await Journal.open(join(f.sessions.paths.root, 'validation-tasks', 'orphan'));
    await journal.append('validation.intent', { id: 'orphan', version: 1, sessionId: f.session.id, candidateId: f.candidate.id, stage: 'preview', contentHash: f.input.contentHash, hostBuild: original.host.build, target: f.development, startedAt: new Date().toISOString(), status: 'running' }); await journal.close();
    expect((await f.sessions.validationTaskView(f.session.id)).find(task => task.id === 'orphan')?.status).toBe('unknown');
    await expect(f.sessions.validationPreview(f.session.id, 'orphan')).rejects.toMatchObject({ status: 409 });
    expect(f.sessions.validationTasks.busy()).toEqual([]);
    await expect(readFile(join(f.development, '.nekomimi/panel-history/journal.jsonl'))).rejects.toThrow();
  } finally { await f.sessions.close(); }
});
it('exposes authenticated task reads and saved preview frames through the actual HTTP routes', async () => {
  const f = await fixture('panel'); await f.sessions.close();
  const app = await startWeb({ workspace: f.workspace, home: f.home, naming: false });
  const headers = { authorization: `Bearer ${app.token}`, 'content-type': 'application/json', origin: app.origin };
  try {
    const denied = await fetch(`${app.origin}/api/v1/sessions/${f.session.id}/validation-tasks`); expect(denied.status).toBe(401);
    const crossOrigin = await fetch(app.origin + '/api/v1/customization', { method: 'POST', headers: { ...headers, origin: 'https://invalid.example' }, body: JSON.stringify(f.input) }); expect(crossOrigin.status).toBe(403);
    const accepted = await fetch(app.origin + '/api/v1/customization', { method: 'POST', headers, body: JSON.stringify(f.input) });
    expect(accepted.status).toBe(200); expect(await accepted.json()).toMatchObject({ id: 'execute', status: 'running' });
    await expect.poll(async () => {
      const response = await fetch(`${app.origin}/api/v1/sessions/${f.session.id}/validation-tasks`, { headers });
      expect(response.status).toBe(200); return (await response.json())[0]?.status;
    }, { timeout: 15000 }).toBe('passed');
    const preview = await fetch(`${app.origin}/api/v1/sessions/${f.session.id}/validation-tasks/execute/preview`, { headers });
    expect(preview.status).toBe(200); const prepared=await preview.json();expect(prepared).toMatchObject({ frame: { nonce: expect.any(String), instanceId: expect.any(String) } });
    const other=await app.sessions.create('other create',{commandId:'other-create',mode:'create',target:f.session.binding!.target});
    const frameUrl=app.origin+prepared.frame.url;
    expect((await fetch(frameUrl+'?session='+f.session.id,{headers})).status).toBe(200);
    expect((await fetch(frameUrl+'?session='+other.id,{headers})).status).toBe(403);
    const wrongClose=await fetch(app.origin+'/api/v1/customization',{method:'POST',headers,body:JSON.stringify({action:'panel-unmount',sessionId:other.id,instanceId:prepared.frame.instanceId})});
    expect(wrongClose.status).toBe(403);
    expect((await fetch(`${app.origin}/api/v1/sessions/${f.session.id}/validation-tasks/execute/preview`,{headers})).status).toBe(200);
    const work = await app.sessions.create('work', { commandId: 'work', mode: 'work' });
    const wrongMode = await fetch(`${app.origin}/api/v1/sessions/${work.id}/validation-tasks/execute/preview`, { headers }); expect(wrongMode.status).toBe(403);
  } finally { await app.close(); }
});
