import { it, expect } from 'vitest';
import { writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Journal, readArtifact } from '../src/journal.js';
import { CoreTools } from '../src/tools.js';
import { StreamRedactor } from '../src/redaction.js';
import { run } from '../src/runtime.js';
import { exportSession } from '../src/export.js';
import { temporary, delay, encode, events, textItem, key } from './helpers.js';

it('redacts every split of a credential and preserves adjacent binary bytes', () => {
  const secret = Buffer.from('合成-review-secret');
  const before = Buffer.from([0xff, 0x00, 0xfe]);
  const after = Buffer.from([0x80, 0x81]);
  for (let split = 1; split < secret.length; split++) {
    const redactor = new StreamRedactor([secret.toString()]);
    const parts = [
      redactor.push(Buffer.concat([before, secret.subarray(0, split)])),
      redactor.push(Buffer.concat([secret.subarray(split), after])),
      redactor.push(Buffer.alloc(0), true),
    ];
    expect(Buffer.concat(parts.map(p => p.bytes))).toEqual(Buffer.concat([before, Buffer.from('[REDACTED]'), after]));
    expect(parts.some(p => p.redacted)).toBe(true);
  }
  const completeFrame = Buffer.from('data: {"type":"response.completed"}\n\n');
  expect(new StreamRedactor([key]).push(completeFrame).bytes).toEqual(completeFrame);
  const redactor = new StreamRedactor(['long-secret', 'secret']);
  const raw = Buffer.concat([before, Buffer.from('long-secret secret incomplete-secr'), after]);
  const parts = [...raw].map(byte => redactor.push(Buffer.from([byte])).bytes);
  parts.push(redactor.push(Buffer.alloc(0), true).bytes);
  expect(Buffer.concat(parts)).toEqual(Buffer.concat([before, Buffer.from('[REDACTED] [REDACTED] incomplete-secr'), after]));
});

it('redacts split shell credentials in both channels, saved artifacts and exports', async () => {
  if (process.platform === 'win32') return;
  const dir = await temporary();
  const j = await Journal.open(join(dir, 'session'), { secrets: [key] });
  try {
    const tools = await CoreTools.create(dir, j, {});
    await writeFile(join(dir, 'output.cjs'), `process.stdout.write('synthetic-api-');process.stderr.write('synthetic-api-');setTimeout(()=>{process.stdout.write('key-not-real');process.stderr.write('key-not-real');},100);`);
    await tools.definitions().find(d => d.tool.name === 'bash')!.tool.execute('redact', { command: `'${process.execPath}' output.cjs` });
    for (const channel of ['stdout', 'stderr']) {
      const output = j.events.filter(e => e.type === 'shell.output' && (e.payload as any).channel === channel);
      const chunks = await Promise.all(output.map(e => readArtifact(j.directory, (e.payload as any).artifact)));
      expect(Buffer.concat(chunks).toString()).toBe('[REDACTED]');
      expect(output.some(e => (e.payload as any).artifact.redacted)).toBe(true);
    }
    await exportSession(j.directory, { format: 'bundle', output: join(dir, 'bundle') });
    await exportSession(j.directory, { format: 'html', output: join(dir, 'view.html') });
    expect(await readFile(join(dir, 'view.html'), 'utf8')).not.toContain(key);
    for (const file of await readdir(join(dir, 'bundle', 'artifacts')))
      expect((await readFile(join(dir, 'bundle', 'artifacts', file))).includes(Buffer.from(key))).toBe(false);
  } finally { await j.close(); await rm(dir, { recursive: true, force: true }); }
});

