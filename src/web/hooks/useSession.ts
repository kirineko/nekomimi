import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot, TimelineRow } from "../../shared/protocol";
import { api, ClientError, stream } from "../api";
export function useSession(sessionId: string | undefined) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const abort = new AbortController();
    setSnapshot(undefined);
    setError("");
    if (!sessionId) {
      setConnection("connected");
      return () => abort.abort();
    }
    let network = new AbortController();
    const offline = () => {
      network.abort();
      setConnection("disconnected");
    };
    window.addEventListener("offline", offline);
    void (async () => {
      let cursor: Snapshot["cursor"] | undefined;
      while (!abort.signal.aborted) {
        try {
          if (!navigator.onLine) throw new Error("网络已断开");
          network = new AbortController();
          const signal = AbortSignal.any([abort.signal, network.signal]);
          setConnection("connecting");
          if (!cursor) {
            const initial = await api<Snapshot>(
              `/sessions/${sessionId}/snapshot`,
              undefined,
              signal,
            );
            if (abort.signal.aborted) return;
            cursor = initial.cursor;
            setSnapshot(initial);
          }
          setConnection("connected");
          setError("");
          await stream(sessionId, cursor, signal, (update) => {
            if (abort.signal.aborted || generation.current !== current) return;
            cursor = update.cursor;
            setSnapshot((previous) => {
              if (!previous || update.cursor.seq < previous.cursor.seq)
                return previous;
              const rows = new Map(previous.rows.map((r) => [r.id, r]));
              for (const row of update.rows) rows.set(row.id, row);
              const list = [...rows.values()];
              const overflow = Math.max(0, list.length - 180);
              return {
                ...previous,
                session: update.session,
                cursor: update.cursor,
                rows: list.slice(overflow),
                before: overflow
                  ? (previous.before ?? 0) + overflow
                  : previous.before,
              };
            });
          });
          setConnection("disconnected");
        } catch (e) {
          if (abort.signal.aborted) return;
          if (e instanceof ClientError && ["deleted","not_found"].includes(e.code)) { setSnapshot(undefined); setConnection("deleted"); setError("会话已删除"); return; }
          if (e instanceof ClientError && e.code === "auth") {
            setError(e.message);
            setConnection("unauthorized");
            return;
          }
          if (e instanceof ClientError && e.code === "reset")
            cursor = undefined;
          else if (navigator.onLine) setError(String(e));
          setConnection("disconnected");
        }
        await new Promise<void>((r) => {
          const stop = () => {
            clearTimeout(timer);
            r();
          };
          const timer = setTimeout(() => {
            abort.signal.removeEventListener("abort", stop);
            r();
          }, 1000);
          abort.signal.addEventListener("abort", stop, { once: true });
        });
      }
    })();
    return () => {
      abort.abort();
      window.removeEventListener("offline", offline);
    };
  }, [sessionId]);
  const older = useCallback(async () => {
    if (!sessionId || !snapshot?.before) return;
    const current = generation.current;
    const page = await api<Snapshot>(
      `/sessions/${sessionId}/snapshot?before=${snapshot.before}`,
    );
    if (generation.current !== current) return;
    setSnapshot((previous) =>
      previous
        ? {
            ...previous,
            before: page.before,
            rows: [...page.rows, ...previous.rows].slice(0, 180),
          }
        : previous,
    );
  }, [sessionId, snapshot?.before]);
  const latest = useCallback(async () => {
    if (!sessionId) return;
    const current = generation.current;
    const page = await api<Snapshot>(`/sessions/${sessionId}/snapshot`);
    if (current === generation.current) setSnapshot(page);
  }, [sessionId]);
  return { snapshot, connection, error, older, latest };
}
