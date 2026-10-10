import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, Type } from '@earendil-works/pi-ai';
import { Harness, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
const [directory, moduleUrl] = process.argv.slice(2);
const { openJournalStorage } = await import(moduleUrl);
const { durableContext } = await import(new URL('./task-context.js', moduleUrl).href);
await mkdir(directory, { recursive: false });
const results = [];
for (const failurePoint of ['append', 'sync', 'watermark.write', 'watermark.rename']) {
  let fail = false; let effects = 0; let intentReached = false;
  const handle = await openJournalStorage(join(directory, failurePoint), context, { beforeIO: async operation => {
    if (fail && operation === failurePoint) throw Object.assign(new Error('intent ENOSPC'), { code: 'ENOSPC' });
  } });
  const storage = new Proxy(handle.storage, { get(target, name) {
    if (name !== 'commit') return Reflect.get(target, name);
    return async (writes, commitContext) => {
      if (writes.some(write => write.type === 'task' && write.value.kind === 'pi.tool' && write.value.state.checkpoint?.phase === 'execute')) {
        intentReached = true; fail = true;
      }
      return target.commit(writes, commitContext);
    };
  } });
  const models = createModels(); const faux = fauxProvider({ tokensPerSecond: Infinity }); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage(fauxToolCall('effect', {}, { id: 'intent-fixture' }), { stopReason: 'toolUse' })]);
  const registry = createRegistry(); registry.install(defineExtension({ name: 'intent-fixture', tools: [defineTool({
    name: 'effect', description: 'Counted effect', parameters: Type.Object({}), replay: 'never',
    execute: async () => { effects++; return { content: [{ type: 'text', text: 'done' }] }; },
  })] }));
  const settings = { compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, stream: { maxRetries: 0 } };
  const harness = await Harness.open(storage, { models, registry, settings }, context);
  const publicationErrors = []; let publications = 0;
  const unsubscribe = harness.subscribeCommits(publication => {
    const mapping = handle.mappings().find(mapping => mapping.frameworkSeq === publication.seq);
    if (!mapping || mapping.journalSeq > handle.journal.durableSeq) publicationErrors.push(publication.seq);
    publications++;
  });
  try {
    const model = faux.getModel();
    const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
    const executionContext = durableContext(handle.journal, context);
    const task = await root.submit({ type: 'input', content: 'call effect', requestId: 'intent-test' }, executionContext);
    await assert.rejects(task.wait(executionContext));
    assert.ok(intentReached); assert.equal(effects, 0); assert.ok(handle.journal.failure.signal.aborted);
    assert.deepEqual(publicationErrors, []); assert.ok(publications > 0);
  } finally { unsubscribe(); fail = false; await harness.close(context); }
  const reopened = await openJournalStorage(join(directory, failurePoint), context);
  try {
    const tasks = await reopened.storage.scanTasks({}, 100, undefined, context);
    assert.ok(!tasks.items.some(task => task.kind === 'pi.tool' && task.state.checkpoint?.phase === 'execute'));
    assert.equal(effects, 0);
    results.push({ failurePoint, intentReached, effects, reliablePublicationsOnly: true, noUnconfirmedIntentRecovered: true });
  } finally { await reopened.storage.close(context); }
}
await writeFile(join(directory, 'results.json'), JSON.stringify({ node: process.version, results }, null, 2));
console.log(JSON.stringify({ node: process.version, results }));
