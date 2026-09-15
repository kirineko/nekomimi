import type { TimelineRow } from "../shared/protocol.js";
export interface ConversationTurn { id: string; rows: TimelineRow[] }
/** Group adjacent rows only: partial pages and absent run IDs retain their order. */
export function conversationTurns(rows: TimelineRow[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const row of rows) {
    const last = turns.at(-1);
    if (last && row.runId && last.rows[0]?.runId === row.runId) last.rows.push(row);
    else turns.push({ id: row.id, rows: [row] });
  }
  return turns;
}
