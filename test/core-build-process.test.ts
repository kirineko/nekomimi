import { expect, it } from 'vitest';
import { Journal, readArtifact, readSession } from '../src/journal.js';
import { runCoreBuildProcess } from '../src/core/build-process.js';
import { temporary } from './helpers.js';

it('redacts credentials spanning real stdout chunks before persisting build logs', async () => {
  const cwd = await temporary(), journal = await Journal.open(await temporary());
  try {
    const result = await runCoreBuildProcess({ executable: process.execPath, args: ['-e', "process.stdout.write('synthetic-');setTimeout(()=>process.stdout.write('secret-done'),50)"], cwd, env: {}, signal: new AbortController().signal, journal, step: 0, logBytes: 4096, secrets: ['synthetic-secret'] });
    expect(result.status).toBe('passed');
    const history = await readSession(journal.directory);
    const text = (await Promise.all(history.events.filter(e => e.type === 'core.build.output').map(e => readArtifact(history.directory, (e.payload as any).artifact)))).map(b => b.toString()).join('');
    expect(text).toBe('[REDACTED]-done');
  } finally { await journal.close(); }
});

it('stops an unbounded log producer and records the evidence limit with bounded output', async () => {
  const cwd = await temporary(), journal = await Journal.open(await temporary());
  try {
    const result = await runCoreBuildProcess({ executable: process.execPath, args: ['-e', "setInterval(()=>process.stdout.write('x'.repeat(8192)),1)"], cwd, env: {}, signal: new AbortController().signal, journal, step: 0, logBytes: 1024 });
    expect(result).toMatchObject({ status: 'failed', bytes: 1024, cleanup: 'confirmed', cleanupScope: 'process-group' });
    expect(journal.events.some(e => e.type === 'core.build.output.limit')).toBe(true);
  } finally { await journal.close(); }
}, 10000);
