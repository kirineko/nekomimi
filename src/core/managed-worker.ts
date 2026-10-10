import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../shared/protocol.js';
/** Host-owned bootstrap: tokens travel only over the parent's IPC channel. */
export async function runManagedWorker(input: { directory: string; workspace: string; home: string; port: number; expectedBuild: string; controlled?: boolean; initialCoreFence?: string; requireStorageCompatibility?: boolean }) {
  if (!process.send) throw Error('Managed worker requires an owned IPC channel');
  let app: any, stopping = false, CandidateApiError = ApiError;
  const calls = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  const send = (value: unknown) => { if (process.connected) process.send!(value as any, undefined, undefined, (error: Error | null) => { if (error) void stop(); }); };
  const stop = async () => {
    if (stopping) return; stopping = true;
    for (const call of calls.values()) call.reject(Error('Managed parent disconnected')); calls.clear();
    const deadline = setTimeout(() => process.exit(1), 5000);
    try { if (app) await app.close(); } finally { clearTimeout(deadline); if (process.connected) process.disconnect(); }
  };
  process.once('disconnect', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
  let boot!: (token: string) => void;
  const token = input.controlled ? new Promise<string>(resolve => { boot = resolve; }) : Promise.resolve(undefined);
  process.on('message', (value: unknown) => {
    const message = value as any;
    if (message?.type === 'stop') { void stop(); return; }
    if (message?.type === 'boot' && /^[a-f0-9]{64}$/.test(message.browserToken)) { boot?.(message.browserToken); return; }
    if (message?.type === 'control-result') {
      const call = calls.get(message.id); if (!call) return; calls.delete(message.id);
      if (message.error) call.reject(new CandidateApiError(message.error.status ?? 500, message.error.code ?? 'core_control', String(message.error.message))); else call.resolve(message.value);
      return;
    }
    if (message?.type === 'command') {
      void (async () => {
        if (!app || stopping) throw Error('Managed service not ready');
        if (message.action === 'status') return app.coreSwitchStatus();
        if (message.action === 'prepare') return app.prepareCoreSwitch(String(message.value?.token));
        if (message.action === 'release') return app.releaseCoreSwitch(String(message.value?.token));
        throw Error('Unknown managed command');
      })().then(value => send({ type: 'command-result', id: message.id, value }), error => send({ type: 'command-result', id: message.id, error: { status: error.status, code: error.code, message: String(error.message ?? error) } }));
    }
  });
  const load = (path: string) => import(pathToFileURL(join(input.directory, 'dist', path)).href);
  CandidateApiError = (await load('shared/protocol.js')).ApiError;
  const identity = await (await load('customization/sdk.js')).hostIdentity();
  if (identity.build !== input.expectedBuild || identity.requiresBuild) throw Error('Managed candidate identity mismatch');
  const storageCompatibility = input.requireStorageCompatibility ? await (await load('core/storage-compatibility.js')).inspectCoreStorage(input.workspace, input.home) : undefined;
  const { startWeb } = await load('server/app.js');
  if (stopping) return;
  if (input.controlled) send({ type: 'boot-request' });
  const browserToken = await token;
  if (stopping) return;
  app = await startWeb({ workspace: input.workspace, home: input.home, port: input.port, browserToken, initialCoreFence: input.initialCoreFence,
    ...(input.controlled ? { coreControl(action: string, value: Record<string, unknown>) {
      const id = randomUUID();
      return new Promise((resolve, reject) => { calls.set(id, { resolve, reject }); send({ type: 'control-request', id, action, value }); });
    } } : {}),
  });
  if (stopping) { await app.close(); return; }
  send({ type: 'ready', origin: app.origin, identity, storageCompatibility, switchSupported: typeof app.prepareCoreSwitch === 'function' && typeof app.releaseCoreSwitch === 'function' && typeof app.coreSwitchStatus === 'function' });
}
