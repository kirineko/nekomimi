import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { temporary } from '../helpers.js';
import { hostIdentity } from '../../src/customization/sdk.js';
import { CoreCandidates } from '../../src/core/candidates.js';
import { Journal } from '../../src/journal.js';

export async function coreViewFixture() {
  const workspace = await temporary(), home = await temporary(), source = await temporary(), parent = await temporary();
  const version = (await hostIdentity()).version;
  await mkdir(join(source, 'src'));
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'nekomimi', version, scripts: { build: 'node forbidden-build.cjs' } }));
  await writeFile(join(source, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'nekomimi', version } } }));
  await writeFile(join(source, 'src/cli.ts'), 'export const baseline = "saved baseline";');
  await writeFile(join(source, 'tsconfig.build.json'), '{}');
  const candidates = new CoreCandidates(workspace, home), preview = await candidates.preview(source);
  const candidate = await candidates.prepare({ source, destination: join(parent, 'candidate'), sourceRevision: preview.source.revision, targetHostBuild: preview.targetHost.build });
  return { workspace, home, source, candidate, candidates };
}
/** Persisted history fixture only: this helper never runs a build or claims artifact admission. */
export async function coreViewHistory(f: Awaited<ReturnType<typeof coreViewFixture>>) {
  const journal = await Journal.open(join(f.home, 'core-builds', 'journal'));
  try {
    const links = { candidateId: f.candidate.id, validationTaskId: 'fixture-build' };
    await journal.append('core.build.intent', { commandId: 'fixture-command', buildId: 'fixture-build', candidateId: f.candidate.id, inputHash: 'a'.repeat(64), plan: { sourceRevision: f.candidate.source.revision } }, links);
    await journal.append('core.build.output', { channel: 'stderr', artifact: await journal.artifact('fixture compiler diagnostic: build deliberately failed') }, links);
    await journal.append('core.build.finished', { version: 1, commandId: 'fixture-command', buildId: 'fixture-build', candidateId: f.candidate.id, status: 'failed', processes: [], hostIntegration: 'not_run', applied: false, error: 'fixture failure' }, links);
    await journal.append('core.build.intent', { commandId: 'unfinished-command', buildId: 'unfinished-build', candidateId: f.candidate.id, plan: { sourceRevision: f.candidate.source.revision } }, { candidateId: f.candidate.id, validationTaskId: 'unfinished-build' });
  } finally { await journal.close(); }
}
