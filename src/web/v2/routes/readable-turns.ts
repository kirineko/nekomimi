import type { TimelineRow } from '../../../shared/protocol.js';
import { conversationTurns } from '../../turns.js';

export interface ReadableTurn {
  id: string;
  calls: TimelineRow[];
  status?: string;
  rows: TimelineRow[];
  summaryOnly: boolean;
}

/** A display-only projection. Never join non-adjacent runs or infer success
 * from a partial page. Original call records remain available in inspection. */
export function readableTurns(rows: TimelineRow[]): ReadableTurn[] {
  return conversationTurns(rows).map(turn => {
    const calls = turn.rows.filter(row => row.kind === 'call');
    const primary = calls.filter(row => row.title !== '会话命名');
    const terminal = [...turn.rows].reverse().find(row => row.kind === 'status' && ['任务结束', '上下文整理'].includes(row.title));
    const last = primary.at(-1) ?? calls.at(-1);
    const failure = !terminal && last?.status && !['completed', 'running'].includes(last.status) ? last : undefined;
    const visible = turn.rows.filter(row => {
      if (row.kind === 'call') return row === failure;
      return !(row.kind === 'status' && row.status === 'completed' && !row.text && !row.details && !row.refs.length && ['任务结束', '命令结果'].includes(row.title));
    });
    return {
      id: turn.id, calls, status: terminal?.status ?? (last?.status === 'completed' ? undefined : last?.status),
      // Keep the first original row as a stable summary/scroll anchor as a reply arrives.
      rows: [turn.rows[0]!, ...visible.filter(row => row !== turn.rows[0])], summaryOnly: !visible.includes(turn.rows[0]!),
    };
  });
}
