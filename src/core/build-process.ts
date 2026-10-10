import { spawn, type ChildProcess } from 'node:child_process';
import type { Journal } from '../journal.js';
import { StreamRedactor } from '../redaction.js';

export interface CoreProcessResult {
  status: 'passed' | 'failed' | 'cancelled' | 'unknown';
  exitCode: number | null;
  signal: string | null;
  cleanup: 'confirmed' | 'unknown';
  cleanupScope: 'process-group';
  bytes: number;
  error?: string;
  pid?: number;
  dispatched: boolean;
}
/** Owned POSIX process group, bounded durable output, and explicit termination evidence. */
export async function runCoreBuildProcess(options: {
  executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal;
  journal: Journal; step: number; logBytes: number;
  secrets?: string[]; eventPrefix?: 'core.build' | 'core.validation' | 'core.launch';
  ipc?: { started(child: ChildProcess): void; message(value: unknown): void };
}): Promise<CoreProcessResult> {
  const { journal, step, signal } = options;
  const prefix = options.eventPrefix ?? 'core.build';
  signal.throwIfAborted(); journal.check();
  await journal.append(`${prefix}.process.intent`, { step, executable: options.executable, args: options.args, cwd: options.cwd });
  if (signal.aborted) return { status: 'cancelled', exitCode: null, signal: null, cleanup: 'confirmed', cleanupScope: 'process-group', bytes: 0, dispatched: false };
  journal.check();
  return new Promise(resolve => {
    const child = spawn(options.executable, options.args, { cwd: options.cwd, env: options.env, detached: true, stdio: options.ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, failure: string | undefined, ended = false;
    let exitCode: number | null = null, exitSignal: string | null = null;
    let output = Promise.resolve(), killTimer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
    const redactors = { stdout: new StreamRedactor(options.secrets ?? []), stderr: new StreamRedactor(options.secrets ?? []) };
    const exists = () => { if (!child.pid) return false; try { process.kill(-child.pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; } };
    const kill = (kind: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, kind); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= String(e); }
    };
    const finish = async (unknown = false) => {
      if (ended) return; ended = true;
      clearTimeout(killTimer); clearTimeout(deadline); signal.removeEventListener('abort', stop);
      if (unknown) { child.stdout!.destroy(); child.stderr!.destroy(); child.unref(); }
      await output;
      try {
        for (const channel of ['stdout', 'stderr'] as const) {
          const tail = redactors[channel].push(Buffer.alloc(0), true).bytes;
          const keep = tail.subarray(0, Math.max(0, options.logBytes - bytes)); bytes += keep.length;
          if (keep.length) await journal.append(`${prefix}.output`, { step, channel, artifact: await journal.artifact(keep) });
          if (keep.length !== tail.length) failure ??= 'Core build log limit exceeded';
        }
      } catch (error) { failure = String(error); }
      const cleanup = exists() ? 'unknown' : 'confirmed';
      const status = unknown || cleanup === 'unknown' ? 'unknown' : signal.aborted ? 'cancelled' : failure || exitCode !== 0 ? 'failed' : 'passed';
      resolve({ status, exitCode, signal: exitSignal, cleanup, cleanupScope: 'process-group', bytes, dispatched: !!child.pid, ...(child.pid ? { pid: child.pid } : {}), ...(failure ? { error: failure } : {}) });
    };
    const stop = () => {
      if (ended || deadline) return;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1000);
      deadline = setTimeout(() => { failure ??= 'Build process termination could not be confirmed'; void finish(true); }, 5000);
    };
    for (const [channel, stream] of [['stdout', child.stdout!], ['stderr', child.stderr!]] as const) stream.on('data', (data: Buffer) => {
      stream.pause();
      data = redactors[channel].push(data).bytes;
      const remaining = Math.max(0, options.logBytes - bytes), keep = data.subarray(0, remaining); bytes += keep.length;
      output = output.then(async () => {
        if (keep.length) await journal.append(`${prefix}.output`, { step, channel, artifact: await journal.artifact(keep) });
        if (keep.length !== data.length) { failure = 'Core build log limit exceeded'; await journal.append(`${prefix}.output.limit`, { step, limit: options.logBytes, omittedBytes: data.length - keep.length }); stop(); }
      }).catch(error => { failure = String(error); stop(); }).finally(() => { if (!ended) stream.resume(); });
    });
    output = journal.append(`${prefix}.process.started`, { step, pid: child.pid, group: child.pid }).then(() => {}).catch(error => { failure = String(error); stop(); });
    if (options.ipc) {
      child.on('message', value => { try { options.ipc!.message(value); } catch (error) { failure = String(error); stop(); } });
      try { options.ipc.started(child); } catch (error) { failure = String(error); stop(); }
    }
    child.once('error', error => { failure = String(error); void finish(); });
    child.once('exit', (code, kind) => { exitCode = code; exitSignal = kind; if (exists()) stop(); });
    child.once('close', () => {
      if (!exists()) { void finish(); return; }
      stop();
      const poll = () => { if (ended) return; if (!exists()) void finish(); else setTimeout(poll, 20); };
      poll();
    });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    // A lease failure must stop scripts even if they produce no output.
    const leasePoll = setInterval(() => { if (ended) { clearInterval(leasePoll); return; } try { journal.check(); } catch (error) { failure = String(error); stop(); } }, 100);
  });
}
