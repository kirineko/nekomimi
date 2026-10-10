import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { Journal, readSession, type JournalEvent } from '../journal.js';
import { ApiError } from '../shared/protocol.js';
import { inspectDataHome } from '../storage/format.js';
import type { CoreSwitchBlocker } from './switch-gate.js';
const operations = [{ root: 'core-builds', prefix: 'core.build', field: 'buildId', kind: 'core-build' }, { root: 'core-validations', prefix: 'core.validation', field: 'validationId', kind: 'core-validation' }] as const;
function unfinished(events: JournalEvent[], operation: typeof operations[number]): CoreSwitchBlocker[] {
  const terminals = new Map(events.filter(event => event.type === operation.prefix + '.finished').map(event => [(event.payload as Record<string, unknown>)[operation.field], event.payload as Record<string, unknown>]));
  return events.filter(event => event.type === operation.prefix + '.intent').flatMap(event => {
    const value = event.payload as Record<string, unknown>, key = value[operation.field], terminal = terminals.get(key);
    const outcomes = terminal ? (Array.isArray(terminal.processes) ? terminal.processes : terminal.process ? [terminal.process] : []) as { pid?: number; cleanup?: string }[] : [];
    const started = events.filter(item => item.type === operation.prefix + '.process.started' && item.validationTaskId === key).map(item => (item.payload as { pid?: number }).pid).filter(pid => typeof pid === 'number');
    const uncertain = terminal && (!['passed', 'failed', 'cancelled'].includes(String(terminal.status)) || outcomes.some(outcome => outcome.cleanup !== 'confirmed') || started.some(pid => !outcomes.some(outcome => outcome.pid === pid && outcome.cleanup === 'confirmed')) || Array.isArray(terminal.ports) && terminal.ports.some(port => port.closed !== true));
    if (!terminal || uncertain) return [{ kind: operation.kind, id: String(key), state: terminal ? 'unknown' : 'unfinished' }];
    return [];
  });
}
/** Read-only observation. A lease is a blocker, never proof that a particular PID is live. */
export async function coreOperationBlockers(home: string): Promise<CoreSwitchBlocker[]> {
  if (await inspectDataHome(home) !== 'supported') return [];
  const blockers: CoreSwitchBlocker[] = [];
  for (const operation of operations) {
    const directory = join(home, operation.root, 'journal');
    try { await stat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (await lockfile.check(directory)) blockers.push({ kind: operation.kind, state: 'writer-lease' });
    blockers.push(...unfinished((await readSession(directory)).events, operation));
  }
  return blockers;
}
/** Existing build/validation dispatchers acquire these same writers before executing code. */
export async function reserveCoreOperations(home: string) {
  if (await inspectDataHome(home) !== 'supported') throw new ApiError(422, 'incompatible_format', '核心切换要求已初始化的新格式数据目录');
  const journals: Journal[] = [];
  let closed = false;
  const release = async () => {
    closed = true;
    const results = await Promise.allSettled(journals.splice(0).reverse().map(journal => journal.close()));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  };
  try {
    for (const operation of operations) {
      let journal: Journal;
      try { journal = await Journal.open(join(home, operation.root, 'journal')); }
      catch (error) { throw new ApiError(409, 'core_busy', `${operation.kind} 写入保留不可取得；请检查任务、租约状态与日志完整性`); }
      journals.push(journal);
      const blockers = unfinished(journal.events, operation);
      if (blockers.length) throw new ApiError(409, 'core_busy', `核心任务尚无确定终态：${blockers.map(blocker => `${blocker.kind}/${blocker.id}/${blocker.state}`).join(', ')}`);
    }
    return { check() { if (closed) throw Error('Core operation reservation is closed'); for (const journal of journals) journal.check(); }, release };
  } catch (error) { await release(); throw error; }
}
