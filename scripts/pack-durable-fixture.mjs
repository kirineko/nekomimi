// Run with the installed package entry URL and an isolated temporary directory.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [entry, directory] = process.argv.slice(2);
const { run, readSession, readArtifact } = await import(entry);
await mkdir(directory, { recursive: true });
const workspace = join(directory, 'workspace'), home = join(directory, 'home');
await mkdir(workspace); await mkdir(home);
const text = value => ({ type: 'message', id: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: value, annotations: [] }] });
const tool = (name, args) => ({ type: 'function_call', id: 'tool', call_id: 'effect', name, arguments: JSON.stringify(args), status: 'completed' });
const reasoning = { type: 'reasoning', id: 'reasoning', status: 'completed', content: [{ type: 'reasoning_text', text: 'installed reasoning' }] };
function wire(items) {
  const events = [{ type: 'response.created', response: { id: 'response', status: 'in_progress' } }];
  for (const [index, item] of items.entries()) {
    events.push({ type: 'response.output_item.added', output_index: index, item: { ...item, ...(item.content ? { content: [] } : {}) } });
    if (item.type === 'message') events.push({ type: 'response.content_part.added', output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }, { type: 'response.output_text.delta', output_index: index, content_index: 0, delta: item.content[0].text });
    if (item.type === 'reasoning') events.push({ type: 'response.reasoning_text.delta', output_index: index, content_index: 0, delta: item.content[0].text });
    events.push({ type: 'response.output_item.done', output_index: index, item });
  }
  events.push({ type: 'response.completed', response: { id: 'response', status: 'completed', output: items } });
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}
const response = items => new Response(wire(items), { headers: { 'content-type': 'text/event-stream' } });
const session = join(directory, 'wire-session'), bodies = [];
const result = await run({ workspace, home, session, apiKey: 'fixture', prompt: 'write', tools: ['write'], fetch: async (_url, init) => {
  bodies.push(String(init.body));
  return response(bodies.length === 1 ? [reasoning, tool('write', { path: 'written', content: 'installed' })] : [text('done')]);
} });
assert.equal(result.status, 'completed'); assert.equal(bodies.length, 2);
assert.equal(await readFile(join(workspace, 'written'), 'utf8'), 'installed');
assert.equal(JSON.parse(bodies[0]).tool_choice, 'auto');
assert.deepEqual(JSON.parse(bodies[1]).input.find(item => item.type === 'reasoning'), reasoning);
assert.equal(JSON.parse(bodies[1]).input.filter(item => item.type === 'function_call_output' && item.call_id === 'effect').length, 1);
const snapshot = await readSession(session);
for (const [index, event] of snapshot.events.filter(event => event.type === 'request.dispatched').entries()) {
  const bytes = await readArtifact(snapshot.directory, event.payload.body);
  assert.equal(bytes.toString(), bodies[index]);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), event.payload.bodyHash);
}
const crashSession = join(directory, 'crash-session'), effect = join(workspace, 'effects'), childFile = join(directory, 'crash.mjs');
await writeFile(childFile, `import {run} from ${JSON.stringify(entry)};import {existsSync} from 'node:fs';
await run({workspace:${JSON.stringify(workspace)},home:${JSON.stringify(home)},session:${JSON.stringify(crashSession)},apiKey:'fixture',prompt:'effect',tools:['bash'],journalOptions:{lockStaleMs:2000,beforeIO:async point=>{if(point==='append'&&existsSync(${JSON.stringify(effect)})){process.send({ready:true});await new Promise(()=>{});}}},fetch:async()=>new Response(${JSON.stringify(wire([tool('bash', { command: 'printf effect >> effects' })]))},{headers:{'content-type':'text/event-stream'}})});`);
const child = fork(childFile, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Effect barrier timeout: ' + stderr)), 15000);
    child.once('message', message => { clearTimeout(timer); try { assert.deepEqual(message, { ready: true }); resolve(); } catch (error) { reject(error); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Early exit: ' + stderr)); });
  });
  child.kill('SIGKILL'); assert.equal((await exited).signal, 'SIGKILL');
  const before = await readSession(crashSession);
  assert.equal(before.events.filter(event => event.type === 'tool.intent').length, 1);
  assert.equal(before.events.filter(event => event.type === 'tool.completed').length, 0);
  assert.equal(await readFile(effect, 'utf8'), 'effect');
  await new Promise(resolve => setTimeout(resolve, 3300));
  let requests = 0;
  const continued = await run({ workspace, home, session: crashSession, apiKey: 'fixture', prompt: 'explicit continuation', tools: ['bash'], journalOptions: { lockStaleMs: 2000 }, fetch: async () => { requests++; return response([text('continued')]); } });
  assert.equal(continued.status, 'completed'); assert.equal(requests, 1);
  assert.equal(await readFile(effect, 'utf8'), 'effect');
  const recovered = await readSession(crashSession);
  assert.equal(recovered.events.filter(event => event.type === 'tool.intent').length, 1);
  assert.ok(recovered.events.some(event => event.type === 'tool.unknown'));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, entry, directory, wireBytesAndHash: true, reasoningAndToolPair: true, durableCrashNoReplay: true }));
