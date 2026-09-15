import { describe, it, expect } from 'vitest';
import { appendFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Journal, readSession, readArtifact } from '../src/journal.js';
import { temporary, delay } from './helpers.js';

describe('Journal durability', () => {
  it('serializes concurrent writes and fsyncs a verifiable watermark', async () => {
    const dir = await temporary(); const j = await Journal.open(dir);
    const ref = await j.artifact('large evidence');
    await Promise.all(Array.from({ length: 25 }, (_, n) => j.append('test', { n, artifact: ref }, { runId: 'r' })));
    expect(j.durableSeq).toBe(25); await j.close();
    const s = await readSession(dir); expect(s.events.map(e => e.seq)).toEqual(Array.from({ length: 25 }, (_, n) => n + 1));
    expect((await readArtifact(s.directory, ref)).toString()).toBe('large evidence');
  });
  it('rejects a second writer while preserving the first lease', async () => {
    const dir = await temporary(); const j = await Journal.open(dir);
    await expect(Journal.open(dir)).rejects.toThrow('busy');
    await j.append('still.active', {}); await j.close();
  });
  it('records a watermarked streaming batch independently of critical records', async () => {
    const dir = await temporary(); const j = await Journal.open(dir, { flushMs: 15 });
    await j.append('chunk', {}, {}, false); expect(j.durableSeq).toBe(0);
    await delay(70); expect(j.durableSeq).toBe(1); await j.close();
  });
  it('fails closed after a storage failure', async () => {
    let fail = false; const j = await Journal.open(await temporary(), { beforeIO: async op => { if (fail && op === 'append') throw new Error('disk full'); } });
    await j.append('ready', {}); fail = true;
    await expect(j.append('tool.intent', {})).rejects.toThrow('disk full');
    expect(j.failure.signal.aborted).toBe(true); await expect(j.append('later', {})).rejects.toThrow('disk full'); await j.close();
  });
  it('preserves torn tail bytes and marks an unresolved tool unknown', async () => {
    const dir = await temporary(); const j = await Journal.open(dir);
    await j.append('tool.intent', { name: 'write' }, { toolCallId: 't' }); await j.close();
    await appendFile(join(dir, 'journal.jsonl'), '{torn');
    const before = await readSession(dir); expect(before.pending[0]?.state).toBe('unknown'); expect(before.tornBytes).toBe(5);
    const reopened = await Journal.open(dir); await reopened.close();
    expect((await readdir(dir)).some(f => f.startsWith('recovery-'))).toBe(true);
    expect((await readSession(dir)).events.at(-1)?.type).toBe('journal.recovered');
  });
  it('detects middle-record corruption and missing artifacts', async () => {
    const dir = await temporary(); const j = await Journal.open(dir); const ref = await j.artifact('before'); await j.append('data', { artifact: ref }); await j.close();
    await writeFile(join(dir, 'artifacts', ref.sha256), 'changed'); await expect(readSession(dir)).rejects.toThrow('integrity');
    await writeFile(join(dir, 'artifacts', ref.sha256), 'before');
    const raw = await readFile(join(dir, 'journal.jsonl'), 'utf8'); await writeFile(join(dir, 'journal.jsonl'), raw.replace('"data"', '"evil"'));
    await expect(readSession(dir)).rejects.toThrow('chain');
  });
  it('recovers after SIGKILL without repeating a committed side effect', async () => {
    if (process.platform === 'win32') return;
    const dir = await temporary(); const target = join(dir, 'effect');
    const code = `import {Journal} from ${JSON.stringify(pathToFileURL(resolve('dist/journal.js')).href)}; import {appendFile} from 'node:fs/promises'; const j=await Journal.open(${JSON.stringify(dir)},{lockStaleMs:2000}); await j.append('tool.intent',{name:'write'},{toolCallId:'killed-tool'}); await appendFile(${JSON.stringify(target)},'once'); process.kill(process.pid,'SIGKILL');`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' });
    await new Promise<void>((res, rej) => { child.on('error', rej); child.on('close', () => res()); });
    const s = await readSession(dir); expect(s.pending).toContainEqual({ type: 'tool.intent', id: 'killed-tool', state: 'unknown' });
    await delay(3300); const j = await Journal.open(dir, { lockStaleMs: 2000 }); await j.close();
    expect(await readFile(target, 'utf8')).toBe('once');
  });
});
