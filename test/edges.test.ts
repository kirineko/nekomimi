import { it, expect } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/runtime.js';
import { Journal, readSession } from '../src/journal.js';
import { CoreTools } from '../src/tools.js';
import { temporary, key, response, callItem, textItem, delay } from './helpers.js';
it('cancels an outstanding request and starts no retries', async () => {
  const workspace = await temporary(); const abort = new AbortController(); let calls = 0;
  const result = await run({ workspace, session: join(workspace, 's'), prompt: 'hello', apiKey: key, signal: abort.signal, fetch: async (_u, init) => {
    calls++; setTimeout(() => abort.abort(), 20);
    return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  expect(result.status).toBe('cancelled'); expect(calls).toBe(1);
});
it('durability failure blocks a tool before dispatch', async () => {
  const workspace = await temporary(); let fail = false;
  const result = await run({ workspace, session: join(workspace, 's'), prompt: 'write', apiKey: key,
    journalOptions: { beforeIO: async operation => { if (fail && operation === 'sync') throw new Error('synthetic disk full'); } },
    fetch: async () => { fail = true; return response([callItem('write', { path: 'never', content: 'bad' })]); } });
  expect(result.status).toBe('failed'); await expect(readFile(join(workspace, 'never'))).rejects.toThrow();
});
it('passes user and read-tool images through original wire history', async () => {
  const workspace = await temporary(); const png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
  await writeFile(join(workspace, 'pixel.png'), Buffer.from(png, 'base64')); const bodies: any[] = [];
  const result = await run({ workspace, session: join(workspace, 's'), prompt: 'read image', apiKey: key, images: [{ type: 'image', mimeType: 'image/png', data: png }],
    fetch: async (_u, init) => { bodies.push(JSON.parse(String(init?.body))); return bodies.length === 1 ? response([callItem('read', { path: 'pixel.png' })]) : response([textItem()]); } });
  expect(result.status).toBe('completed');
  expect(bodies[0].input[0].content[1].type).toBe('input_image');
  expect(bodies[1].input.find((i: any) => i.type === 'function_call_output').output[0].type).toBe('input_image');
});
it('keeps separate results for multiple calls and bounds agent turns', async () => {
  const workspace = await temporary(); let count = 0;
  const result = await run({ workspace, session: join(workspace, 's'), prompt: 'write two', apiKey: key, maxTurns: 2,
    fetch: async () => { count++; return response([callItem('write', { path: `file${count}a`, content: 'a' }, `a${count}`), callItem('write', { path: `file${count}b`, content: 'b' }, `b${count}`)]); } });
  expect(result.status).toBe('failed'); expect(count).toBe(2);
  expect((await readSession(result.session)).events.filter(e => e.type === 'tool.result')).toHaveLength(4);
});
it('awaits slow journal writes and records shell timeout after termination', async () => {
  const workspace = await temporary(); let syncs = 0;
  const journal = await Journal.open(join(workspace, 's'), { beforeIO: async op => { if (op === 'sync') { syncs++; await delay(3); } } });
  try {
    const tools = await CoreTools.create(workspace, journal, {});
    const shell = tools.definitions().find(d => d.tool.name === 'bash');
    if (!shell) return;
    await shell.tool.execute('timeout', { command: 'sleep 10', timeout: 30 });
    expect(journal.events.find(e => e.type === 'shell.finished')?.payload).toMatchObject({ reason: 'timeout' });
    expect(syncs).toBeGreaterThan(0);
  } finally { await journal.close(); }
});
it('applies storage backpressure before draining the network stream', async () => {
  const workspace = await temporary(); let pulls = 0; let capture = false; let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const promise = run({ workspace, session: join(workspace, 's'), prompt: 'hi', apiKey: key,
    journalOptions: { beforeIO: async op => { if (capture && op === 'artifact') await gate; } },
    fetch: async () => { capture = true; const bytes = new TextEncoder().encode('data: {"type":"future"}\n\n'); return new Response(new ReadableStream({ pull(c) { pulls++; if (pulls <= 4) c.enqueue(bytes); else c.close(); } }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } }); } });
  await delay(150); expect(pulls).toBeLessThanOrEqual(1); release();
  expect((await promise).status).toBe('failed'); expect(pulls).toBe(5);
});
