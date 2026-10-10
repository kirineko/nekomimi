import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Journal, hash, id, readSession, type Artifact } from '../journal.js';
import { hostIdentity } from '../customization/sdk.js';
import { inspectDataHome, prepareDataHome } from '../storage/format.js';
import { userHome } from '../storage/paths.js';
import { currentTargetHost } from '../session/identity.js';
import { checkDevelopmentTarget } from '../session/target.js';
import type { TargetHost } from '../shared/protocol.js';

export interface CoreSourceFile { path: string; sha256: string; bytes: number; executable: boolean }
export interface CoreSourceBaseline {
  root: string;
  revision: string;
  packageVersion: string;
  lockHash: string;
  buildCommand: string;
  files: CoreSourceFile[];
  directories: string[];
  excluded: string[];
}
export interface CoreCandidate {
  version: 1;
  id: string;
  ownerWorkspace: string;
  directory: string;
  directoryIdentity: { device: string; inode: string };
  targetHost: TargetHost;
  source: CoreSourceBaseline;
  preparedAt: string;
  sourceArtifacts?: Record<string, Artifact>;
}
const omitted = new Set(['.git', 'node_modules', 'dist', '.nekomimi', '.npmrc']);
const generatedRoots = new Set(['reference', '.harness', 'artifacts', 'output', 'test-results', 'playwright-report', 'coverage']);
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
};
async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await canonicalPath(dirname(path)), relative(dirname(path), path));
  }
}

/** Actual file bytes, including uncommitted/untracked code; no git reset or scripts. */
export async function scanCoreSource(selected: string) {
  const root = await realpath(selected), files: CoreSourceFile[] = [], directories: string[] = [], excluded: string[] = [];
  const contents = new Map<string, Buffer>(); let total = 0;
  const walk = async (directory: string, prefix = '', depth = 0): Promise<void> => {
    if (depth > 32) throw Error('Core source directory depth limit');
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), key = prefix + name;
      if (omitted.has(name) || name === '.env' || name.startsWith('.env.') || !prefix && (generatedRoots.has(name) || name.endsWith('.tgz'))) { excluded.push(key); continue; }
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw Error(`Core source symlink rejected: ${key}`);
      if (info.isDirectory()) { if (directories.length >= 20000) throw Error('Core source directory count limit'); directories.push(key); await walk(path, key + '/', depth + 1); continue; }
      if (!info.isFile() || info.size > 8 * 1024 * 1024 || files.length >= 20000) throw Error(`Core source file limit: ${key}`);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.size > 8 * 1024 * 1024) throw Error(`Core source changed: ${key}`);
        bytes = await handle.readFile();
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) throw Error(`Core source changed: ${key}`);
      } finally { await handle.close(); }
      total += bytes.length;
      if (total > 256 * 1024 * 1024) throw Error('Core source snapshot byte limit');
      contents.set(key, bytes);
      files.push({ path: key, sha256: hash(bytes), bytes: bytes.length, executable: !!(info.mode & 0o111) });
    }
  };
  await walk(root);
  const revision = hash(JSON.stringify({ files, directories }));
  return { root, files, directories, revision, excluded, contents };
}

function prerequisites(snapshot: Awaited<ReturnType<typeof scanCoreSource>>) {
  try {
    const pkg = JSON.parse(snapshot.contents.get('package.json')!.toString());
    const lock = JSON.parse(snapshot.contents.get('package-lock.json')!.toString());
    if (pkg.name !== 'nekomimi' || typeof pkg.version !== 'string' || lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== pkg.version ||
        typeof pkg.scripts?.build !== 'string' || !pkg.scripts.build.trim() || !snapshot.contents.has('src/cli.ts') || !snapshot.contents.has('tsconfig.build.json')) throw Error('missing');
    return { packageVersion: pkg.version as string, lockHash: hash(snapshot.contents.get('package-lock.json')!), buildCommand: pkg.scripts.build as string };
  } catch { throw Error('核心源码缺少 package/lock/构建入口；请选择完整源码，不会下载或执行脚本'); }
}

