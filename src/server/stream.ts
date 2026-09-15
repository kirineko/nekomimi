import { ApiError } from "../shared/protocol.js";
import type { ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Sessions } from "./sessions.js";
/** Slow clients are reset/disconnected. Replay always comes from durable history, never this socket. */
export async function subscribe(
  res: ServerResponse,
  sessions: Sessions,
  sessionId: string,
  seq: number,
  hash: string,
  signal: AbortSignal,
) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  let lastStatus = "";
  let heartbeats = 0;
  const send = (event: string, value: unknown, id?: number) => {
    const message = `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    if (
      Buffer.byteLength(message) > 2 * 1024 * 1024 ||
      res.writableLength > 2 * 1024 * 1024
    ) {
      res.destroy();
      return false;
    }
    if (!res.write(message)) {
      res.end();
      return false;
    }
    return true;
  };
  try {
    while (!closed && !signal.aborted) {
      const entry = await sessions.entry(sessionId);
      if (!entry.reader.matches(seq, hash)) {
        send("reset", { reason: "游标已失效，请重新加载会话" });
        break;
      }
      const cursor = entry.reader.cursor;
      const session = sessions.info(sessionId, entry);
      if (cursor.seq !== seq || session.status !== lastStatus) {
        const rows = [...entry.projection.rows.values()].filter(
          (r) => r.seq > seq,
        );
        if (rows.length > 200) {
          send("reset", { reason: "需要重新加载快照" });
          break;
        }
        if (!send("update", { version: 1, cursor, session, rows }, cursor.seq))
          break;
        seq = cursor.seq;
        hash = cursor.hash;
        lastStatus = session.status;
      }
      if (++heartbeats % 40 === 0 && !send("heartbeat", {})) break;
      await delay(250, undefined, { signal });
    }
  } catch (error) {
    if (!signal.aborted && !closed)
      send(error instanceof ApiError && error.status===404 ? "deleted" : "stream-error", { message: error instanceof ApiError ? error.message : "读取会话失败" });
  } finally {
    res.end();
  }
}
