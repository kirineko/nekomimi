import { it, expect } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Journal, readSession, readArtifact } from '../src/journal.js';
import { CoreTools } from '../src/tools.js';
import { run } from '../src/runtime.js';
import { SessionProjection } from '../src/projection/session.js';
import { exportSession, importBundle } from '../src/export.js';
import { temporary, key, response, callItem, textItem } from './helpers.js';

it('omits retired fetch definitions and guidance with search enabled or disabled', async () => {
  const workspace = await temporary(), j = await Journal.open(join(workspace, 's'));
  try {
    for (const enabled of [true, false]) {
      const definitions = (await CoreTools.create(workspace, j, {}, { search: { apiKey: key, settings: { enabled, model: 'deepseek-flash', baseUrl: 'https://example.com' } } })).definitions();
      expect(definitions.some(d => d.tool.name === 'web_search')).toBe(enabled);
      expect(JSON.stringify(definitions)).not.toContain('web_fetch');
    }
  } finally { await j.close(); }
});

it('returns an unknown-tool result for an obsolete model call without fetching the target', async () => {
  const workspace = await temporary(), bodies: any[] = [], urls: string[] = [];
  const result = await run({ workspace, session: join(workspace, 's'), prompt: 'read a URL', apiKey: key,
    fetch: async (url, init) => {
      urls.push(String(url)); bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? response([callItem('web_fetch', { url: 'https://retired-target.invalid/page' })]) : response([textItem('Tool unavailable')]);
    },
  });
  expect(result.status).toBe('completed');
  expect(bodies).toHaveLength(2);
  expect(urls.every(url => !url.includes('retired-target.invalid'))).toBe(true);
  expect(bodies[0].tools.some((t: any) => t.name === 'web_fetch')).toBe(false);
  expect(bodies[0].instructions).not.toContain('web_fetch');
  const output = bodies[1].input.find((i: any) => i.type === 'function_call_output');
  expect(JSON.stringify(output)).toMatch(/not found|unknown|not available/i);
  expect((await readSession(result.session)).events.some(e => e.type.startsWith('fetch.'))).toBe(false);
});

it('keeps old fetch statuses and artifacts readable through replay and export/import', async () => {
  const workspace = await temporary(), directory = join(workspace, 's'), j = await Journal.open(directory);
  const statuses = ['complete', 'failed', 'cancelled', 'partial'];
  try {
    for (const status of statuses) {
      const links = { runId: 'old-run', toolCallId: status };
      const artifact = await j.artifact(`Saved historical ${status} content`);
      await j.append('tool.requested', { name: 'web_fetch', args: { url: 'https://example.com/old' } }, links);
      await j.append('fetch.finished', { url: 'https://example.com/old', finalUrl: 'https://example.com/old', status, artifact, bodyTruncated: status === 'partial', outputTruncated: false }, links);
      await j.append(status === 'failed' || status === 'cancelled' ? 'tool.failed' : 'tool.result', { details: {}, item: { output: `Saved historical ${status} content` } }, links);
    }
  } finally { await j.close(); }
  const before = await readFile(join(directory, 'journal.jsonl'));
  const bundle = join(workspace, 'bundle'), imported = join(workspace, 'imported');
  await exportSession(directory, { format: 'bundle', output: bundle });
  await importBundle(bundle, imported);
  for (const path of [directory, imported]) {
    const snapshot = await readSession(path), projection = new SessionProjection(snapshot.directory);
    await projection.update(snapshot.events);
    const rows = projection.page().rows.filter(r => r.title === 'web_fetch');
    expect(rows.map(r => r.status)).toEqual(['completed', 'failed', 'cancelled', 'completed']);
    for (const row of rows) {
      const details = row.details as any;
      expect(details.finalUrl).toBe('https://example.com/old');
      expect((await readArtifact(snapshot.directory, details.artifact)).toString()).toContain('Saved historical');
    }
    expect((rows[3]!.details as any).bodyTruncated).toBe(true);
    const html = join(workspace, path === directory ? 'original.html' : 'imported.html');
    await exportSession(path, { format: 'html', output: html });
    expect(await readFile(html, 'utf8')).toContain('Saved historical');
  }
  expect(await readFile(join(directory, 'journal.jsonl'))).toEqual(before);
});