/** Journal is the registry; candidate files are editable, the source baseline is immutable. */
export class CoreCandidates {
  readonly home: string;
  private get journalPath() { return join(this.home, 'core-candidates', 'journal'); }
  constructor(readonly ownerWorkspace: string, home?: string, private readonly inspectionHost?: TargetHost) { this.home = userHome(home); }
  async preview(source: string) {
    if (this.inspectionHost) throw Error('Delegated core target is inspection-only');
    if (typeof source !== 'string' || !source.trim()) throw Error('Select an explicit core source directory');
    const snapshot = await scanCoreSource(source), details = prerequisites(snapshot), host = await hostIdentity();
    if (details.packageVersion !== host.version) throw Error(`核心源码版本 ${details.packageVersion} 与目标宿主 ${host.version} 不匹配；请修正来源或明确选择匹配宿主，不会准备候选`);
    const { contents: _, ...baseline } = snapshot;
    return { source: { ...baseline, ...details }, targetHost: await currentTargetHost(), runsScripts: false as const };
  }
  async prepare(input: { source: string; destination: string; sourceRevision: string; targetHostBuild: string }): Promise<CoreCandidate> {
    if (!input || typeof input.source !== 'string' || typeof input.destination !== 'string' || !input.destination.trim() || !/^[a-f0-9]{64}$/.test(input.sourceRevision) || !/^[a-f0-9]{64}$/.test(input.targetHostBuild)) throw Error('Core prepare requires source, destination, sourceRevision and targetHostBuild');
    const preview = await this.preview(input.source);
    if (preview.source.revision !== input.sourceRevision) throw Error('Core source revision changed; preview again');
    if (preview.targetHost.build !== input.targetHostBuild) throw Error('Core target host changed; preview again');
    const ownerWorkspace = await realpath(this.ownerWorkspace);
    const requested = resolve(input.destination), parent = await realpath(dirname(requested));
    const directory = join(parent, relative(dirname(requested), requested));
    if (within(preview.source.root, directory) || within(directory, preview.source.root)) throw Error('Core candidate directory must be independent of source');
    const canonicalHome = await canonicalPath(this.home);
    if (within(preview.source.root, canonicalHome)) throw Error('Core candidate registry must be outside source');
    await checkDevelopmentTarget({ id: hash(directory), kind: 'extension', root: directory, scope: 'project', rootIdentity: { device: '0', inode: '0' }, host: preview.targetHost }, ownerWorkspace, this.home);
    const snapshot = await scanCoreSource(preview.source.root);
    if (snapshot.revision !== input.sourceRevision) throw Error('Core source revision changed; preview again');
    await prepareDataHome(this.home);
    const journal = await Journal.open(this.journalPath), candidateId = id();
    try {
      await journal.append('core.candidate.prepare.intent', { candidateId, source: preview.source, directory, ownerWorkspace, targetHost: preview.targetHost }, { candidateId });
      // Exclusive mkdir never adopts or replaces an existing destination.
      await mkdir(directory, { mode: 0o700 });
      const directoryStat = await stat(directory, { bigint: true });
      for (const name of snapshot.directories) await mkdir(join(directory, name), { recursive: true, mode: 0o700 });
      for (const file of snapshot.files) {
        const path = join(directory, file.path);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, snapshot.contents.get(file.path)!, { flag: 'wx', mode: file.executable ? 0o700 : 0o600 });
      }
      const sourceArtifacts: Record<string, Artifact> = Object.create(null);
      for (const file of snapshot.files) sourceArtifacts[file.path] = await journal.artifact(snapshot.contents.get(file.path)!);
      if ((await scanCoreSource(preview.source.root)).revision !== input.sourceRevision || (await scanCoreSource(directory)).revision !== input.sourceRevision)
        throw Error('Core source or copied snapshot changed during preparation');
      const candidate: CoreCandidate = { sourceArtifacts, version: 1, id: candidateId, ownerWorkspace, directory, directoryIdentity: { device: String(directoryStat.dev), inode: String(directoryStat.ino) }, targetHost: preview.targetHost, source: preview.source, preparedAt: new Date().toISOString() };
      await journal.append('core.candidate.prepared', candidate, { candidateId });
      return candidate;
    } catch (error) {
      await journal.append('core.candidate.prepare.failed', { candidateId, directory, error: String(error), cleanup: 'partial directory preserved; not registered as prepared' }, { candidateId });
      throw error;
    } finally { await journal.close(); }
  }
  async list(): Promise<CoreCandidate[]> {
    await inspectDataHome(this.home);
    try { await stat(join(this.journalPath, 'journal.jsonl')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const owner = await realpath(this.ownerWorkspace);
    return (await readSession(this.journalPath)).events.filter(event => event.type === 'core.candidate.prepared').map(event => event.payload as CoreCandidate).filter(candidate => candidate.ownerWorkspace === owner);
  }
  async inspect(candidateId: string) {
    const candidate = (await this.list()).find(item => item.id === candidateId);
    if (!candidate) throw Error('Unknown core candidate');
    const info = await stat(candidate.directory, { bigint: true });
    if (await realpath(candidate.directory) !== candidate.directory || String(info.dev) !== candidate.directoryIdentity.device || String(info.ino) !== candidate.directoryIdentity.inode) throw Error('Core candidate directory identity changed');
    const snapshot = await scanCoreSource(candidate.directory), current = prerequisites(snapshot);
    return { candidate, current: { revision: snapshot.revision, ...current, files: snapshot.files, directories: snapshot.directories }, changed: snapshot.revision !== candidate.source.revision,
      hostMatches: JSON.stringify(candidate.targetHost) === JSON.stringify(this.inspectionHost ?? await currentTargetHost()), stage: 'source-prepared' as const, built: false as const, applied: false as const };
  }
}
