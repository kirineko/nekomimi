import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { open, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Agent } from '@earendil-works/pi-agent-core';
import { AssistantMessageEventStream, Type } from '@earendil-works/pi-ai';

// An explicit fake JSON provider over loopback HTTP, not an OpenAI/DeepSeek adapter.
// All imports are public package exports; no reference sources or private reducers.
const root = process.env.PROBE_OUTPUT;
assert.ok(root, 'PROBE_OUTPUT must identify an isolated evidence directory');
const hash = body => createHash('sha256').update(body).digest('hex');
const model = { id: 'fixture', name: 'Fixture', api: 'openai-responses', provider: 'fixture', baseUrl: 'http://127.0.0.1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 512 };
const call = id => ({ type: 'toolCall', id, name: 'effect', arguments: { value: id } });
function message(stopReason, content = [{ type: 'text', text: 'done' }]) {
  return { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, ...(['error', 'aborted'].includes(stopReason) ? { errorMessage: `fixture ${stopReason}` } : {}) };
}
async function exercise(name, config = {}) {
  const dir = join(root, name); await mkdir(dir, { recursive: true });
  const journal = join(dir, 'journal.jsonl'); const fd = await open(journal, 'wx');
  const rows = [], bodies = [], executed = [], errors = []; let preparation = 0, turns = 0, agent;
  async function commit(type, data = {}) {
    const row = { seq: rows.length + 1, type, ...data };
    await fd.writeFile(JSON.stringify(row) + '\n'); await fd.sync(); rows.push(row); return row;
  }
  const readRows = async () => (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse);
  const tool = { name: 'effect', label: 'Effect', description: 'Fixture local effect', parameters: Type.Object({ value: Type.String() }), execute: async (id, args, signal) => {
    signal?.throwIfAborted();
    assert.ok((await readRows()).some(r => r.type === 'tool.intent' && r.id === id));
    executed.push(id); await commit('effect.observed', { id, args });
    if (config.cancel === 'tool') agent.abort();
    return { content: [{ type: 'text', text: args.value }], details: { id } };
  } };
  await commit('message', { message: { role: 'system', content: 'CANONICAL_FROM_JOURNAL', tools: [{ name: tool.name, description: tool.description, parameters: tool.parameters }], timestamp: 0 } });
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString(); const attempt = Number(req.headers['x-fixture-attempt']);
      const saved = (await readRows()).find(r => r.type === 'request.persisted' && r.attempt === attempt);
      assert.ok(saved, 'request must be fsynced before server receives it');
      assert.equal(body, saved.body); assert.equal(hash(body), saved.sha256);
      bodies.push(body); await commit('wire.received', { attempt, body, sha256: hash(body) });
      if (config.cancel === 'stream') agent.abort();
      const response = config.responses?.[bodies.length - 1] ?? message('stop');
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response));
    } catch (e) { errors.push(String(e.stack)); res.statusCode = 500; res.end('fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  agent = new Agent({
    initialState: { model, systemPrompt: 'UNTRUSTED_AGENT_SEED', tools: [tool] }, toolExecution: 'sequential',
    prepareRequest: async ({ context }, signal) => {
      preparation++; await commit('prepare', { preparation });
      if (config.cancel === 'prepare') agent.abort();
      const persisted = await readRows();
      assert.ok(persisted.some(r => r.type === 'message' && r.message.role === 'user'), 'input persisted before prepare');
      const messages = persisted.filter(r => r.type === 'message').map(r => r.message);
      // Only the persisted projection supplies provider context, not Agent's seed transcript.
      return { context: { ...context, messages } };
    },
    streamFn: async (selectedModel, context, options) => {
      const stream = new AssistantMessageEventStream(); let result;
      try {
        options?.signal?.throwIfAborted();
        const body = JSON.stringify({ model: selectedModel.id, messages: context.messages });
        const attempt = rows.filter(r => r.type === 'request.persisted').length + 1;
        assert.ok(!body.includes('UNTRUSTED_AGENT_SEED'));
        assert.ok(body.includes('CANONICAL_FROM_JOURNAL'));
        await commit('request.persisted', { attempt, body, sha256: hash(body) });
        options?.signal?.throwIfAborted();
        const response = await fetch(url, { method: 'POST', headers: { 'x-fixture-attempt': String(attempt) }, body, signal: options?.signal });
        if (!response.ok) throw new Error('fixture transport failed');
        result = await response.json();
      } catch (error) { result = message(options?.signal?.aborted ? 'aborted' : 'error'); }
      stream.push({ type: 'start', partial: result });
      stream.push(['error', 'aborted'].includes(result.stopReason) ? { type: 'error', reason: result.stopReason, error: result } : { type: 'done', reason: result.stopReason, message: result });
      return stream;
    },
    beforeToolCall: async ({ toolCall }, signal) => {
      signal?.throwIfAborted();
      assert.ok((await readRows()).some(r => r.type === 'message' && r.message.role === 'assistant' && r.message.content.some(c => c.id === toolCall.id)));
      await commit('tool.intent', { id: toolCall.id });
    },
    afterToolCall: async ({ toolCall, isError }) => { await commit('tool.result', { id: toolCall.id, isError }); },
    finishTurn: async ({ message: result, toolResults }) => {
      turns++; await commit('finish', { turns, stopReason: result.stopReason, toolResults: toolResults.map(r => r.toolCallId) });
      if (config.queues) {
        agent.steer({ role: 'user', content: 'queued-steer', timestamp: 2 });
        agent.followUp({ role: 'user', content: 'queued-followup', timestamp: 3 });
      }
      if (config.endAt && turns >= config.endAt) return { action: 'end' };
      if (config.forceContinue && turns <= config.forceContinue) return { action: 'continue' };
    },
  });
  agent.subscribe(async event => {
    if (event.type === 'message_end') {
      await commit('message', { message: event.message });
      if (event.message.role === 'assistant' && config.cancel === 'assistant') agent.abort();
    } else if (event.type === 'turn_end') await commit('turn_end');
    else if (event.type === 'agent_end') await commit('agent_end');
  });
  try {
    await agent.prompt('fixture input'); await agent.waitForIdle();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.equal(agent.state.isStreaming, false);
    const saved = await readRows();
    assert.equal(saved.at(-1).type, 'agent_end');
    assert.equal(saved.filter(r => r.type === 'finish').length, turns);
    for (const end of saved.filter(r => r.type === 'turn_end')) assert.equal(saved[end.seq - 2].type, 'finish');
    assert.equal(bodies.length, config.requests ?? 1);
    assert.equal(executed.length, config.effects ?? 0);
    assert.equal(preparation, config.prepares ?? config.requests ?? 1);
    assert.equal(turns, config.turns ?? config.requests ?? 1);
    if (config.queues) assert.equal(agent.hasQueuedMessages(), true, 'hard exit/end must not drain queues');
    if (config.expectedStop) assert.equal(saved.filter(r => r.type === 'finish').at(-1).stopReason, config.expectedStop);
    if (config.checkToolContinuation) {
      const next = JSON.parse(bodies[1]);
      assert.ok(next.messages.some(m => m.role === 'toolResult' && m.toolCallId === 'first'));
      assert.ok(next.messages.some(m => m.role === 'assistant' && m.content.some(c => c.id === 'first')));
      assert.equal(saved.filter(r => r.type === 'tool.intent').length, 1);
      assert.equal(saved.filter(r => r.type === 'tool.result').length, 1);
    }
    await commit('probe.passed', { requests: bodies.length, effects: executed, preparation, turns });
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fd.close();
  }
}

