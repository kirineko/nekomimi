import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { SessionMode } from "../../../shared/protocol.js";
import { v2Host, v2Key } from "./query.js";

/**
 * SSE 驱动的查询失效：会话快照 seq 前进时，使该会话的交接查询失效，
 * 让交接/交付卡与确认状态自动更新（取代常驻“刷新”按钮）。
 *
 * handoff.* 事件不进入时间线投影（projection/session.ts 只投影固定类型），
 * 因此按 seq 前进触发；同一会话的连续事件合并为 300ms 内一次只读刷新。
 * 失效只会触发 GET，不产生写入，也不改变 Journal。
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function invalidateHandoffQueries(client: QueryClient, sessionId: string, mode: SessionMode) {
  const key = `${mode}:${sessionId}`;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void client.invalidateQueries({ queryKey: v2Key(v2Host(), mode, "handoff", sessionId) });
    }, 300),
  );
}

/** 在 SessionStreamProvider 中挂载。首次快照只记录游标；之后 seq 前进才失效。 */
export function useStreamHandoffInvalidation(
  sessionId: string | undefined,
  mode: SessionMode,
  seq: number | undefined,
) {
  const client = useQueryClient();
  const seen = useRef<{ sessionId?: string; seq?: number }>({});
  useEffect(() => {
    if (!sessionId || seq === undefined) return;
    const last = seen.current;
    seen.current = { sessionId, seq };
    if (last.sessionId !== sessionId || last.seq === undefined) return; // 新会话/首次快照
    if (seq > last.seq) invalidateHandoffQueries(client, sessionId, mode);
  }, [client, sessionId, mode, seq]);
}
