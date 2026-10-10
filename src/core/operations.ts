import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Journal, readSession, hash } from '../journal.js';
import { ApiError, validId } from '../shared/protocol.js';
import type { CoreOperation, CoreOperationInput } from '../shared/core-operation.js';
import { exists, safePath } from '../customization/resources.js';

type Outcome = Pick<CoreOperation, 'resultId' | 'error'> & { status: 'passed' | 'failed' | 'cancelled' | 'unknown' };
interface Active { input: CoreOperationInput; abort: AbortController; journal: Journal; done: Promise<void> }
/** Admission receipts coordinate Web work; build/validation Journals remain execution authorities. */
export class CoreOperations {
  private active = new Map<string, Active>();
  private gate: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> { const result = this.gate.then(operation); this.gate = result.catch(() => {}); return result; }
  private async path(commandId: string) {
    if (!validId(commandId)) throw new ApiError(400, 'core_operation_id', '核心操作编号无效');
    return safePath(this.root, join('core-operations', commandId));
  }
  busy() { return [...this.active.values()].map(task => ({ ...task.input, cancelling: task.abort.signal.aborted })); }
  async read(commandId: string): Promise<CoreOperation | undefined> {
    const path = await this.path(commandId);
    if (!await exists(path)) return undefined;
    const { events } = await readSession(path);
    const intent = events.find(event => event.type === 'core.operation.accepted')?.payload as CoreOperation | undefined;
    if (!intent) throw new ApiError(422, 'core_operation_history', '核心操作缺少可靠接受记录');
    const finish = events.find(event => event.type === 'core.operation.finished')?.payload as Outcome & { finishedAt: string } | undefined;
    const cancelRequested = events.some(event => event.type === 'core.operation.cancel-requested');
    return { ...intent, ...finish, cancelRequested, status: finish?.status ?? (this.active.has(commandId) ? cancelRequested ? 'cancelling' : 'running' : 'unknown') };
  }
  async list(sessionId: string) {
    const path = await safePath(this.root, 'core-operations');
    if (!await exists(path)) return [];
    const operations: CoreOperation[] = [];
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (!item.isDirectory() || !validId(item.name)) continue;
      const task = await this.read(item.name);
      if (task?.sessionId === sessionId) operations.push(task);
    }
    return operations.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async start(input: CoreOperationInput, execute: (signal: AbortSignal) => Promise<Outcome>, admit?: () => Promise<void>) {
    return this.serial(async () => {
      const requestHash = hash(JSON.stringify(input)), previous = await this.read(input.commandId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ApiError(409, 'core_operation_conflict', '核心操作编号已绑定其他输入');
        return previous;
      }
      if (this.active.size) throw new ApiError(409, 'core_operation_busy', '已有核心构建或验证正在执行');
      await admit?.();
      const journal = await Journal.open(await this.path(input.commandId), { secrets: Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key)).map(([, value]) => value ?? '').filter(Boolean) });
      const task: CoreOperation = { ...input, version: 1, requestHash, status: 'running', cancelRequested: false, startedAt: new Date().toISOString() };
      try { await journal.append('core.operation.accepted', task, { candidateId: input.candidateId }); }
      catch (error) { await journal.close(); throw error; }
      const active: Active = { input, journal, abort: new AbortController(), done: Promise.resolve() };
      this.active.set(input.commandId, active);
      active.done = (async () => {
        try {
          const result: Outcome = active.abort.signal.aborted ? { status: 'cancelled', error: '派发前已取消' } : await execute(active.abort.signal);
          await journal.append('core.operation.finished', { ...result, finishedAt: new Date().toISOString() });
        } catch (error) {
          // A thrown transport/storage error does not prove child-process cleanup or failure.
          await journal.append('core.operation.finished', { status: 'unknown', error: journal.clean(String(error)), finishedAt: new Date().toISOString() });
        } finally { try { await journal.close(); } finally { this.active.delete(input.commandId); } }
      })();
      void active.done.catch(() => {});
      return task;
    });
  }
  async cancel(commandId: string, sessionId: string) {
    return this.serial(async () => {
      const task = await this.read(commandId);
      if (!task || task.sessionId !== sessionId) throw new ApiError(404, 'core_operation_missing', '此会话没有该核心任务');
      const active = this.active.get(commandId);
      if (!active || !['running', 'cancelling'].includes(task.status)) return task;
      if (!task.cancelRequested) {
        await active.journal.append('core.operation.cancel-requested', { reason: 'user' });
        active.abort.abort(new Error('用户请求停止核心任务'));
      }
      return (await this.read(commandId))!;
    });
  }
  abortAll(reason: Error) { for (const task of this.active.values()) task.abort.abort(reason); }
  async close() { await this.gate; this.abortAll(new Error('服务正在停止')); await Promise.allSettled([...this.active.values()].map(task => task.done)); }
}
