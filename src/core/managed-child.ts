import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { id, type Journal } from '../journal.js';
import { ApiError } from '../shared/protocol.js';
import { runCoreBuildProcess, type CoreProcessResult } from './build-process.js';
export interface ManagedIdentity { version: string; build: string; entry: string; requiresBuild: boolean }
export interface ManagedReady { type: 'ready'; origin: string; identity: ManagedIdentity; switchSupported: boolean; storageCompatibility?: { version: number; dataFormatVersion: number; sdkVersion: number; journals: number; writes: false } }
export interface ManagedChild { ready: ManagedReady; done: Promise<CoreProcessResult>; stop(): Promise<CoreProcessResult>; command(action: string, value?: unknown): Promise<any> }
export async function startManagedChild(options: {
  directory: string; workspace: string; home: string; port: number; expectedBuild: string; browserToken: string;
  initialCoreFence?: string;
  requireStorageCompatibility?: boolean;
  journal: Journal; candidateId: string; signal: AbortSignal; secrets: string[];
  control(action: string, value: Record<string, unknown>): Promise<unknown>;
}): Promise<ManagedChild> {
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, options.signal]);
  let child: ChildProcess | undefined, accept!: (value: ManagedReady) => void, reject!: (error: Error) => void;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const ready = new Promise<ManagedReady>((resolve, fail) => { accept = resolve; reject = fail; });
  const send = (value: unknown) => { if (child?.connected) child.send(value as any, error => { if (error) { reject(error); controller.abort(); } }); };
  const config = { directory: options.directory, workspace: options.workspace, home: options.home, port: options.port, expectedBuild: options.expectedBuild, initialCoreFence: options.initialCoreFence, requireStorageCompatibility: options.requireStorageCompatibility, controlled: true };
  const worker = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './managed-worker.ts' : './managed-worker.js', import.meta.url));
  const bootstrap = import.meta.url.endsWith('.ts')
    ? `const {createJiti}=await import(${JSON.stringify(createRequire(import.meta.url).resolve('jiti'))});const m=await createJiti(import.meta.url,{fsCache:false}).import(${JSON.stringify(worker)});await m.runManagedWorker(${JSON.stringify(config)});`
    : `const m=await import(${JSON.stringify(new URL('./managed-worker.js', import.meta.url).href)});await m.runManagedWorker(${JSON.stringify(config)});`;
  const startup = setTimeout(() => { reject(Error('Managed candidate startup timed out')); controller.abort(); }, 15000);
  const done = options.journal.withLinks({ candidateId: options.candidateId }, () => runCoreBuildProcess({ executable: process.execPath, args: ['--input-type=module', '-e', bootstrap], cwd: options.workspace,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TZ'].includes(key))),
    signal, journal: options.journal, step: 0, logBytes: 1024 * 1024, secrets: [...options.secrets, options.browserToken], eventPrefix: 'core.launch', ipc: {
      started(value) { child = value; },
      message(value) {
        const message = value as any;
        if (message?.type === 'boot-request') { send({ type: 'boot', browserToken: options.browserToken }); return; }
        if (message?.type === 'command-result') {
          const task = pending.get(message.id); if (!task) return;
          clearTimeout(task.timer); pending.delete(message.id);
          if (message.error) task.reject(new ApiError(message.error.status ?? 500, message.error.code ?? 'core_control', String(message.error.message))); else task.resolve(message.value);
          return;
        }
        if (message?.type === 'control-request') {
          void options.control(String(message.action), message.value ?? {}).then(value => send({ type: 'control-result', id: message.id, value }), error => send({ type: 'control-result', id: message.id, error: { status: error instanceof ApiError ? error.status : 500, code: error instanceof ApiError ? error.code : 'core_control', message: options.journal.clean(String(error.message ?? error)) } })); return;
        }
        if (message?.type !== 'ready') return;
        try {
          const origin = new URL(message.origin);
          if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== message.origin || message.identity?.build !== options.expectedBuild || message.identity.entry !== join(options.directory, 'dist/cli.js') || message.identity.requiresBuild) throw Error('Invalid managed child identity');
          accept(message as ManagedReady);
        } catch (error) { reject(error as Error); controller.abort(); }
      },
    } })).finally(() => {
      clearTimeout(startup); reject(Error('Managed candidate exited before readiness'));
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('Managed candidate disconnected')); } pending.clear();
    });
  void done.catch(() => {});
  try {
    const started = await ready;
    if (options.requireStorageCompatibility && (!started.storageCompatibility || started.storageCompatibility.version !== 1 || started.storageCompatibility.writes !== false)) throw Error('Candidate did not confirm read-only storage compatibility');
    const response = await fetch(started.origin + '/api/v1/config', { headers: { authorization: `Bearer ${options.browserToken}`, origin: started.origin }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw Error(`Managed candidate health failed: ${response.status}`);
    await response.json(); signal.throwIfAborted(); options.journal.check(); clearTimeout(startup);
    if (started.storageCompatibility) await options.journal.append('core.launch.storage-compatible', { build: started.identity.build, ...started.storageCompatibility });
    return { ready: started, done, async stop() { controller.abort(); return done; },
      command(action, value) {
        if (!child?.connected) return Promise.reject(Error('Managed candidate disconnected'));
        const requestId = id();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(requestId); reject(Error('Managed candidate command timed out')); }, 15000);
          pending.set(requestId, { resolve, reject, timer }); send({ type: 'command', id: requestId, action, value });
        });
      } };
  } catch (error) { controller.abort(); const processOutcome = await done.catch(() => undefined); throw Object.assign(error instanceof Error ? error : Error(String(error)), { processOutcome }); }
}
