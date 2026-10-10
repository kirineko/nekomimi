import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, Type } from '@earendil-works/pi-ai';
import { Harness, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';

const [mode, dir, replay] = process.argv.slice(2);
const settings = { compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, stream: { maxRetries: 0 }, toolExecution: 'sequential' };
async function count(directory) {
  try { return (await readFile(join(directory, 'external-effects.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).length; }
  catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
}
async function setup(directory, policy, startup) {
  const models = createModels(); const faux = fauxProvider({ tokensPerSecond: Infinity }); models.setProvider(faux.provider);
  faux.setResponses(startup ? [fauxAssistantMessage(fauxToolCall('effect', {}, { id: 'external-call' })), fauxAssistantMessage('done')] : [fauxAssistantMessage('recovered')]);
  const registry = createRegistry();
  const tool = defineTool({ name: 'effect', description: 'Fake external effect with observable count', parameters: Type.Object({}), replay: policy, execute: async (_args, api) => {
    const file = await open(join(directory, 'external-effects.jsonl'), 'a');
    try { await file.writeFile(JSON.stringify({ taskId: api.taskId, callId: api.callId, phase: startup ? 'before-kill' : 'after-reopen' }) + '\n'); await file.sync(); } finally { await file.close(); }
    if (startup) {
      process.send({ type: 'effect-durable', taskId: api.taskId });
      // Deliberately never return a result: the parent kills this exact process.
      await new Promise(() => {});
    }
    return { content: [{ type: 'text', text: 'effect completed' }] };
  } });
  registry.install(defineExtension({ name: 'fixture', tools: [tool] }));
  const storage = await openNodeJsonlStorage(join(directory, 'store'), context, { fsync: true });
  return { models, faux, registry, storage };
}
if (mode === 'crash-child') {
  const { models, faux, registry, storage } = await setup(dir, replay, true);
  const harness = await Harness.open(storage, { models, registry, settings }, context);
  const model = faux.getModel(); const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
  await (await root.submit({ type: 'input', content: 'fixture', requestId: 'original' }, context)).wait(context);
  throw new Error('Child should have been killed before tool returned');
} else if (mode === 'run') {
  await mkdir(dir, { recursive: true }); const results = [];
  for (const policy of ['safe', 'never']) {
    const directory = join(dir, policy); await mkdir(directory, { recursive: true });
    const child = fork(fileURLToPath(import.meta.url), ['crash-child', directory, policy], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const exit = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('child effect barrier timeout')); }, 15000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`child exited before barrier: ${code}; ${stderr}`)); });
      child.once('message', msg => { clearTimeout(timer); resolve(msg); });
    });
    assert.equal(ready.type, 'effect-durable'); assert.equal(await count(directory), 1);
    child.kill('SIGKILL'); const killed = await exit; assert.equal(killed.signal, 'SIGKILL');
    await writeFile(join(directory, 'child.log'), stdout + stderr);
    const { models, faux, registry, storage } = await setup(directory, policy, false);
    const harness = await Harness.open(storage, { models, registry, settings }, context);
    try {
      const root = await harness.root(context); const before = await harness.inspect(context);
      await writeFile(join(directory, 'before-resume.json'), JSON.stringify(before, null, 2));
      const entriesBefore = await root.entries({}, 100, undefined, context);
      assert.ok(!entriesBefore.items.some(e => e.kind === 'pi.tool-result'), 'kill before result commit');
      assert.equal(await count(directory), 1); assert.equal(faux.state.callCount, 0, 'read-only reopen must not schedule');
      // This is an explicit scheduler start, not a claim that mere open auto-runs tasks.
      await harness.waitForIdle(context);
      const effects = await count(directory); assert.equal(effects, policy === 'safe' ? 2 : 1);
      const entries = await root.entries({}, 100, undefined, context);
      await writeFile(join(directory, 'after-resume-entries.json'), JSON.stringify(entries, null, 2));
      results.push({ policy, killed, readOnlyReopenEffects: 1, resumedEffects: effects, resumedModelCalls: faux.state.callCount, productUnknownResultPolicy: policy === 'safe' ? 'FAIL: native replay reruns an unknown effect' : 'no replay observed; interruption representation requires product mapping' });
    } finally { await harness.close(context); }
  }
  // Simulate ENOSPC at the public atomic storage boundary, not a real full disk.
  const directory = join(dir, 'commit-failure'); await mkdir(directory, { recursive: true });
  const { models, faux, registry, storage } = await setup(directory, 'never', false);
  let rejectCommit = false;
  const failing = new Proxy(storage, { get(target, property) {
    if (property === 'commit') return async (...args) => { if (rejectCommit) throw Object.assign(new Error('fixture ENOSPC'), { code: 'ENOSPC' }); return target.commit(...args); };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const harness = await Harness.open(failing, { models, registry, settings }, context);
  try {
    const model = faux.getModel(); const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
    const before = await root.entries({}, 100, undefined, context);
    rejectCommit = true;
    await assert.rejects(root.submit({ type: 'input', content: 'must not commit' }, context));
    rejectCommit = false;
    assert.deepEqual(await root.entries({}, 100, undefined, context), before);
    assert.equal(faux.state.callCount, 0); assert.equal(await count(directory), 0);
    results.push({ scenario: 'public Storage.commit ENOSPC rejection', unchangedEntries: true, modelCalls: 0, effects: 0, scope: 'fault before backend commit; not fsync/partial-write/power-loss coverage' });
  } finally { rejectCommit = false; await harness.close(context); }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} else throw new Error('Usage: durable-probe.mjs run <new output directory>');
