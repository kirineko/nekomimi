import type { Snapshot, Update } from "../../shared/protocol.js";
/**
 * SSE 会话投影 reducer（批次 4 · 9.4）：
 * - 先取快照再订阅，快照与订阅之间的事件由服务端 cursor(hash 链)保证不丢；
 * - update.cursor.seq 小于当前值的迟到数据直接丢弃（重复 cursor 去重）；
 * - 服务端 reset / hash 不匹配 → 显式回到快照重载，不在本地猜测拼接；
 * - 断线按既有 cursor 重连，重连与多窗口不产生任何写命令（本模块只读）。
 */
export type StreamStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "deleted"
  | "unauthorized";

export interface StreamState {
  status: StreamStatus;
  snapshot?: Snapshot;
  error?: string;
}

type Action =
  | { type: "status"; status: StreamStatus; error?: string }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "update"; update: Update }
  | { type: "reset" };

const initial: StreamState = { status: "connecting" };

export function reduce(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status, error: action.error };
    case "snapshot":
      return { status: "connected", snapshot: action.snapshot };
    case "update": {
      const previous = state.snapshot;
      if (!previous) return state;
      if (action.update.cursor.seq < previous.cursor.seq) return state;
      const rows = new Map(previous.rows.map((row) => [row.id, row]));
      for (const row of action.update.rows) rows.set(row.id, row);
      return {
        status: state.status === "connecting" ? "connected" : state.status,
        snapshot: {
          ...previous,
          context: action.update.context,
          compacting: action.update.compacting,
          session: action.update.session,
          cursor: action.update.cursor,
          rows: [...rows.values()],
        },
      };
    }
    case "reset":
      return initial;
  }
}

