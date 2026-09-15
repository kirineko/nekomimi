import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigStore } from '../dist/config/store.js';
import { Journal, readArtifact } from '../dist/journal.js';
import { webSearch } from '../dist/web-search.js';
const settings = await new ConfigStore().snapshot();
if (!settings.apiKey) throw new Error('DeepSeek credential is not configured');
const journal = await Journal.open(await mkdtemp(join(tmpdir(), 'nekomimi-search-live-')), { secrets: [settings.apiKey] });
try {
  const result = await webSearch(journal, { runId: 'search-smoke', toolCallId: 'search-smoke-tool' }, 'Node.js official documentation filesystem readFile', { apiKey: settings.apiKey, settings: settings.search });
  const request = journal.events.find(e => e.type === 'request.dispatched');
  const finished = journal.events.find(e => e.type === 'attempt.finished');
  const report = { checkedAt: new Date().toISOString(), platform: process.platform, model: settings.search.model, endpoint: settings.search.baseUrl, request: JSON.parse((await readArtifact(journal.directory, request.payload.body)).toString()), bodyHash: request.payload.bodyHash, attempt: finished.payload, response: JSON.parse((await readArtifact(journal.directory, finished.payload.response)).toString()), result: result.details };
  const output = resolve('docs/validation/workbench-upgrade'); await mkdir(output, { recursive: true });
  await writeFile(join(output, 'search-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: result.details.status, sources: result.details.sources.length, usage: result.details.usage }));
} finally { await journal.close(); }
