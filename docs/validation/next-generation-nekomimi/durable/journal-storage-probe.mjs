import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, readFile, writeFile, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, Type } from '@earendil-works/pi-ai';
import { Harness, createRegistry, defineExtension, defineTool, hook, GenerationTask } from '@earendil-works/pi-durable';
import { openJournalStorage } from './journal-storage.mjs';

const [mode, directory, journalModule] = process.argv.slice(2);
const settings = { compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, stream: { maxRetries: 0 }, toolExecution: 'sequential' };
async function count(dir) {
  try { return (await readFile(join(dir, 'external-effects.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).length; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}
async function setup(dir, startup, options = {}) {
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  models.setProvider(faux.provider);
  faux.setResponses(startup ? [fauxAssistantMessage(fauxToolCall('effect', {}, { id: 'external-call' }), { stopReason: 'toolUse' }), fauxAssistantMessage('done')] : [fauxAssistantMessage('new explicit task')]);
  const registry = createRegistry();
  const capturedMessages = [];
  let mapped;
  registry.install(defineExtension({ name: 'fixture', hooks: [hook(GenerationTask, { beforeRequest: async () => {
    const messages = [{ role: 'user', content: 'FIXED_PRODUCT_SNAPSHOT', timestamp: 1 }];
    await mapped.journal.append('context.snapshot', { revision: 'fixture-1', messages });
    return { messages };
  } })], tools: [defineTool({
    name: 'effect', description: 'Local counted fixture effect', parameters: Type.Object({}),
    // Product bridge overrides any upstream/extension safe hint.
    replay: 'never',
    execute: async (_args, api) => {
      const file = await open(join(dir, 'external-effects.jsonl'), 'a');
      try { await file.writeFile(JSON.stringify({ taskId: api.taskId, callId: api.callId }) + '\n'); await file.sync(); }
      finally { await file.close(); }
      if (startup) { process.send({ type: 'effect-durable' }); await new Promise(() => {}); }
      return { content: [{ type: 'text', text: 'done' }] };
    },
  })] }));
  mapped = await openJournalStorage(join(dir, 'journal'), context, { journalModule, ...options });
  faux.setResponses([async request => {
    capturedMessages.push(request.messages);
    assert.deepEqual(request.messages, [{ role: 'user', content: 'FIXED_PRODUCT_SNAPSHOT', timestamp: 1 }]);
    assert.ok(mapped.journal.events.some(event => event.type === 'context.snapshot'));
    return startup ? fauxAssistantMessage(fauxToolCall('effect', {}, { id: 'external-call' }), { stopReason: 'toolUse' }) : fauxAssistantMessage('new explicit task');
  }]);
  const harness = await Harness.open(mapped.storage, { models, registry, settings }, context);
  return { ...mapped, harness, faux, capturedMessages };
}
if (mode === 'crash-child') {
  const { harness, faux } = await setup(directory, true);
  const model = faux.getModel();
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
  await (await root.submit({ type: 'input', content: 'kill fixture', requestId: 'original' }, context)).wait(context);
  throw new Error('Expected SIGKILL at tool result barrier');
} else if (mode === 'run') {
  await mkdir(directory, { recursive: false });
  const results = [];
  const crashDir = join(directory, 'crash'); await mkdir(crashDir);
  const child = fork(fileURLToPath(import.meta.url), ['crash-child', crashDir, journalModule], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Effect barrier timeout: ' + log)); }, 15000);
    child.once('message', message => { clearTimeout(timer); message.type === 'effect-durable' ? resolve() : reject(new Error('Unexpected IPC')); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Early exit ' + code + ': ' + log)); });
  });
  assert.equal(await count(crashDir), 1); child.kill('SIGKILL'); assert.equal((await exited).signal, 'SIGKILL');
  await writeFile(join(crashDir, 'child.log'), log);
  // Crash leaves the product lease. Reopen only after the known child lease becomes stale.
  await new Promise(resolve => setTimeout(resolve, 4000));
  const reopened = await setup(crashDir, false, { journalOptions: { lockStaleMs: 2000 } });
  try {
    const root = await reopened.harness.root(context);
    const entries = await root.entries({}, 100, undefined, context);
    const inspection = await reopened.harness.inspect(context);
    assert.ok(!entries.items.some(entry => entry.kind === 'pi.tool-result'));
    assert.equal(reopened.faux.state.callCount, 0);
    assert.equal(await count(crashDir), 1);
    assert.ok(reopened.mappings.length > 0);
    assert.ok(reopened.mappings.every((mapping, i, all) => !i || mapping.frameworkSeq > all[i - 1].frameworkSeq));
    assert.deepEqual((await readdir(join(crashDir, 'journal'))).filter(name => name.endsWith('.jsonl')), ['journal.jsonl']);
    await writeFile(join(crashDir, 'readonly.json'), JSON.stringify({ entries, inspection, mappings: reopened.mappings }, null, 2));
    results.push({ scenario: 'SIGKILL and read-only reconstruction', effects: 1, modelCalls: 0, singleJournal: true, commits: reopened.mappings.length });
    const unknown = inspection.tasks.filter(task => task.record.kind === 'pi.tool' && task.record.state.checkpoint?.phase === 'execute');
    assert.equal(unknown.length, 1);
    // Preserve external uncertainty separately from the framework's cancellation receipt.
    for (const task of unknown) await reopened.journal.append('tool.unknown', { frameworkTaskId: task.record.id, reason: 'result-not-committed' }, { toolCallId: task.record.input.callId });
    // Mark all old work before starting progress. Calling root.abort() first could enable scheduling.
    for (const task of inspection.tasks) await reopened.harness.abortTask(task.record.id, context);
    await reopened.harness.waitForIdle(context);
    assert.equal(await count(crashDir), 1);
    assert.equal(reopened.faux.state.callCount, 0);
    assert.ok(reopened.journal.events.some(event => event.type === 'tool.unknown'));
    const newTask = await root.submit({ type: 'input', content: 'explicit new task', requestId: 'new-command' }, context);
    await newTask.wait(context);
    await reopened.harness.waitForIdle(context);
    assert.equal(reopened.faux.state.callCount, 1);
    assert.equal(await count(crashDir), 1);
    assert.equal(reopened.capturedMessages.length, 1);
    assert.ok(reopened.mappings.some(mapping => mapping.journalSeq > mapping.frameworkSeq));
    results.push({ scenario: 'abort old tasks before explicit new submission', oldEffects: 1, oldModelCalls: 0, newModelCalls: 1, unknownEvidenceRetained: true, fixedContextAtProvider: true, distinctSequenceMapping: true });

  } finally { await reopened.harness.close(context); }

  for (const failurePoint of ['append', 'sync', 'watermark.rename']) {
    const dir = join(directory, failurePoint); await mkdir(dir);
    let fail = false;
    const instance = await setup(dir, false, { journalOptions: { beforeIO: async operation => {
      if (fail && operation === failurePoint) throw Object.assign(new Error('fixture ENOSPC'), { code: 'ENOSPC' });
    } } });
    let before;
    try {
      const model = instance.faux.getModel();
      const root = await instance.harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
      before = await root.entries({}, 100, undefined, context);
      fail = true;
      await assert.rejects(root.submit({ type: 'input', content: 'must not commit' }, context));
      assert.equal(instance.faux.state.callCount, 0);
      await assert.rejects(async () => instance.storage.scanTasks({}, 100, undefined, context), /poisoned/);
    } finally { fail = false; await instance.harness.close(context); }
    const restored = await setup(dir, false);
    try {
      const root = await restored.harness.root(context);
      assert.deepEqual(await root.entries({}, 100, undefined, context), before);
      assert.equal(restored.faux.state.callCount, 0);
      results.push({ scenario: 'Journal injected failure', failurePoint, unchangedReliableEntries: true, modelCalls: 0 });
    } finally { await restored.harness.close(context); }
  }
  await writeFile(join(directory, 'results.json'), JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, results }, null, 2) + '\n');
  console.log(JSON.stringify(results));
} else throw new Error('Usage: journal-storage-probe.mjs run <new output> <journal module URL>');
