import { constants } from 'node:fs';
import { mkdir, open, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Journal, hash, id, readSession, readArtifact, type Artifact } from '../journal.js';
import { validId } from '../shared/protocol.js';
import { CoreCandidates, scanCoreSource } from './candidates.js';
import { coreBuildPlan } from './build-plan.js';
import { coreTreeManifest, type CoreArtifactFile } from './manifest.js';
import { runCoreBuildProcess, type CoreProcessResult } from './build-process.js';

/** npm/esbuild uses internal hard links. Detach only groups wholly owned by this artifact. */
async function detachInternalHardLinks(directory: string, files: CoreArtifactFile[]) {
  const groups = new Map<string, { links: number; paths: string[] }>();
  for (const file of files) {
    if (file.kind !== 'file') continue;
    const path = join(directory, file.path), handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw Error('Core artifact file type changed');
      if (info.nlink > 1) {
        const key = `${info.dev}:${info.ino}`, group = groups.get(key) ?? { links: info.nlink, paths: [] };
        if (group.links !== info.nlink) throw Error('Core artifact hard link changed');
        group.paths.push(path); groups.set(key, group);
      }
    } finally { await handle.close(); }
  }
  if ([...groups.values()].some(group => group.paths.length !== group.links)) throw Error('Core artifact external hard link rejected');
  for (const [key, group] of groups) for (const path of group.paths) {
    const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await source.stat();
      if (`${info.dev}:${info.ino}` !== key || !info.isFile()) throw Error('Core artifact hard link changed');
      if (info.nlink === 1) continue;
      const temporary = path + '.detach-' + id(), target = await open(temporary, 'wx', info.mode & 0o777);
      try { await target.writeFile(await source.readFile()); await target.sync(); } finally { await target.close(); }
      await rename(temporary, path); await syncDirectory(dirname(path));
    } finally { await source.close(); }
  }
}

async function durableReadOnly(path: string, mode: number, directory = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (directory ? constants.O_DIRECTORY : 0));
  try {
    const info = await handle.stat();
    if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) throw Error('Core artifact type or hard link rejected');
    await handle.chmod(mode); await handle.sync();
  } finally { await handle.close(); }
}
async function syncDirectory(path: string) { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }

