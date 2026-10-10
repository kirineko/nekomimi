import test from 'node:test';
import assert from 'node:assert/strict';
import { open, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolCall } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { CodemodeSandbox, loadQuickJSWasm } from '@earendil-works/pi-codemode';
const root = process.env.PROBE_OUTPUT; assert.ok(root);
async function fixture(name, body) {
  await mkdir(root, { recursive: true }); const fd = await open(join(root, name + '.jsonl'), 'wx');
  let serial = Promise.resolve(), seq = 0, nextId = 0, effects = 0, allowed = true, failIntent = false;
  const rows = [];
  const commit = (type, data = {}) => {
    const pending = serial.then(async () => {
      if (type === 'intent' && failIntent) throw new Error('fixture intent unavailable');
      const row = { seq: ++seq, type, ...data }; await fd.writeFile(JSON.stringify(row) + '\n'); await fd.sync(); rows.push(row);
    });
    serial = pending.catch(() => {}); return pending;
  };
  const tool = { name: 'effect', label: 'Effect', description: 'Fixture effect', parameters: Type.Object({ value: Type.Number() }), execute: async (id, args, signal) => {
    signal?.throwIfAborted(); assert.ok(rows.some(r => r.type === 'intent' && r.id === id)); effects++;
    return { content: [{ type: 'text', text: String(args.value) }], structuredContent: args, details: { effect: effects } };
  } };
  async function invoke(args, parent, signal) {
    const id = `child-${++nextId}`;
    const outcome = await runToolCall({ type: 'toolCall', id, name: tool.name, arguments: args }, {
      tools: [tool], context: { messages: [], tools: [tool] }, assistantMessage: { role: 'assistant', content: [], stopReason: 'toolUse' }, signal,
      beforeToolCall: async () => {
        signal?.throwIfAborted(); await commit('authorize', { id, parent, allowed, version: 'fixture-v1', args });
        if (!allowed) return { block: true, reason: 'revoked' };
        await commit('intent', { id, parent });
      },
      afterToolCall: async () => { await commit('after-hook', { id, parent }); },
    });
    await commit('result', { id, parent, isError: outcome.isError, result: outcome.result });
    if (outcome.isError) throw new Error(outcome.result.content.map(c => c.text ?? '').join(''));
    return outcome.result.structuredContent;
  }
  const sandbox = new CodemodeSandbox({ timeoutMs: 3000, memoryLimitBytes: 16 * 1024 * 1024,
    workerUrl: new URL('./worker.mjs', import.meta.url), wasm: loadQuickJSWasm(fileURLToPath(new URL('./quickjs.wasm', import.meta.url))),
    tools: [{ name: 'effect', execute: (args, { signal }) => invoke(args, 'script-1', signal) }, { name: 'revoke', execute: async () => { allowed = false; return true; } }],
  });
  try { await body({ sandbox, invoke, rows, commit, count: () => effects, fail: () => { failIntent = true; } }); await commit('probe.passed'); }
  finally { await sandbox.close(); await serial; await fd.close(); }
}
test('direct and nested tools share exactly one authorization, intent, hook and result per call', () => fixture('shared-pipeline', async ({ sandbox, invoke, rows, count }) => {
  await invoke({ value: 1 }, null);
  const result = await sandbox.execute('return await tools.effect({value: 2});'); assert.equal(result.ok, true); assert.equal(result.value.value, 2); assert.equal(count(), 2);
  for (const id of ['child-1', 'child-2']) for (const type of ['authorize', 'intent', 'after-hook', 'result']) assert.equal(rows.filter(r => r.id === id && r.type === type).length, 1);
  assert.equal(rows.find(r => r.id === 'child-2' && r.type === 'intent').parent, 'script-1');
}));
test('revocation after discovery blocks execution', () => fixture('revocation', async ({ sandbox, count, rows }) => {
  const r = await sandbox.execute('const catalog = ALL_TOOLS; await tools.revoke({}); return await tools.effect({value: 1});'); assert.equal(r.ok, false); assert.equal(count(), 0); assert.equal(rows.filter(r => r.type === 'intent').length, 0);
}));
test('intent persistence failure prevents effect', () => fixture('intent-failure', async ({ sandbox, count, fail }) => {
  fail(); const r = await sandbox.execute('await tools.effect({value: 1});'); assert.equal(r.ok, false); assert.equal(count(), 0);
}));
test('script failure preserves successful child evidence, never commits script store writes', () => fixture('partial-success', async ({ sandbox, count, rows, commit }) => {
  const r = await sandbox.execute('await tools.effect({value: 7}); store("draft", 1); throw Error("after effect");');
  assert.equal(r.ok, false); assert.equal(count(), 1); assert.equal(r.storeWrites, undefined); assert.equal(rows.filter(r => r.type === 'result' && !r.isError).length, 1);
  await commit('script.failed', { error: r.error, calls: r.calls });
}));
test('invalid nested schema is rejected before authorization/execution', () => fixture('schema', async ({ sandbox, count, rows }) => {
  const r = await sandbox.execute('await tools.effect({value: "bad"});'); assert.equal(r.ok, false); assert.equal(count(), 0); assert.equal(rows.filter(r => r.type === 'authorize').length, 0);
}));
test('no ambient host I/O; CPU, memory and output failures are bounded', { timeout: 15000 }, () => fixture('limits', async ({ sandbox, commit }) => {
  const env = await sandbox.execute('return [typeof process, typeof fetch, typeof require, typeof WebAssembly];'); assert.equal(env.ok, true); assert.deepEqual(env.value, ['undefined', 'undefined', 'undefined', 'undefined']);
  const spin = await sandbox.execute('while(true) {}', { timeoutMs: 100 }); assert.equal(spin.ok, false); assert.equal(spin.error.kind, 'timeout');
  const memory = await sandbox.execute('const a=[]; while(true) a.push(new Array(10000).fill(123));'); assert.equal(memory.ok, false);
  const output = await sandbox.execute('for(let i=0;i<30000;i++) text("x".repeat(1024));'); assert.equal(output.ok, false);
  await commit('limits', { spin: spin.error, memory: memory.error, output: output.error });
}));
test('abort is terminal and completed child remains recorded', () => fixture('abort', async ({ sandbox, commit, count }) => {
  const abort = new AbortController(); const r = await sandbox.execute('await tools.effect({value: 1});'); assert.equal(r.ok, true); abort.abort();
  const stopped = await sandbox.execute('await tools.effect({value: 2});', { signal: abort.signal }); assert.equal(stopped.ok, false); assert.equal(stopped.error.kind, 'aborted'); assert.equal(count(), 1); await commit('script.aborted', { calls: stopped.calls });
}));
test('successful store writes are explicit outputs, not global sandbox state', () => fixture('store', async ({ sandbox }) => {
  const r = await sandbox.execute('store("x", (load("x") ?? 0) + 1); return load("x");', { store: { x: 2 } }); assert.equal(r.ok, true); assert.equal(r.value, 3); assert.deepEqual(r.storeWrites.set, { x: 3 });
  const fresh = await sandbox.execute('return load("x");'); assert.equal(fresh.ok, true); assert.equal(fresh.value, undefined);
}));
