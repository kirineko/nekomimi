import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Journal, readSession } from '../src/journal.js';
import { validateCoreIsolation } from '../src/core/validation.js';
import { CoreValidations } from '../src/core/validations.js';
import type { CoreBuilds } from '../src/core/builds.js';
import { temporary } from './helpers.js';
afterEach(() => vi.unstubAllEnvs());
async function identify(directory: string) {
  const root = join(directory, 'dist'), digest = createHash('sha256');
  const walk = async (path: string): Promise<void> => { for (const e of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) { const p = join(path,e.name); if(e.isDirectory()) await walk(p); else if(e.name !== 'build-identity.json') digest.update(relative(root,p)).update('\0').update(await readFile(p)).update('\0'); } };
  await walk(root); await writeFile(join(root, 'build-identity.json'), JSON.stringify({ version: 1, sha256: digest.digest('hex') }));
}
async function copied() {
  const directory = await temporary();
  await cp(resolve('dist'), join(directory, 'dist'), { recursive: true });
  await cp(resolve('package.json'), join(directory, 'package.json'));
  await symlink(resolve('node_modules'), join(directory, 'node_modules'));
  return directory;
}
async function probe(directory: string, signal = AbortSignal.timeout(30000)) {
  const root = await temporary(), journal = await Journal.open(join(root, 'journal'));
  try { const result = await validateCoreIsolation({ directory, task: join(root, 'task'), journal, signal }); return { result, root, events: (await readSession(journal.directory)).events }; }
  finally { await journal.close(); }
}
it('boots the actual compiled candidate with isolated credentials and verifies cross-host storage, restart, legacy refusal and cleanup', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-do-not-inherit'); vi.stubEnv('NPM_TOKEN', 'synthetic-token');
  const { result, events } = await probe(resolve('.'));
  expect(result.status, JSON.stringify(result)).toBe('passed');
  expect(result).toMatchObject({ stage: 'isolated-startup', hostIntegration: 'not_run', applied: false, process: { cleanup: 'confirmed', status: 'passed' } });
  expect(result.checks).toEqual(['legacy-byte-identical', 'ports-closed', 'host-storage-readback', 'no-business-execution', 'durable-host-readback']);
  expect(result.ports).toHaveLength(2); expect(result.ports.every(port => port.closed)).toBe(true);
  expect(result.report?.checks).toContain('storage-restart'); expect(result.report?.externalAttempts).toBe(0);
  expect(JSON.stringify(events)).not.toContain('synthetic-do-not-inherit');
  const env = events.find(e => e.type === 'core.validation.environment')!.payload as any;
  expect(env.environment).not.toHaveProperty('OPENAI_API_KEY'); expect(env.environment).not.toHaveProperty('NPM_TOKEN'); expect(env.environment).not.toHaveProperty('NODE_OPTIONS');
}, 60000);
it('rejects forged build identity before launching code', async () => {
  const directory = await copied(); await writeFile(join(directory, 'dist/build-identity.json'), JSON.stringify({version:1,sha256:'0'.repeat(64)}));
  const { result, events } = await probe(directory);
  expect(result).toMatchObject({ status:'failed', error:expect.stringContaining('identity') });
  expect(events.some(e => e.type === 'core.validation.process.started')).toBe(false);
}, 30000);
it('rejects incompatible protocol before starting a service', async () => {
  const directory = await copied(); await writeFile(join(directory, 'dist/shared/protocol.js'), 'export const API_VERSION = 999;'); await identify(directory);
  const { result } = await probe(directory);
  expect(result).toMatchObject({status:'failed', process:{cleanup:'confirmed'}, report:{status:'failed', ports:[],error:expect.stringContaining('contracts')}});
}, 30000);
it('cancels a stuck candidate service and confirms the owned process group is gone', async () => {
  const directory = await copied();
  await writeFile(join(directory, 'dist/server/app.js'), "import {createServer} from 'node:http';export async function startWeb(){await new Promise(resolve=>createServer(()=>{}).listen(0,'127.0.0.1',resolve));await new Promise(()=>{});}");
  await identify(directory);
  const { result, events } = await probe(directory, AbortSignal.timeout(3500));
  expect(events.some(e => e.type === 'core.validation.process.started')).toBe(true);
  expect(result).toMatchObject({status:'cancelled',process:{status:'cancelled',cleanup:'confirmed'}});
  expect(() => process.kill(-result.process!.pid!,0)).toThrow();
}, 15000);
it('does not claim success when the candidate requests external fetch during startup', async () => {
  const directory = await copied();
  await writeFile(join(directory, 'dist/server/app.js'), "export async function startWeb(){await fetch('https://invalid.example');}"); await identify(directory);
  const { result } = await probe(directory);
  expect(result).toMatchObject({status:'failed',report:{externalAttempts:1,error:expect.stringContaining('External requests disabled')}});
}, 30000);
it('requires explicit artifact confirmation, preserves unknown intents and refuses conflicting retries', async () => {
  const home = await temporary(), candidateId = 'candidate-one', buildId = 'build-one', artifactRevision = 'a'.repeat(64);
  const inspect = vi.fn(async () => ({validForCurrent:false}));
  const builds = { candidates:{ home, list:async () => [{id:candidateId}] }, inspect } as unknown as CoreBuilds;
  const validations = new CoreValidations(builds), input = {buildId,artifactRevision,commandId:'validate-one',authorize:true};
  await expect(validations.validate({...input,authorize:false})).rejects.toThrow('authorization');
  await expect(validations.validate(input)).rejects.toThrow('changed');
  expect(await readdir(home)).toEqual([]);
  const journal = await Journal.open(join(home,'core-validations/journal'));
  try { await journal.append('core.validation.intent',{version:1,...input,candidateId,validationId:'validation-one',checks:[],ports:[],stage:'isolated-startup',hostIntegration:'not_run',applied:false},{candidateId}); } finally { await journal.close(); }
  const before = await readFile(join(home,'core-validations/journal/journal.jsonl'));
  expect(await validations.validate(input)).toMatchObject({status:'unknown',applied:false});
  expect(await readFile(join(home,'core-validations/journal/journal.jsonl'))).toEqual(before);
  await expect(validations.validate({...input,artifactRevision:'b'.repeat(64)})).rejects.toThrow('conflict');
});
it('detects legacy mutations even when the candidate reports the expected incompatibility error', async () => {
  const directory = await copied();
  await cp(join(directory, 'dist/server/app.js'), join(directory, 'dist/server/app-original.js'));
  await writeFile(join(directory, 'dist/server/app.js'), `import {writeFile} from 'node:fs/promises';import {join} from 'node:path';import {startWeb as original} from './app-original.js';export async function startWeb(options){if(options.home.endsWith('/legacy')){await writeFile(join(options.home,'sentinel'),'unexpected migration');throw Object.assign(Error('incompatible'),{code:'incompatible_format'});}return original(options);}`);
  await identify(directory);
  const { result } = await probe(directory);
  expect(result).toMatchObject({status:'failed',error:expect.stringContaining('modified legacy data'),report:{status:'passed'}});
  expect(result.ports.every(port => port.closed)).toBe(true);
}, 30000);
