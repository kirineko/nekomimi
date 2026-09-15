import { describe, it, expect } from 'vitest';
import { writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Journal, readArtifact } from '../src/journal.js';
import { CoreTools } from '../src/tools.js';
import { temporary, delay } from './helpers.js';
async function setup() {
  const dir = await temporary(); const j = await Journal.open(join(dir, 'session')); const tools = (await CoreTools.create(dir, j, { runId: 'tools' }, { outputBytes: 100 })).definitions();
  const call = (name: string, args: unknown, signal?: AbortSignal) => tools.find(d => d.tool.name === name)!.tool.execute('call', args, signal);
  return { dir, j, call };
}
describe('core tools', () => {
  it('requires fresh reads and matches edits against the original with BOM and CRLF preserved', async () => {
    const { dir, j, call } = await setup();
    try {
      const file = join(dir, 'a'); await writeFile(file, '\ufeffone\r\ntwo\r\n');
      await expect(call('write', { path: 'a', content: 'oops' })).rejects.toThrow('unread');
      await call('read', { path: 'a' });
      const result = await call('edit', { path: 'a', edits: [{ oldText: 'one', newText: 'two' }, { oldText: 'two', newText: 'three' }] });
      expect(await readFile(file, 'utf8')).toBe('\ufefftwo\r\nthree\r\n'); expect(result.details).toHaveProperty('patch');
      await writeFile(file, 'external'); await expect(call('write', { path: 'a', content: 'oops' })).rejects.toThrow('changed');
      expect(await readFile(file, 'utf8')).toBe('external');
    } finally { await j.close(); }
  });
  it('rejects fuzzy, ambiguous and overlapping edits without partial writes', async () => {
    const { dir, j, call } = await setup();
    try {
      await writeFile(join(dir, 'a'), '“hello” repeat repeat abc'); await call('read', { path: 'a' });
      for (const edits of [[{ oldText: '"hello"', newText: 'x' }], [{ oldText: 'repeat', newText: 'x' }], [{ oldText: 'abc', newText: 'x' }, { oldText: 'bc', newText: 'y' }]]) await expect(call('edit', { path: 'a', edits })).rejects.toThrow();
      expect(await readFile(join(dir, 'a'), 'utf8')).toBe('“hello” repeat repeat abc');
    } finally { await j.close(); }
  });
  it('rejects parent and symlink escape, including missing targets', async () => {
    const { dir, j, call } = await setup(); const outside = await temporary();
    try {
      await writeFile(join(outside, 'secret'), 'private'); await symlink(outside, join(dir, 'escape'), 'dir');
      await expect(call('read', { path: '../secret' })).rejects.toThrow('outside');
      await expect(call('read', { path: 'escape/secret' })).rejects.toThrow('symlink');
      await expect(call('write', { path: 'escape/new', content: 'x' })).rejects.toThrow('symlink');
    } finally { await j.close(); }
  });
  it('keeps full evidence and lets a long UTF8 line be read by byte offset', async () => {
    const { dir, j, call } = await setup();
    try {
      await writeFile(join(dir, 'long'), '汉'.repeat(200)); const r = await call('read', { path: 'long', limit: 100 });
      const details = r.details as { artifact: any; nextOffset: number }; expect(details.nextOffset).toBe(99);
      expect((await readArtifact(j.directory, details.artifact)).length).toBe(600);
      const next = await call('read', { path: 'long', offset: 99, limit: 99 }); expect(next.content[0]).toMatchObject({ type: 'text' });
    } finally { await j.close(); }
  });
  it('separates shell channels, saves full output, and reports exit code', async () => {
    const { j, call } = await setup();
    try {
      const r = await call(process.platform === 'win32' ? 'powershell' : 'bash', { command: `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(200));process.stderr.write('err');process.exitCode=7"` });
      expect(r.details).toMatchObject({ code: 7, bytes: 203 });
      expect(new Set(j.events.filter(e => e.type === 'shell.output').map(e => (e.payload as any).channel))).toEqual(new Set(['stdout', 'stderr']));
    } finally { await j.close(); }
  });
  it('waits for actual process termination when cancelled', async () => {
    const { j, call } = await setup(); const ac = new AbortController();
    try {
      const active = call(process.platform === 'win32' ? 'powershell' : 'bash', { command: `${JSON.stringify(process.execPath)} -e "setInterval(()=>process.stdout.write('x'),10)"` }, ac.signal);
      const rejection = expect(active).rejects.toThrow('cancelled'); await delay(200); ac.abort(); await rejection;
      expect(j.events.some(e => e.type === 'shell.finished')).toBe(true);
    } finally { await j.close(); }
  });
});
