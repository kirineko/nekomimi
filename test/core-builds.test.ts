import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CoreCandidates } from '../src/core/candidates.js';
import { CoreBuilds } from '../src/core/builds.js';
import { hostIdentity } from '../src/customization/sdk.js';
import { Journal, readArtifact, readSession } from '../src/journal.js';
import { temporary } from './helpers.js';
afterEach(() => vi.unstubAllEnvs());

async function fixture(buildBody?: string) {
  const source = await temporary(), owner = await temporary(), home = await temporary(), parent = await temporary();
  const effect = join(parent, 'effects'), ready = join(parent, 'ready'), version = (await hostIdentity()).version;
  await mkdir(join(source, 'src'));
  const pkg = { name: 'nekomimi', version, scripts: { postinstall: 'node install.cjs', build: 'node build.cjs' } };
  await writeFile(join(source, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(source, 'package-lock.json'), JSON.stringify({ name: 'nekomimi', version, lockfileVersion: 3, requires: true, packages: { '': { name: 'nekomimi', version, hasInstallScript: true } } }));
  await writeFile(join(source, 'tsconfig.build.json'), '{}'); await writeFile(join(source, 'src/cli.ts'), '// source');
  await writeFile(join(source, '.npmrc'), 'ignore-scripts=true\n');
  await writeFile(join(source, 'install.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(effect)},${JSON.stringify('install\n')});console.log('install recorded');`);
  await writeFile(join(source, 'build.cjs'), `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(effect)},${JSON.stringify('build\n')});` + (buildBody ?? `fs.mkdirSync('dist');fs.writeFileSync('dist/cli.js','console.log("candidate")');fs.writeFileSync('environment.json',JSON.stringify({key:process.env.OPENAI_API_KEY??null,token:process.env.NPM_TOKEN??null,home:process.env.HOME}));console.log('build recorded');`));
  const candidates = new CoreCandidates(owner, home), preview = await candidates.preview(source);
  const candidate = await candidates.prepare({ source, destination: join(parent, 'candidate'), sourceRevision: preview.source.revision, targetHostBuild: preview.targetHost.build });
  const builds = new CoreBuilds(candidates);
  const request = async (commandId = 'build-one') => ({ candidateId: candidate.id, inputHash: (await builds.plan(candidate.id)).inputHash, commandId, authorize: true });
  return { source, owner, home, parent, effect, ready, candidates, candidate, builds, request };
}

it('keeps build planning static and requires an exact authorized input manifest before scripts', async () => {
  const f = await fixture(), request = await f.request();
  const plan = await f.builds.plan(f.candidate.id);
  expect(plan).toMatchObject({ executesScripts: false, stage: 'static', lockHash: expect.stringMatching(/^[a-f0-9]{64}$/), toolchain: { node: { version: process.version }, npm: { revision: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
  await expect(f.builds.build({ ...request, authorize: false })).rejects.toThrow('authorization');
  await writeFile(join(f.candidate.directory, 'src/cli.ts'), '// changed after approval');
  await expect(f.builds.build(request)).rejects.toThrow('input or toolchain changed');
  await expect(readFile(f.effect)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readdir(join(f.home, 'core-builds'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 60000);

it('records actual lifecycle scripts and sealed artifacts without inheriting credentials or replaying a command', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-private-key'); vi.stubEnv('NPM_TOKEN', 'synthetic-private-token');
  const f = await fixture(), request = await f.request(), result = await f.builds.build(request);
  expect(result.status, result.error).toBe('passed'); expect(result.processes).toHaveLength(2);
  expect(result.processes.every(p => p.status === 'passed' && p.cleanup === 'confirmed')).toBe(true);
  expect(JSON.parse(await readFile(join(result.artifact!.directory, 'environment.json'), 'utf8'))).toMatchObject({ key: null, token: null, home: expect.stringContaining('/tasks/') });
  expect((await f.builds.inspect(result.buildId)).validForCurrent).toBe(true);
  const effect = await readFile(f.effect, 'utf8'), journalPath = join(f.home, 'core-builds/journal'), before = await readFile(join(journalPath, 'journal.jsonl'));
  expect(await f.builds.build(request)).toEqual(result); expect(await readFile(f.effect, 'utf8')).toBe(effect); expect(await readFile(join(journalPath, 'journal.jsonl'))).toEqual(before);
  const history = await readSession(journalPath), events = history.events;
  const output = events.filter(e => e.type === 'core.build.output'); expect(output.length).toBeGreaterThan(0);
  expect(output.every(e => e.candidateId === f.candidate.id && e.validationTaskId === result.buildId)).toBe(true);
  const logs = (await Promise.all(output.map(e => readArtifact(history.directory, (e.payload as any).artifact)))).map(b => b.toString()).join('');
  expect(logs).toContain('install recorded'); expect(logs).toContain('build recorded'); expect(logs).not.toContain('synthetic-private');
  const oldPath = process.env.PATH!;
  vi.stubEnv('PATH', oldPath + ':/synthetic-toolchain-change');
  expect((await f.builds.inspect(result.buildId)).validForCurrent).toBe(false);
  vi.stubEnv('PATH', oldPath);
  const originalLock = await readFile(join(f.candidate.directory, 'package-lock.json'));
  await writeFile(join(f.candidate.directory, 'package-lock.json'), originalLock.toString() + '\n');
  expect(await f.builds.inspect(result.buildId)).toMatchObject({ validForCurrent: false, invalidReason: expect.stringContaining('input or toolchain changed') });
  await writeFile(join(f.candidate.directory, 'package-lock.json'), originalLock);
  const artifact = join(result.artifact!.directory, 'dist/cli.js'); await chmod(artifact, 0o600); await writeFile(artifact, 'tampered');
  expect(await f.builds.inspect(result.buildId)).toMatchObject({ validForCurrent: false, invalidReason: expect.stringContaining('artifact changed') });
  expect(await readFile(join(f.source, 'src/cli.ts'), 'utf8')).toBe('// source');
}, 90000);

it('cancels a real script process group and preserves partial output and completed effects', async () => {
  const f = await fixture();
  await writeFile(join(f.candidate.directory, 'build.cjs'), `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(f.effect)},'started');console.log('waiting for cancellation');fs.writeFileSync(${JSON.stringify(f.ready)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},100);`);
  const request = await f.request(), controller = new AbortController(), pending = f.builds.build(request, { signal: controller.signal });
  try {
    await vi.waitFor(async () => expect(await readFile(f.ready, 'utf8')).toMatch(/^\d+$/), { timeout: 60000, interval: 30 });
    controller.abort(new Error('user cancelled'));
    const result = await pending;
    expect(result.status, result.error).toBe('cancelled'); expect(result.artifact).toBeUndefined();
    expect(result.processes.at(-1)).toMatchObject({ status: 'cancelled', cleanup: 'confirmed' });
    const pid = Number(await readFile(f.ready, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
    const journalPath = join(f.home, 'core-builds/journal'), history = await readSession(journalPath), events = history.events;
    expect(events.at(-1)!.payload).toMatchObject({ status: 'cancelled', applied: false });
    const logs = (await Promise.all(events.filter(e => e.type === 'core.build.output').map(e => readArtifact(history.directory, (e.payload as any).artifact)))).map(b => b.toString()).join('');
    expect(logs).toContain('waiting for cancellation'); expect(await readFile(f.effect, 'utf8')).toContain('started');
  } finally { controller.abort(); await pending; }
}, 90000);

it('never reruns an accepted build whose durable terminal is missing', async () => {
  const f = await fixture(), request = await f.request(), journal = await Journal.open(join(f.home, 'core-builds/journal'));
  await journal.append('core.build.intent', { ...request, buildId: 'interrupted' }, { candidateId: f.candidate.id }); await journal.close();
  expect(await f.builds.build(request)).toMatchObject({ status: 'unknown', buildId: 'interrupted' });
  await expect(f.builds.build({ ...request, inputHash: '0'.repeat(64) })).rejects.toThrow('conflict');
  await expect(readFile(f.effect)).rejects.toMatchObject({ code: 'ENOENT' });
}, 60000);

it('records a known nonzero exit as failed without producing an applicable artifact', async () => {
  const f = await fixture("console.error('failed build');process.exit(7)"), result = await f.builds.build(await f.request());
  expect(result.status, result.error).toBe('failed'); expect(result.artifact).toBeUndefined();
  expect(result.processes.at(-1)).toMatchObject({ exitCode: 7, status: 'failed', cleanup: 'confirmed' });
  expect((await f.builds.inspect(result.buildId)).validForCurrent).toBe(false);
}, 90000);

it('rejects a source edit made while the trusted build is running', async () => {
  const f = await fixture();
  await writeFile(join(f.candidate.directory, 'build.cjs'), `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(f.ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(f.ready + '-release')})){clearInterval(timer);fs.mkdirSync('dist');fs.writeFileSync('dist/cli.js','built');}},20);`);
  const controller = new AbortController(), pending = f.builds.build(await f.request(), { signal: controller.signal });
  try {
    await vi.waitFor(async () => expect(await readFile(f.ready, 'utf8')).toBe('ready'), { timeout: 60000, interval: 30 });
    await writeFile(join(f.candidate.directory, 'src/cli.ts'), '// user edited during build');
    await writeFile(f.ready + '-release', 'continue');
    const result = await pending;
    expect(result.status).toBe('failed'); expect(result.error).toContain('changed during build'); expect(result.artifact).toBeUndefined();
  } finally { controller.abort(); await pending; }
}, 90000);

it('refuses runtime artifacts with links outside the isolated build tree', async () => {
  const f = await fixture("fs.mkdirSync('dist');fs.writeFileSync('dist/cli.js','built');fs.symlinkSync('/etc/passwd','dist/outside')");
  const result = await f.builds.build(await f.request());
  expect(result.status).toBe('failed'); expect(result.error).toContain('symlink'); expect(result.artifact).toBeUndefined();
}, 90000);

it('rejects hard-linked output before read-only sealing can change an external file', async () => {
  const f = await fixture();
  await writeFile(join(f.candidate.directory, 'build.cjs'), `const fs=require('node:fs');fs.mkdirSync('dist');fs.writeFileSync('dist/cli.js','built');fs.linkSync(${JSON.stringify(f.effect)},'dist/shared');`);
  const result = await f.builds.build(await f.request());
  expect(result.status).toBe('failed'); expect(result.error).toContain('hard link rejected'); expect(result.artifact).toBeUndefined();
  expect((await stat(f.effect)).mode & 0o200).toBe(0o200);
}, 90000);

it('detaches dependency hard links wholly inside the artifact before sealing', async () => {
  const f = await fixture(`fs.mkdirSync('dist');fs.writeFileSync('dist/cli.js','candidate');fs.linkSync('dist/cli.js','dist/internal-copy.js');`);
  const result = await f.builds.build(await f.request());
  expect(result.status, result.error).toBe('passed');
  const a = await stat(join(result.artifact!.directory, 'dist/cli.js')), b = await stat(join(result.artifact!.directory, 'dist/internal-copy.js'));
  expect(a.nlink).toBe(1); expect(b.nlink).toBe(1); expect(a.ino).not.toBe(b.ino);
  expect((await f.builds.inspect(result.buildId)).validForCurrent).toBe(true);
}, 60000);