export interface CoreBuildResult {
  version: 1;
  commandId: string;
  buildId: string;
  candidateId: string;
  inputHash: string;
  status: 'passed' | 'failed' | 'cancelled' | 'unknown';
  error?: string;
  processes: CoreProcessResult[];
  artifact?: { directory: string; revision: string; manifest: Artifact };
  hostIntegration: 'not_run';
  applied: false;
}
export class CoreBuilds {
  private get root() { return join(this.candidates.home, 'core-builds'); }
  private get journalPath() { return join(this.root, 'journal'); }
  constructor(readonly candidates: CoreCandidates) {}
  plan(candidateId: string) { return coreBuildPlan(this.candidates, candidateId); }
  async records() {
    try { await stat(join(this.journalPath, 'journal.jsonl')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const allowed = new Set((await this.candidates.list()).map(candidate => candidate.id));
    return (await readSession(this.journalPath)).events.filter(event => event.candidateId && allowed.has(event.candidateId));
  }
  async inspect(buildId: string) {
    const record = (await this.records()).find(event => event.type === 'core.build.finished' && (event.payload as CoreBuildResult).buildId === buildId);
    if (!record) throw Error('Core build has no durable terminal; inspect its journal before starting another build');
    const result = record.payload as CoreBuildResult;
    let validForCurrent = false, invalidReason: string | undefined;
    try {
      if (result.status !== 'passed' || !result.artifact) throw Error('Core build did not pass');
      const recorded = JSON.parse((await readArtifact((await readSession(this.journalPath)).directory, result.artifact.manifest)).toString());
      if (recorded.buildId !== buildId || recorded.plan.inputHash !== result.inputHash || recorded.artifact.revision !== result.artifact.revision) throw Error('Core build manifest mismatch');
      if ((await this.plan(result.candidateId)).inputHash !== result.inputHash) throw Error('Core build input or toolchain changed');
      const manifest = await coreTreeManifest(result.artifact.directory);
      if (manifest.revision !== result.artifact.revision) throw Error('Core build artifact changed');
      validForCurrent = true;
    } catch (error) { invalidReason = String(error); }
    return { result, validForCurrent, invalidReason, hostIntegration: 'not_run', applied: false };
  }
  async build(input: { candidateId: string; inputHash: string; commandId: string; authorize: boolean }, options: { signal?: AbortSignal } = {}): Promise<CoreBuildResult> {
    if (!input || input.authorize !== true) throw Error('Explicit trusted build authorization is required, including dependency and package lifecycle scripts');
    if (!validId(input.commandId) || !/^[a-f0-9]{64}$/.test(input.inputHash)) throw Error('Core build requires commandId and confirmed inputHash');
    const previous = (await this.records()).find(event => event.type === 'core.build.intent' && (event.payload as any).commandId === input.commandId);
    if (previous) {
      const prior = previous.payload as { commandId: string; candidateId: string; buildId: string; inputHash: string };
      if (prior.inputHash !== input.inputHash || prior.candidateId !== input.candidateId) throw Error('Core build command conflict');
      const terminal = (await this.records()).find(event => event.type === 'core.build.finished' && (event.payload as CoreBuildResult).buildId === prior.buildId);
      return terminal ? terminal.payload as CoreBuildResult : { version: 1, ...prior, status: 'unknown', processes: [], error: 'Accepted build has no durable terminal; it will not run again automatically', hostIntegration: 'not_run', applied: false };
    }
    const plan = await this.plan(input.candidateId);
    if (plan.inputHash !== input.inputHash) throw Error('Core build input or toolchain changed; review a fresh plan');
    options.signal?.throwIfAborted();
    const secrets = Object.entries(process.env).filter(([key]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key)).map(([, value]) => value).filter((value): value is string => !!value);
    const journal = await Journal.open(this.journalPath, { secrets });
    if (journal.events.some(event => event.type === 'core.build.intent' && (event.payload as any).commandId === input.commandId)) {
      await journal.close();
      const accepted = (await this.records()).find(event => event.type === 'core.build.intent' && (event.payload as any).commandId === input.commandId);
      if (!accepted) throw Error('Core build command belongs to another project');
      return this.build(input, options);
    }
    const buildId = id(), task = join(this.root, 'tasks', buildId), directory = join(task, 'source');
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(plan.policy.timeoutMs)]) : AbortSignal.timeout(plan.policy.timeoutMs);
    const result: CoreBuildResult = { version: 1, commandId: input.commandId, buildId, candidateId: input.candidateId, inputHash: input.inputHash, status: 'failed', processes: [], hostIntegration: 'not_run', applied: false };
    try {
      await journal.append('core.build.intent', { ...input, buildId, plan, boundary: 'Trusted OS process; not an OS sandbox' }, { candidateId: input.candidateId, validationTaskId: buildId });
      const inspected = await this.candidates.inspect(input.candidateId), snapshot = await scanCoreSource(inspected.candidate.directory);
      if (snapshot.revision !== plan.sourceRevision) throw Error('Core source changed before build preparation');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const name of snapshot.directories) await mkdir(join(directory, name), { recursive: true, mode: 0o700 });
      for (const file of snapshot.files) {
        const path = join(directory, file.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, snapshot.contents.get(file.path)!, { flag: 'wx', mode: file.executable ? 0o700 : 0o600 });
      }
      if ((await scanCoreSource(directory)).revision !== plan.sourceRevision || (await this.plan(input.candidateId)).inputHash !== input.inputHash) throw Error('Core build input changed before dispatch');
      const isolatedHome = join(task, 'home'), temporary = join(task, 'tmp'), cache = join(task, 'npm-cache'), npmrc = join(task, 'empty-npmrc'), globalNpmrc = join(task, 'empty-global-npmrc');
      for (const path of [isolatedHome, temporary, cache]) await mkdir(path, { mode: 0o700 });
      await writeFile(npmrc, '', { mode: 0o600, flag: 'wx' });
      await writeFile(globalNpmrc, '', { mode: 0o600, flag: 'wx' });
      const env: NodeJS.ProcessEnv = { PATH: plan.toolchain.path, HOME: isolatedHome, USERPROFILE: isolatedHome, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
        LANG: 'C.UTF-8', TZ: 'UTC', CI: '1', npm_config_userconfig: npmrc, npm_config_globalconfig: globalNpmrc, npm_config_cache: cache };
      await journal.append('core.build.environment', { directory, environment: env, inheritedCredentials: false }, { candidateId: input.candidateId, validationTaskId: buildId });
      for (let step = 0; step < plan.commands.length; step++) {
        signal.throwIfAborted();
        const command = plan.commands[step]!;
        const outcome = await journal.withLinks({ candidateId: input.candidateId, validationTaskId: buildId }, () => runCoreBuildProcess({ ...command, cwd: directory, env, signal, journal, step, logBytes: plan.policy.logBytes, secrets }));
        result.processes.push(outcome);
        await journal.append('core.build.process.finished', { step, ...outcome }, { candidateId: input.candidateId, validationTaskId: buildId });
        if (outcome.status !== 'passed') { result.status = outcome.status; throw Error(outcome.error ?? `Core build process ${step} ended ${outcome.status}`); }
      }
      signal.throwIfAborted();
      if ((await this.plan(input.candidateId)).inputHash !== input.inputHash) throw Error('Core source, lock or toolchain changed during build');
      await stat(join(directory, 'dist/cli.js'));
      const artifact = await coreTreeManifest(directory);
      // Preserve exact output bytes; relocation is safe because absolute/escaping links were rejected.
      const artifactDirectory = join(this.root, 'artifacts', hash(input.inputHash + ':' + artifact.revision + ':' + buildId));
      await mkdir(dirname(artifactDirectory), { recursive: true, mode: 0o700 });
      await detachInternalHardLinks(directory, artifact.files);
      for (const file of artifact.files) if (file.kind === 'file') await durableReadOnly(join(directory, file.path), file.executable ? 0o500 : 0o400);
      for (const file of artifact.files.slice().reverse()) if (file.kind === 'directory') await durableReadOnly(join(directory, file.path), 0o500, true);
      await syncDirectory(directory);
      await rename(directory, artifactDirectory);
      await durableReadOnly(artifactDirectory, 0o500, true);
      await syncDirectory(dirname(artifactDirectory)); await syncDirectory(task); await syncDirectory(this.root);
      const after = await coreTreeManifest(artifactDirectory);
      if (after.revision !== artifact.revision) throw Error('Core build artifact changed while sealing');
      const manifest = await journal.artifact(JSON.stringify({ version: 1, buildId, plan, artifact }));
      signal.throwIfAborted();
      result.artifact = { directory: await realpath(artifactDirectory), revision: artifact.revision, manifest };
      result.status = 'passed';
    } catch (error) {
      result.error = journal.clean(String(error));
      if (result.status !== 'unknown') result.status = signal.aborted ? 'cancelled' : 'failed';
    } finally {
      try { await journal.append('core.build.finished', result, { candidateId: input.candidateId, validationTaskId: buildId }); }
      finally { await journal.close(); }
    }
    return result;
  }
}
