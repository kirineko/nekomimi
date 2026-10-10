import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createModels, createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import * as chatApi from '@earendil-works/pi-ai/api/openai-completions';
import * as imageApi from '@earendil-works/pi-ai/api/openrouter-images';
import * as classifierApi from '@earendil-works/pi-ai/api/typesafe-system-one';
const root = process.env.PROBE_OUTPUT; assert.ok(root);
const cost = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
const common = { id: 'same-id', name: 'Fixture', provider: 'fixture', baseUrl: 'https://fixture.invalid/v1', input: ['text'], cost };
const chat = { ...common, type: 'chat', api: 'openai-completions', contextWindow: 8192, maxTokens: 128, reasoning: false };
const image = { ...common, type: 'image', api: 'openrouter-images', output: ['image'] };
const classifier = { ...common, type: 'classifier', api: 'typesafe-system-one', contextWindow: 8192 };
const models = createModels();
models.setProvider(createProvider({ id: 'fixture', auth: { apiKey: envApiKeyAuth('fixture', []) }, models: [chat, image, classifier], api: chatApi, images: { 'openrouter-images': imageApi }, classifiers: { 'typesafe-system-one': classifierApi } }));
const contexts = {
  chat: { messages: [{ role: 'user', content: 'fixture', timestamp: 0 }] },
  image: { input: [{ type: 'text', text: 'fixture image' }] },
  classifier: { state: { text: 'fixture' }, questions: { ready: { type: 'bool', instructions: 'Is ready?', criteria: { true: 'Ready', false: 'Not ready' } } } },
};
function responseFor(kind) {
  if (kind === 'chat') return { type: 'text/event-stream', body: 'data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }) + '\n\ndata: [DONE]\n\n' };
  if (kind === 'image') return { type: 'application/json', body: JSON.stringify({ id: 'fixture-image', choices: [{ message: { content: '', images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }) };
  return { type: 'application/json', body: JSON.stringify({ model: 'same-id', answers: { ready: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 3, output_tokens: 1 } }) };
}
async function run(kind, scenario) {
  await mkdir(root, { recursive: true }); const fd = await open(join(root, `${kind}-${scenario}.jsonl`), 'wx');
  const abort = new AbortController(); let attempts = 0;
  const write = async value => { await fd.writeFile(JSON.stringify(value) + '\n'); await fd.sync(); };
  const fetch = async (input, init) => {
    abort.signal.throwIfAborted();
    const request = new Request(input, init); const body = await request.clone().text(); attempts++;
    assert.equal(new URL(request.url).hostname, 'fixture.invalid', 'never send to real provider');
    await write({ type: 'request', callId: `${kind}-${scenario}`, attempt: attempts, url: request.url, body, sha256: createHash('sha256').update(body).digest('hex') });
    if (scenario === 'cancel') { abort.abort(); await write({ type: 'transport.aborted', attempt: attempts }); throw new DOMException('fixture abort', 'AbortError'); }
    const rate = scenario === 'rate' && attempts === 1; const response = rate ? { type: 'application/json', body: JSON.stringify({ error: { message: 'fixture rate limit' } }) } : responseFor(kind);
    await write({ type: 'response', attempt: attempts, status: rate ? 429 : 200, body: response.body });
    return new Response(response.body, { status: rate ? 429 : 200, headers: { 'content-type': response.type, 'retry-after': '0' } });
  };
  try {
    const options = { apiKey: 'fixture-not-a-real-key', fetch, signal: abort.signal, maxRetries: scenario === 'rate' ? 1 : 0, maxRetryDelayMs: 1000 };
    const model = models.getModelOfType(kind, 'fixture', 'same-id'); assert.ok(model);
    const result = kind === 'chat' ? await models.complete(model, contexts.chat, options) : kind === 'image' ? await models.generateImages(model, contexts.image, options) : await models.classify(model, contexts.classifier, options);
    assert.equal(result.stopReason, scenario === 'cancel' ? 'aborted' : 'stop', result.errorMessage);
    assert.equal(attempts, scenario === 'rate' ? 2 : 1);
    if (scenario !== 'cancel') {
      if (kind === 'classifier') assert.equal(result.answers.ready.probability, 0.9);
      if (kind === 'image') assert.equal(result.output[0].type, 'image');
      if (kind === 'chat') assert.equal(result.content.find(c => c.type === 'text').text, 'hello');
    }
    await write({ type: 'probe.passed', attempts, operation: kind, stopReason: result.stopReason, usage: result.usage });
  } finally { await fd.close(); }
}
for (const kind of ['chat', 'classifier', 'image']) for (const scenario of ['success', 'rate', 'cancel']) test(`${kind}/${scenario}: all serialized attempts and raw responses cross injected fetch`, { timeout: 15000 }, () => run(kind, scenario));
test('typed catalog does not collide; unavailable auth and route API remain explicit', async () => {
  assert.equal(models.getAllModels('fixture').length, 3);
  for (const type of ['chat', 'classifier', 'image']) assert.equal(models.getModelOfType(type, 'fixture', 'same-id').type, type);
  assert.equal((await models.getAllAvailable('fixture')).length, 0);
  assert.equal(typeof models.registerVirtualModel, 'undefined', 'Pi Models is not coding-agent virtual model runtime');
});
