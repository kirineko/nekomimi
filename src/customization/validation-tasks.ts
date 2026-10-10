import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Journal, readSession } from '../journal.js';
import { ApiError, validId } from '../shared/protocol.js';
import type { ValidationTask } from '../shared/validation-task.js';
import type { ValidationReport } from './validation.js';
import type { Resource } from './resources.js';
import { exists, safePath } from './resources.js';

interface Active {
  task: ValidationTask;
  journal: Journal;
  abort: AbortController;
  done: Promise<void>;
}
/** One authoritative operation Journal per command; readers never resume execution. */
export class ValidationTasks {
  private active = new Map<string, Active>();
  private gate: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.gate.then(operation); this.gate = result.catch(() => {}); return result;
  }
  private async path(id: string) {
    if (!validId(id)) throw new ApiError(400, 'validation_id', '验证任务编号无效');
    return safePath(this.root, join('validation-tasks', id));
  }
  busy() { return [...this.active.values()].map(value => value.task); }
  async read(id: string): Promise<ValidationTask | undefined> {
    const path = await this.path(id);
    if (!await exists(path)) return undefined;
    const { events } = await readSession(path);
    const intent = events.find(event => event.type === 'validation.intent')?.payload as ValidationTask | undefined;
    if (!intent) throw new ApiError(422, 'validation_history', '验证任务缺少可靠意图');
    const finish = events.find(event => event.type === 'validation.finished')?.payload as Partial<ValidationTask> | undefined;
    const cancelRequested = events.some(event => event.type === 'validation.cancel-requested');
    return { ...intent, ...finish, cancelRequested,
      status: finish?.status ?? (this.active.has(id) ? cancelRequested ? 'cancelling' : 'running' : 'unknown'),
      logs: events.filter(event => event.type === 'validation.log').map(event => ({ at: event.timestamp, message: (event.payload as { message: string }).message })),
    };
  }
  async list(sessionId: string, candidateId: string) { return this.listSession(sessionId, candidateId); }
  async listSession(sessionId: string, candidateId?: string) {
    const directory = await safePath(this.root, 'validation-tasks');
    if (!await exists(directory)) return [];
    const tasks: ValidationTask[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const task = await this.read(entry.name);
      if (task?.sessionId === sessionId && (!candidateId || task.candidateId === candidateId)) tasks.push(task);
    }
    return tasks.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100);
  }
  async start(input: Omit<ValidationTask, 'version' | 'status' | 'cancelRequested' | 'startedAt' | 'logs'>, resource: Resource,
    record: (report: ValidationReport) => Promise<unknown>) {
    return this.accept(input, active => this.run(active, resource, record));
  }
  async startExecution(input: Omit<ValidationTask, 'version' | 'status' | 'cancelRequested' | 'startedAt' | 'logs'>,
    execute: (signal: AbortSignal) => Promise<NonNullable<ValidationTask['result']>>, failed?: () => void) {
    return this.accept(input, active => this.runExecution(active, execute, failed));
  }
  private async accept(input: Omit<ValidationTask, 'version' | 'status' | 'cancelRequested' | 'startedAt' | 'logs'>, run: (active: Active) => Promise<void>) {
    return this.exclusive(async () => {
      const previous = await this.read(input.id);
      if (previous) {
        if (previous.sessionId !== input.sessionId || previous.candidateId !== input.candidateId || previous.contentHash !== input.contentHash || previous.hostBuild !== input.hostBuild || previous.target !== input.target || previous.stage !== input.stage || previous.requestHash !== input.requestHash)
          throw new ApiError(409, 'validation_conflict', '此任务编号已绑定其他验证输入');
        return previous;
      }
      if (this.active.size >= 2 || this.busy().some(task => task.target === input.target)) throw new ApiError(409, 'validation_busy', '该目标已有验证任务，或验证并发已满');
      const task: ValidationTask = { ...input, version: 1, status: 'running', cancelRequested: false, startedAt: new Date().toISOString(), logs: [] };
      const journal = await Journal.open(await this.path(input.id));
      try { await journal.append('validation.intent', task, { validationTaskId: task.id, candidateId: task.candidateId, resourceRevision: task.contentHash }); }
      catch (error) { await journal.close(); throw error; }
      const active: Active = { task, journal, abort: new AbortController(), done: Promise.resolve() };
      this.active.set(task.id, active);
      active.done = run(active).finally(() => { this.active.delete(task.id); });
      // A storage failure leaves an unfinished intent. It is observed as unknown, never retried.
      void active.done.catch(() => {});
      return task;
    });
  }
  async cancel(id: string, sessionId: string) {
    return this.exclusive(async () => {
      const task = await this.read(id);
      if (!task || task.sessionId !== sessionId) throw new ApiError(404, 'validation_missing', '此会话没有该验证任务');
      const active = this.active.get(id);
      if (!active || !['running', 'cancelling'].includes(task.status)) return task;
      if (!task.cancelRequested) {
        await active.journal.append('validation.cancel-requested', { reason: 'user' });
        active.task.status = 'cancelling';
        active.abort.abort(new Error('用户请求停止验证'));
      }
      return (await this.read(id))!;
    });
  }
  abortAll(reason: Error) { for (const active of this.active.values()) active.abort.abort(reason); }
  async close() {
    await this.gate;
    this.abortAll(new Error('服务正在停止'));
    await Promise.allSettled([...this.active.values()].map(value => value.done));
  }
  private async runExecution(active: Active, execute: (signal: AbortSignal) => Promise<NonNullable<ValidationTask['result']>>, failed?: () => void) {
    const { journal, abort, task } = active;
    const timer = setTimeout(() => abort.abort(new Error('验证超过 60 秒预算')), 60000);
    try {
      await journal.append('validation.log', { message: task.stage === 'simulation' ? '开始可信代码模拟；宿主工具与模型使用模拟服务。' : '开始构建候选预览；不提供宿主操作。' });
      if (abort.signal.aborted) {
        await journal.append('validation.finished', { status: 'cancelled', error: '派发前已取消', finishedAt: new Date().toISOString() });
        return;
      }
      const result = await execute(abort.signal);
      await journal.append('validation.log', { message: '执行与清理已确认；此结果不代表应用或宿主验收通过。' });
      await journal.append('validation.finished', { status: 'passed', result, finishedAt: new Date().toISOString() });
    } catch (error) {
      failed?.();
      const verification = (error as { verification?: { status?: string } })?.verification;
      const status = verification && ['failed', 'cancelled', 'unknown'].includes(verification.status ?? '') ? verification.status : (error as {cleanup?:string})?.cleanup === 'confirmed' && abort.signal.aborted ? 'cancelled' : 'unknown';
      await journal.append('validation.log', { message: journal.clean(String(error)) });
      await journal.append('validation.finished', { status, error: journal.clean(String(error)),
        ...((error as { session?: string })?.session ? { result: { trialSession: (error as { session: string }).session } } : {}), finishedAt: new Date().toISOString() });
    } finally { clearTimeout(timer); await journal.close(); }
  }
  private async run(active: Active, resource: Resource, record: (report: ValidationReport) => Promise<unknown>) {
    const { journal, abort } = active;
    let worker: Worker | undefined;
    try {
      await journal.append('validation.log', { message: '静态校验已接受；固定候选快照，不执行扩展工厂。' });
      abort.signal.throwIfAborted();
      const module = new URL(import.meta.url.endsWith('.ts') ? './validation.ts' : './validation.js', import.meta.url).href;
      const loader = import.meta.url.endsWith('.ts')
        ? `require(${JSON.stringify(createRequire(import.meta.url).resolve('jiti'))}).createJiti(${JSON.stringify(import.meta.url)},{fsCache:false}).import(${JSON.stringify(module)})`
        : `import(${JSON.stringify(module)})`;
      worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
        (async()=>{const {checkTypes}=await ${loader};
        if(workerData.binaryFiles) for(const key of Object.keys(workerData.binaryFiles)) workerData.binaryFiles[key]=Buffer.from(workerData.binaryFiles[key]);
        parentPort.postMessage(checkTypes(workerData));})().catch(error=>{throw error;});`,
        { eval: true, workerData: resource, execArgv: [], env: { TZ: 'UTC', LANG: 'C.UTF-8' }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
      const compiler = worker;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; abort.abort(new Error('静态校验超过 60 秒')); }, 60000);
      let report: ValidationReport | undefined;
      const stop = () => { void compiler.terminate().catch(() => {}); };
      try {
        await new Promise<void>((resolve, reject) => {
          compiler.on('message', value => { report = value; });
          compiler.once('error', reject);
          compiler.once('exit', code => { if (abort.signal.aborted || code === 0) resolve(); else reject(new Error(`校验线程退出：${code}`)); });
          abort.signal.addEventListener('abort', stop, { once: true });
          if (abort.signal.aborted) stop();
        });
      } finally { clearTimeout(timer); abort.signal.removeEventListener('abort', stop); await compiler.terminate(); }
      if (timedOut) throw new Error('静态校验超过 60 秒，线程已退出');
      abort.signal.throwIfAborted();
      if (!report || report.contentHash !== active.task.contentHash) throw new Error('校验报告缺失或不属于该快照');
      await record(report);
      await journal.append('validation.log', { message: report.passed ? '编译检查通过；尚未执行预览、应用或宿主验收。' : `编译检查失败：${report.diagnostics.length} 条诊断。` });
      await journal.append('validation.finished', { status: report.passed ? 'passed' : 'failed', diagnostics: report.diagnostics, finishedAt: new Date().toISOString() });
    } catch (error) {
      // Termination acknowledgement is required before publishing a cancelled terminal state.
      if (worker) await worker.terminate();
      await journal.append('validation.log', { message: journal.clean(String(error)) });
      await journal.append('validation.finished', { status: abort.signal.aborted ? 'cancelled' : 'failed', error: journal.clean(String(error)), finishedAt: new Date().toISOString() });
    } finally { await journal.close(); }
  }
}