test('first request uses persisted canonical projection; no-tool response ends', { timeout: 10000 }, () => exercise('first'));
test('tool continuation is prepared, persisted and sent exactly once even with continue', { timeout: 10000 }, () => exercise('tool-continuation', { responses: [message('toolUse', [call('first')]), message('stop')], forceContinue: 1, requests: 2, effects: 1, checkToolContinuation: true }));
test('continue without tools forces one context-only request', { timeout: 10000 }, () => exercise('context-continue', { forceContinue: 1, requests: 2 }));
test('end skips queued steering/followup and next prepare', { timeout: 10000 }, () => exercise('end-queues', { endAt: 1, queues: true }));
test('host maximum turns ends repeated tool loop at three, without fourth dispatch', { timeout: 10000 }, () => exercise('max-turns', { responses: [1,2,3,4].map(i => message('toolUse', [call(`max-${i}`)])), endAt: 3, requests: 3, effects: 3 }));
for (const reason of ['error', 'aborted']) test(`${reason} ignores continue and queued input; does not execute embedded tool`, { timeout: 10000 }, () => exercise(reason, { responses: [message(reason, [call('forbidden')])], forceContinue: 10, queues: true, expectedStop: reason }));
test('abort during prepare prevents provider and tools', { timeout: 10000 }, () => exercise('abort-prepare', { cancel: 'prepare', requests: 0, prepares: 1, turns: 0 }));
test('abort in provider stops continuation', { timeout: 10000 }, () => exercise('abort-stream', { cancel: 'stream', forceContinue: 10, expectedStop: 'aborted' }));
test('abort after assistant persistence prevents tool side effects', { timeout: 10000 }, () => exercise('abort-assistant', { cancel: 'assistant', responses: [message('toolUse', [call('forbidden')])] }));
test('abort during first sequential tool prevents second tool and next request', { timeout: 10000 }, () => exercise('abort-tool', { cancel: 'tool', responses: [message('toolUse', [call('started'), call('forbidden')])], effects: 1 }));
