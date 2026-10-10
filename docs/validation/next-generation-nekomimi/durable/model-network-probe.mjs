import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { Harness, createRegistry, defineExtension, hook, GenerationTask } from '@earendil-works/pi-durable';

const [directory, moduleUrl] = process.argv.slice(2);
const { openJournalStorage } = await import(moduleUrl);
const { executeRecordedModel } = await import(new URL('./model-service.js', moduleUrl).href);
const { readArtifact, hash } = await import(new URL('../journal.js', moduleUrl).href);
await mkdir(directory, { recursive: false });
const handle = await openJournalStorage(join(directory, 'journal'), context);
const models = createModels(); const faux = fauxProvider({ tokensPerSecond: Infinity }); models.setProvider(faux.provider);
const registry = createRegistry(); const received = []; const publications = []; const publicationErrors = []; let currentTask;
registry.install(defineExtension({ name: 'product-context', hooks: [hook(GenerationTask, { beforeRequest: async (_request, api) => {
  currentTask = { frameworkTaskId: api.taskId, conversationId: api.conversationId };
  const messages = [{ role: 'user', content: 'PRODUCT_CANONICAL_INPUT', timestamp: 1 }];
  await handle.journal.append('context.snapshot', { revision: 'network-1', messages }, currentTask);
  return { messages };
} })] }));
const server = createServer(async (request, response) => {
  try {
    const bytes = []; for await (const chunk of request) bytes.push(chunk);
    const body = Buffer.concat(bytes).toString(); received.push(body);
    const record = handle.journal.events.filter(event => event.type === 'request.dispatched').at(-1);
    assert.ok(record.seq <= handle.journal.durableSeq);
    assert.equal((await readArtifact(handle.journal.directory, record.payload.body)).toString(), body);
    assert.equal(record.payload.bodyHash, hash(body));
    assert.deepEqual(JSON.parse(body).messages, [{ role: 'user', content: 'PRODUCT_CANONICAL_INPUT', timestamp: 1 }]);
    if (received.length === 1) { response.writeHead(429); response.end('rate limited'); }
    else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"answer":');
      setTimeout(() => response.end('"wire complete"}'), 5);
    }
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
faux.setResponses([async (request, options) => {
  const response = await executeRecordedModel(handle.journal, {
    url: `http://127.0.0.1:${server.address().port}/model`, body: JSON.stringify({ model: 'fixture', messages: request.messages, tools: request.tools }),
    provider: 'fixture', model: 'fixture', protocol: 'loopback-json', purpose: 'work', operation: 'chat', contextRevision: 'network-1',
    links: { ...currentTask, mode: 'work', targetId: 'fixture-project' }, signal: options?.signal,
    maxAttempts: 2, retryDelayMs: 0, decode: response => response.json(),
  });
  return fauxAssistantMessage(response.value.answer);
}]);
const harness = await Harness.open(handle.storage, { models, registry, settings: { compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 }, stream: { maxRetries: 0 } } }, context);
const unsubscribe = harness.subscribeCommits(publication => {
  try {
    const mapping = handle.mappings().find(mapping => mapping.frameworkSeq === publication.seq);
    assert.ok(mapping && mapping.journalSeq <= handle.journal.durableSeq);
    publications.push({ ...mapping, changes: publication.changes.length });
  } catch (error) { publicationErrors.push(String(error)); }
});
try {
  const selected = faux.getModel();
  const root = await harness.root(context, { agent: { model: { provider: selected.provider, modelId: selected.id } } });
  await (await root.submit({ type: 'input', content: 'untrusted seed replaced', requestId: 'network-fixture' }, context)).wait(context);
  await harness.waitForIdle(context);
  assert.equal(received.length, 2); assert.equal(faux.state.callCount, 1);
  const attempts = handle.journal.events.filter(event => event.type === 'attempt.started');
  assert.equal(attempts.length, 2); assert.equal(new Set(attempts.map(event => event.attemptId)).size, 2);
  assert.ok(attempts.every(event => event.frameworkTaskId === currentTask.frameworkTaskId));
  const chunks = handle.journal.events.filter(event => event.type === 'response.chunk');
  const raw = Buffer.concat(await Promise.all(chunks.map(event => readArtifact(handle.journal.directory, event.payload.artifact)))).toString();
  assert.equal(raw, 'rate limited{"answer":"wire complete"}');
  assert.ok(publications.length > 0);
  assert.deepEqual(publicationErrors, []);
  await writeFile(join(directory, 'results.json'), JSON.stringify({ node: process.version, requests: received.length, attempts: attempts.length, exactBytesAndHash: true,
    fixedContextAtWire: true, rawResponse: raw, reliablePublications: publications, noHiddenFrameworkRetry: faux.state.callCount === 1 }, null, 2));
  console.log(JSON.stringify({ node: process.version, requests: 2, exactBytesAndHash: true, fixedContextAtWire: true, rawResponseCaptured: true, reliablePublications: publications.length }));
} finally { unsubscribe(); await harness.close(context); await new Promise(resolve => server.close(resolve)); }
