import { expect, it } from 'vitest';
import { chmod, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CoreCandidates, scanCoreSource } from '../src/core/candidates.js';
import { hostIdentity } from '../src/customization/sdk.js';
import { hash, readSession } from '../src/journal.js';
import { createSessionBinding, checkSessionTarget } from '../src/session/identity.js';
import { temporary } from './helpers.js';

async function fixture() {
  const source = await temporary(), parent = await temporary(), owner = await temporary(), home = await temporary();
  const version = (await hostIdentity()).version;
  await mkdir(join(source, 'src'));
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'nekomimi', version, scripts: { build: 'node build.cjs' } }));
  await writeFile(join(source, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'nekomimi', version } } }));
  await writeFile(join(source, 'src/cli.ts'), '// initial source\n');
  await writeFile(join(source, 'tsconfig.build.json'), '{}');
  await writeFile(join(source, 'build.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(join(source, 'SCRIPT-RAN'))}, 'unexpected')`);
  const store = new CoreCandidates(owner, home), destination = join(parent, 'candidate');
  const prepare = async () => {
    const preview = await store.preview(source);
    return store.prepare({ source, destination, sourceRevision: preview.source.revision, targetHostBuild: preview.targetHost.build });
  };
  return { source, parent, owner, home, store, destination, prepare };
}

it('copies actual dirty source without touching its git state, running scripts or adopting dependencies and credentials', async () => {
  const f = await fixture();
  execFileSync('git', ['init', '--quiet'], { cwd: f.source });
  execFileSync('git', ['add', '.'], { cwd: f.source });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline'], { cwd: f.source });
  await writeFile(join(f.source, 'src/cli.ts'), '// uncommitted user change\n');
  await writeFile(join(f.source, 'untracked.ts'), 'export const untracked = true;');
  await writeFile(join(f.source, '__proto__'), 'ordinary source filename');
  await mkdir(join(f.source, 'empty-assets'));
  await writeFile(join(f.source, 'run.sh'), '#!/bin/sh\nexit 0\n'); await chmod(join(f.source, 'run.sh'), 0o755);
  for (const dir of ['node_modules', 'dist', '.nekomimi', 'reference', '.harness', 'test-results']) { await mkdir(join(f.source, dir)); await writeFile(join(f.source, dir, 'private'), 'excluded'); }
  await symlink(join(f.source, 'src/cli.ts'), join(f.source, 'reference/research-link'));
  await writeFile(join(f.source, '.env.fixture'), 'SYNTHETIC_SECRET=not-a-real-key');
  const status = () => execFileSync('git', ['status', '--porcelain=v1'], { cwd: f.source, encoding: 'utf8' });
  const beforeStatus = status(), before = await scanCoreSource(f.source), index = await readFile(join(f.source, '.git/index'));
  expect(beforeStatus).toContain(' M src/cli.ts');
  const candidate = await f.prepare();
  expect(Object.hasOwn(candidate.sourceArtifacts!, '__proto__')).toBe(true);
  expect(candidate.sourceArtifacts!['__proto__']?.sha256).toBe(hash('ordinary source filename'));
  expect(status()).toBe(beforeStatus); expect(await readFile(join(f.source, '.git/index'))).toEqual(index);
  expect((await scanCoreSource(f.source)).revision).toBe(before.revision);
  expect((await scanCoreSource(candidate.directory)).revision).toBe(before.revision);
  expect(await readdir(join(candidate.directory, 'empty-assets'))).toEqual([]);
  expect(candidate.source.excluded).toEqual(expect.arrayContaining(['.git', '.env.fixture', 'node_modules', 'dist', '.nekomimi', 'reference', '.harness', 'test-results']));
  for (const file of ['SCRIPT-RAN', '.env.fixture', '.git', 'node_modules', 'dist']) await expect(readFile(join(candidate.directory, file))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(f.source, 'SCRIPT-RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
  const facts = (await readSession(join(f.home, 'core-candidates/journal'))).events;
  expect(facts.map(e => e.type)).toEqual(['core.candidate.prepare.intent', 'core.candidate.prepared']);
  expect(facts.every(e => e.candidateId === candidate.id)).toBe(true);
  expect(await new CoreCandidates(f.owner, f.home).inspect(candidate.id)).toMatchObject({ changed: false, hostMatches: true, built: false, applied: false });
  const binding = await createSessionBinding(f.owner, 'core-session', { commandId: 'core-session', mode: 'create', target: { kind: 'core', root: candidate.directory } }, hash('core'), f.home);
  expect(binding.target.coreCandidate).toEqual({ id: candidate.id, sourceRevision: candidate.source.revision });
  await expect(checkSessionTarget({ ...binding, target: { ...binding.target, coreCandidate: { id: candidate.id, sourceRevision: '0'.repeat(64) } } }, f.home)).rejects.toThrow('基线或目标宿主');
  await expect(checkSessionTarget(binding, f.home)).resolves.toBeUndefined();
  await writeFile(join(candidate.directory, 'src/cli.ts'), '// candidate-only update');
  expect((await f.store.inspect(candidate.id)).changed).toBe(true);
  expect(await readFile(join(f.source, 'src/cli.ts'), 'utf8')).toContain('uncommitted user change');
});

it('rejects changed source or host confirmation before creating the candidate or data registry', async () => {
  const f = await fixture(), preview = await f.store.preview(f.source);
  const request = { source: f.source, destination: f.destination, sourceRevision: preview.source.revision, targetHostBuild: preview.targetHost.build };
  await expect(f.store.prepare({ ...request, targetHostBuild: '0'.repeat(64) })).rejects.toThrow('host changed');
  await writeFile(join(f.source, 'untracked.ts'), 'changed');
  await expect(f.store.prepare(request)).rejects.toThrow('revision changed');
  expect(await readdir(f.parent)).toEqual([]); expect(await readdir(f.home)).toEqual([]);
});

it('refuses missing and mismatched source without downloading, executing or modifying it', async () => {
  const f = await fixture();
  await expect(f.store.preview('')).rejects.toThrow('explicit');
  await expect(f.store.preview(f.owner)).rejects.toThrow('核心源码缺少');
  for (const name of ['package.json', 'package-lock.json']) {
    const value = JSON.parse(await readFile(join(f.source, name), 'utf8'));
    if (name === 'package.json') value.version = '999.0.0'; else value.packages[''].version = '999.0.0';
    await writeFile(join(f.source, name), JSON.stringify(value));
  }
  const before = await scanCoreSource(f.source);
  await expect(f.prepare()).rejects.toThrow('不匹配');
  expect((await scanCoreSource(f.source)).revision).toBe(before.revision);
  expect(await readdir(f.parent)).toEqual([]); expect(await readdir(f.home)).toEqual([]);
});

it('does not replace existing destinations, follow source symlinks or write a registry within source', async () => {
  const f = await fixture();
  await mkdir(f.destination); await writeFile(join(f.destination, 'user-file'), 'keep');
  await expect(f.prepare()).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(join(f.destination, 'user-file'), 'utf8')).toBe('keep'); expect(await f.store.list()).toEqual([]);
  await symlink(join(f.destination, 'user-file'), join(f.source, 'escape'));
  await expect(f.store.preview(f.source)).rejects.toThrow('symlink');
  const clean = await fixture(), preview = await clean.store.preview(clean.source);
  await expect(new CoreCandidates(clean.owner, join(clean.source, 'registry')).prepare({ source: clean.source, destination: clean.destination, sourceRevision: preview.source.revision, targetHostBuild: preview.targetHost.build })).rejects.toThrow('outside source');
  await expect(readFile(join(clean.source, 'registry/nekomimi-format.json'))).rejects.toThrow();
});

it('keeps observations read-only and refuses a replaced candidate directory', async () => {
  const f = await fixture(); expect(await f.store.list()).toEqual([]); expect(await readdir(f.home)).toEqual([]);
  const candidate = await f.prepare(), journal = join(f.home, 'core-candidates/journal/journal.jsonl'), before = await readFile(journal);
  await f.store.list(); await f.store.inspect(candidate.id); expect(await readFile(journal)).toEqual(before);
  await rename(candidate.directory, candidate.directory + '-original'); await mkdir(candidate.directory);
  await expect(f.store.inspect(candidate.id)).rejects.toThrow('identity changed'); expect(await readFile(journal)).toEqual(before);
  expect(await new CoreCandidates(f.source, f.home).list()).toEqual([]);
});
