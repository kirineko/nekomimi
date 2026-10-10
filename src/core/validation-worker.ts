import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CoreProbeInput {
  directory: string; workspace: string; home: string; legacyHome: string; report: string;
  seedId: string; durableDirectory: string; expectedBuild: string; contracts: { api: number; sdk: number; data: number };
}
export interface CoreProbeReport {
  version: 1; stage: 'isolated-startup'; status: 'running' | 'passed' | 'failed';
  ports: number[]; checks: string[]; externalAttempts: number; createdId?: string; build?: string; error?: string;
  hostIntegration: 'not_run';
}
/** Executed by the current host's harness in an owned child, importing only the candidate runtime. */
export async function probeCandidate(input: CoreProbeInput) {
  const report: CoreProbeReport = { version: 1, stage: 'isolated-startup', status: 'running', ports: [], checks: [], externalAttempts: 0, hostIntegration: 'not_run' };
  const save = async () => { await writeFile(input.report + '.tmp', JSON.stringify(report), { mode: 0o600 }); await rename(input.report + '.tmp', input.report); };
  const check = async (name: string, condition: unknown) => { if (!condition) throw Error(`Candidate check failed: ${name}`); report.checks.push(name); await save(); };
  const localFetch = globalThis.fetch;
  const blocked: typeof fetch = async () => { report.externalAttempts++; throw Error('External requests disabled in isolated core validation'); };
  globalThis.fetch = blocked;
  let app: any;
  try {
    await save();
    const load = (path: string) => import(pathToFileURL(join(input.directory, 'dist', path)).href);
    const protocol = await load('shared/protocol.js'), versions = await load('shared/versions.js');
    await check('contracts', protocol.API_VERSION === input.contracts.api && versions.SDK_CONTRACT_VERSION === input.contracts.sdk && versions.DATA_FORMAT_VERSION === input.contracts.data);
    const identity = await (await load('customization/sdk.js')).hostIdentity();
    report.build = identity.build;
    await check('identity', identity.build === input.expectedBuild && identity.requiresBuild === false);
    const { openJournalStorage } = await load('pi/journal-storage.js');
    const durable = await openJournalStorage(input.durableDirectory, context);
    try {
      await check('durable-read', (await durable.storage.entry(2, context))?.entry?.data?.text === 'host fixture');
      await durable.storage.commit([{ type: 'entry', value: { id: 3, conversationId: 1, kind: 'core.validation', data: { text: 'candidate fixture' } } }], context);
    } finally { await durable.storage.close(context); }
    const restored = await openJournalStorage(input.durableDirectory, context);
    try { await check('durable-restart', (await restored.storage.entry(3, context))?.entry?.data?.text === 'candidate fixture'); }
    finally { await restored.storage.close(context); }
    const { startWeb } = await load('server/app.js');
    const start = async (home: string, initialCoreFence?: string) => {
      const instance = await startWeb({ workspace: input.workspace, home, naming: false, port: 0, initialCoreFence, coreControl: async (action: string) => ({ probe: 'isolated-core-control', action }), runtime: { fetch: blocked } });
      const url = new URL(instance.origin);
      if (url.hostname !== '127.0.0.1' || !url.port) { await instance.close(); throw Error('Candidate did not bind loopback'); }
      report.ports.push(Number(url.port)); await save(); return instance;
    };
    const request = async (path: string, body?: unknown) => {
      const response = await localFetch(app.origin + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${app.token}`, origin: app.origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error(`Candidate HTTP ${path}: ${response.status}`);
      return response;
    };
    app = await start(input.home);
    const html = await (await request('/')).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[a-zA-Z0-9_.-]+)"/g)].map(match => match[1]!);
    await check('web-assets', html.includes('<html') && assets.length > 0 && (await Promise.all(assets.map(async path => (await (await request(path)).arrayBuffer()).byteLength > 0))).every(Boolean));
    await check('no-credentials', (await (await request('/api/v1/config')).json()).configured === false);
    const seed = (await (await request('/api/v1/sessions')).json()).sessions.find((item: any) => item.id === input.seedId);
    await check('host-storage-read', !!seed);
    await request(`/api/v1/sessions/${input.seedId}/snapshot`);
    const created = await (await request('/api/v1/sessions', { version: 1, title: 'Isolated candidate persistence probe', commandId: 'core-validation-create', mode: 'work' })).json();
    report.createdId = created.id;
    await check('storage-write', typeof report.createdId === 'string');
    const supportsControl = typeof app.prepareCoreSwitch === 'function' && typeof app.releaseCoreSwitch === 'function' && typeof app.coreSwitchStatus === 'function';
    await app.close(); app = undefined;
    app = await start(input.home, supportsControl ? 'validation-core-fence' : undefined);
    if (supportsControl) {
      const blockedWrite = await localFetch(app.origin + '/api/v1/sessions', { method: 'POST', headers: { authorization: `Bearer ${app.token}`, origin: app.origin, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, title: 'Must not be created', commandId: 'blocked-core-fence', mode: 'work' }), signal: AbortSignal.timeout(5000) });
      await blockedWrite.arrayBuffer();
      await check('core-switch-control', blockedWrite.status === 409 && (await (await request('/api/v1/core/status')).json()).probe === 'isolated-core-control');
      await app.releaseCoreSwitch('validation-core-fence');
    }

    const items = (await (await request('/api/v1/sessions')).json()).sessions;
    await check('storage-restart', [input.seedId, report.createdId].every(id => items.some((item: any) => item.id === id)));
    await request(`/api/v1/sessions/${report.createdId}/snapshot`);
    await app.close(); app = undefined;
    let rejected = false;
    try { app = await start(input.legacyHome); } catch (error) { rejected = (error as { code?: string }).code === 'incompatible_format'; }
    await check('legacy-rejected', rejected);
    await check('no-external-requests', report.externalAttempts === 0);
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error); }
  finally { try { if (app) await app.close(); } catch (error) { report.status = 'failed'; report.error = String(error); } await save(); }
  // A successful probe still needs the parent's process-group and storage checks.
  if (report.status !== 'passed') process.exitCode = 1;
}