it.each(['cancel', 'timeout'])('cleans redirected SIGTERM-resistant descendants before %s finishes', async (mode) => {
  if (process.platform === 'win32') return;
  const dir = await temporary();
  const j = await Journal.open(join(dir, 'session'));
  let pid: number | undefined;
  let active: Promise<unknown> | undefined;
  const abort = new AbortController();
  try {
    await writeFile(join(dir, 'child.cjs'), `const fs=require('fs');process.on('SIGTERM',()=>{});fs.writeFileSync('ready',String(process.pid));setInterval(()=>fs.appendFileSync('effects','x'),20);`);
    const tools = await CoreTools.create(dir, j, {});
    active = tools.definitions().find(d => d.tool.name === 'bash')!.tool.execute('kill', {
      command: `'${process.execPath}' child.cjs > /dev/null 2>&1 & wait`, timeout: 1000,
    }, abort.signal).catch(e => e);
    for (let i = 0; i < 100; i++) {
      try { pid = Number(await readFile(join(dir, 'ready'), 'utf8')); break; } catch {}
      await delay(10);
    }
    expect(pid).toBeDefined();
    if (mode === 'cancel') abort.abort();
    const result = await active;
    if (mode === 'cancel') expect(String(result)).toContain('cancelled');
    else expect(result).not.toBeInstanceOf(Error);
    expect(j.events.find(e => e.type === 'shell.finished')?.payload).toMatchObject({ reason: mode === 'cancel' ? 'cancelled' : 'timeout' });
    const effects = await readFile(join(dir, 'effects')).catch(() => Buffer.alloc(0));
    await delay(100);
    expect(await readFile(join(dir, 'effects')).catch(() => Buffer.alloc(0))).toEqual(effects);
    expect(() => process.kill(pid!, 0)).toThrow();
  } finally {
    abort.abort();
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await active;
    await j.close(); await rm(dir, { recursive: true, force: true });
  }
});

it.each([200, 500])('blocks credentials split across response chunks for HTTP %s', async (status) => {
  const dir = await temporary();
  try {
    const wire = status === 200 ? encode(events([textItem(key)])) : `Error: ${key}`;
    const split = wire.indexOf(key) + 12;
    const chunks = [wire.slice(0, split), wire.slice(split)];
    let fetches = 0;
    const result = await run({ workspace: dir, session: join(dir, 'session'), prompt: 'test', apiKey: key,
      fetch: async () => {
        fetches++;
        return new Response(new ReadableStream({ pull(c) {
          const chunk = chunks.shift();
          if (chunk === undefined) c.close(); else c.enqueue(Buffer.from(chunk));
        } }, { highWaterMark: 0 }), { status, headers: { 'content-type': 'text/event-stream' } });
      },
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Credential detected');
    expect(fetches).toBe(1);
    const records = (await readFile(join(dir, 'session', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const chunksOut = records.filter(e => e.type === 'response.chunk');
    const data = Buffer.concat(await Promise.all(chunksOut.map(e => readArtifact(result.session, e.payload.artifact)))).toString();
    expect(data).not.toContain(key);
    expect(data).toContain('[REDACTED]');
    expect(chunksOut.some(e => e.payload.artifact.redacted)).toBe(true);
    expect(records.some(e => e.type === 'tool.intent')).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


it.each(['eof', 'error'])('preserves the buffered response suffix on %s', async (ending) => {
  const dir = await temporary();
  try {
    const wire = 'data: {"type":"unknown","text":"synthetic-api-';
    let sent = false;
    const result = await run({ workspace: dir, session: join(dir, 'session'), prompt: 'test', apiKey: key,
      fetch: async () => new Response(new ReadableStream({ pull(c) {
        if (!sent) { sent = true; c.enqueue(Buffer.from(wire)); }
        else if (ending === 'eof') c.close();
        else c.error(new Error('connection lost'));
      } }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } }),
    });
    expect(result.status).toBe('failed');
    const records = (await readFile(join(result.session, 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const bytes = await Promise.all(records.filter(e => e.type === 'response.chunk').map(e => readArtifact(result.session, e.payload.artifact)));
    expect(Buffer.concat(bytes).toString()).toBe(wire);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
