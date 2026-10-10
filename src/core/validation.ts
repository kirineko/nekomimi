import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ConversationId, EntryId } from '@earendil-works/pi-durable';
import { openJournalStorage } from '../pi/journal-storage.js';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Journal, readSession } from '../journal.js';
import { Sessions } from '../server/sessions.js';
import { API_VERSION, validId } from '../shared/protocol.js';
import { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from '../shared/versions.js';
import { coreTreeManifest } from './manifest.js';
import { runCoreBuildProcess, type CoreProcessResult } from './build-process.js';
import type { CoreProbeInput, CoreProbeReport } from './validation-worker.js';

export async function coreDistIdentity(directory: string) {
  const root = join(directory, 'dist'), digest = createHash('sha256');
  const walk = async (path: string): Promise<void> => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { if (entry.name !== 'build-identity.json') digest.update(relative(root, file)).update('\0').update(await readFile(file)).update('\0'); }
      else throw Error('Candidate dist contains a non-regular entry');
    }
  };
  await walk(root);
  const build = digest.digest('hex'), declared = JSON.parse(await readFile(join(root, 'build-identity.json'), 'utf8'));
  if (declared.version !== 1 || declared.sha256 !== build) throw Error('Candidate build identity does not match dist bytes');
  return build;
}
export function portClosed(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (closed: boolean) => { socket.destroy(); resolve(closed); };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(false));
    socket.once('error', error => done((error as NodeJS.ErrnoException).code === 'ECONNREFUSED'));
  });
}
export interface CoreIsolationResult {
  status: 'passed' | 'failed' | 'cancelled' | 'unknown'; process?: CoreProcessResult; report?: CoreProbeReport;
  checks: string[]; ports: { port: number; closed: boolean }[]; error?: string;
  stage: 'isolated-startup'; hostIntegration: 'not_run'; applied: false;
}
/** This is trusted code execution with isolated state, not an OS security sandbox. */
export async function validateCoreIsolation(options: { directory: string; task: string; journal: Journal; signal: AbortSignal; secrets?: string[] }): Promise<CoreIsolationResult> {
  const result: CoreIsolationResult = { status: 'failed', checks: [], ports: [], stage: 'isolated-startup', hostIntegration: 'not_run', applied: false };
  const { journal, signal } = options;
  try {
    signal.throwIfAborted();
    const directory = await realpath(options.directory), expectedBuild = await coreDistIdentity(directory);
    await mkdir(options.task, { mode: 0o700 });
    const task = await realpath(options.task), workspace = join(task, 'workspace'), home = join(task, 'data'), legacyHome = join(task, 'legacy');
    const isolatedHome = join(task, 'home'), temporary = join(task, 'tmp');
    for (const path of [workspace, home, legacyHome, isolatedHome, temporary]) await mkdir(path, { mode: 0o700 });
    await writeFile(join(legacyHome, 'nekomimi-format.json'), JSON.stringify({ product: 'nekomimi', formatVersion: 1 }));
    await writeFile(join(legacyHome, 'sentinel'), 'Legacy user data must remain byte-identical.');
    const legacyRevision = (await coreTreeManifest(legacyHome)).revision;
    const sessions = await Sessions.open({ workspace, home, naming: false });
    let seedId: string;
    try { seedId = (await sessions.create('Current host compatibility fixture', { commandId: 'core-validation-seed', mode: 'work' })).id; }
    finally { await sessions.close(); }
    const durableDirectory = join(task, 'durable');
    const durable = await openJournalStorage(durableDirectory, context);
    try { await durable.storage.commit([
      { type: 'conversation', value: { id: 1 as ConversationId } },
      { type: 'entry', value: { id: 2 as EntryId, conversationId: 1 as ConversationId, kind: 'core.validation', data: { text: 'host fixture' } } },
    ], context); } finally { await durable.storage.close(context); }
    const input: CoreProbeInput = { directory, durableDirectory, workspace, home, legacyHome, report: join(task, 'report.json'), seedId, expectedBuild, contracts: { api: API_VERSION, sdk: SDK_CONTRACT_VERSION, data: DATA_FORMAT_VERSION } };
    const worker = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './validation-worker.ts' : './validation-worker.js', import.meta.url));
    const bootstrap = import.meta.url.endsWith('.ts')
      ? `const {createJiti}=await import(${JSON.stringify(createRequire(import.meta.url).resolve('jiti'))});const m=await createJiti(import.meta.url,{fsCache:false}).import(${JSON.stringify(worker)});await m.probeCandidate(${JSON.stringify(input)});`
      : `const m=await import(${JSON.stringify(new URL('./validation-worker.js', import.meta.url).href)});await m.probeCandidate(${JSON.stringify(input)});`;
    const env = { HOME: isolatedHome, USERPROFILE: isolatedHome, TMPDIR: temporary, TMP: temporary, TEMP: temporary, LANG: 'C.UTF-8', TZ: 'UTC', CI: '1' };
    await journal.append('core.validation.environment', { environment: env, inheritedCredentials: false, externalActions: 'disabled-by-probe', boundary: 'Trusted OS process; not an OS sandbox' });
    result.process = await runCoreBuildProcess({ executable: process.execPath, args: ['--input-type=module', '-e', bootstrap], cwd: workspace, env, signal, journal, step: 0, logBytes: 1024 * 1024, secrets: options.secrets, eventPrefix: 'core.validation' });
    result.status = result.process.status;
    // Read progress even after cancellation; an unfinished worker cannot claim success.
    try {
      if ((await stat(input.report)).size > 65536) throw Error('Candidate report exceeds limit');
      const report = JSON.parse(await readFile(input.report, 'utf8')) as CoreProbeReport;
      if (report.version !== 1 || report.stage !== 'isolated-startup' || !Array.isArray(report.ports) || report.ports.length > 8 || !report.ports.every(port => Number.isInteger(port) && port > 0 && port < 65536)) throw Error('Invalid candidate report');
      result.report = report;
      result.ports = await Promise.all(report.ports.map(async port => ({ port, closed: await portClosed(port) })));
    } catch (error) { result.error = String(error); }
    if ((await coreTreeManifest(legacyHome)).revision !== legacyRevision) throw Error('Candidate modified legacy data');
    result.checks.push('legacy-byte-identical');
    if (result.process.status !== 'passed') throw Error(result.process.error ?? `Candidate process ${result.process.status}`);
    const report = result.report;
    const required = ['contracts', 'identity', 'durable-read', 'durable-restart', 'web-assets', 'no-credentials', 'host-storage-read', 'storage-write', 'storage-restart', 'legacy-rejected', 'no-external-requests'];
    if (!report || report.status !== 'passed' || report.externalAttempts !== 0 || report.build !== expectedBuild || !required.every(check => report.checks.includes(check)) || !validId(report.createdId ?? '')) throw Error(report?.error ?? 'Candidate probe did not complete');
    if (result.ports.length < 2 || result.ports.some(port => !port.closed) || result.process.cleanup !== 'confirmed') throw Error('Candidate cleanup not confirmed');
    result.checks.push('ports-closed');
    const reader = await Sessions.open({ workspace, home, naming: false });
    try {
      const items = (await reader.list(0, 100)).sessions;
      if (![seedId, report.createdId].every(id => items.some(item => item.id === id))) throw Error('Current host cannot read candidate-written storage');
      for (const item of items) {
        const history = await readSession(join(reader.paths.sessions, item.id));
        if (history.events.some(event => /^(?:run\.|model\.|tool\.|attempt\.)/.test(event.type))) throw Error('Validation unexpectedly executed a task');
      }
    } finally { await reader.close(); }
    const restored = await openJournalStorage(durableDirectory, context);
    try {
      const entry = await restored.storage.entry(3 as EntryId, context);
      if ((entry?.entry.data as { text?: string } | undefined)?.text !== 'candidate fixture') throw Error('Current host cannot read candidate Durable commit');
    } finally { await restored.storage.close(context); }
    result.checks.push('host-storage-readback', 'no-business-execution', 'durable-host-readback');
    signal.throwIfAborted();
    result.status = 'passed';
  } catch (error) {
    result.error = journal.clean(String(error));
    if (result.status !== 'unknown') result.status = signal.aborted ? 'cancelled' : 'failed';
  }
  return result;
}
