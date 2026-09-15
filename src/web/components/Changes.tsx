import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DiffView } from "./DiffView";
interface Change {
  id: string;
  seq: number;
  runId?: string;
  path: string;
  patch?: { sha256: string };
}
export function Changes({
  sessionId,
  revision,
  locate,
}: {
  sessionId?: string;
  revision: number;
  locate: (path: string) => void;
}) {
  // A session switch owns a fresh state and cancels all of its old requests.
  return sessionId ? (
    <SessionChanges key={sessionId} sessionId={sessionId} revision={revision} locate={locate} />
  ) : (
    <p className="panel-empty">暂无已确认的文件修改</p>
  );
}
interface ChangePage {
  changes: Change[];
  nextBefore?: number;
}
function SessionChanges({ sessionId, revision, locate }: {
  sessionId: string;
  revision: number;
  locate: (path: string) => void;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [next, setNext] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const newest = useRef<number | undefined>(undefined);
  const olderRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => olderRequest.current?.abort(), []);
  const merge = useCallback((incoming: Change[]) => {
    if (!incoming.length) return;
    setChanges(old =>
      [...new Map([...old, ...incoming].map(c => [c.id, c])).values()]
        .sort((a, b) => b.seq - a.seq));
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const after = newest.current;
    setError("");
    void (async () => {
      try {
        const incoming: Change[] = [];
        let before: number | undefined;
        let page: ChangePage;
        do {
          page = await api<ChangePage>(
            `/sessions/${sessionId}/changes?after=${after ?? 0}${before === undefined ? "" : `&before=${before}`}`,
            undefined, abort.signal,
          );
          if (abort.signal.aborted) return;
          incoming.push(...page.changes);
          before = page.nextBefore;
          // Initial load is one page. Refresh catches up all new records,
          // even when more than a page arrived between revisions.
        } while (after !== undefined && before !== undefined);
        merge(incoming);
        newest.current = Math.max(after ?? 0, incoming[0]?.seq ?? 0);
        if (after === undefined) setNext(page.nextBefore);
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      }
    })();
    return () => abort.abort();
  }, [sessionId, revision, merge]);
  const loadOlder = async () => {
    if (next === undefined || olderRequest.current) return;
    const abort = new AbortController();
    olderRequest.current = abort;
    setLoading(true);
    setError("");
    try {
      const page = await api<ChangePage>(`/sessions/${sessionId}/changes?before=${next}`, undefined, abort.signal);
      if (abort.signal.aborted) return;
      merge(page.changes);
      setNext(page.nextBefore);
    } catch (e) {
      if (!abort.signal.aborted) setError(String(e));
    } finally {
      if (!abort.signal.aborted) {
        olderRequest.current = undefined;
        setLoading(false);
      }
    }
  };
  return (
    <section className="changes-list">
      <p className="panel-muted">本会话 edit/write 的逐次修改</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!changes.length && <p className="panel-empty">暂无已确认的文件修改</p>}
      {changes.map((c) => (
        <article key={c.id}>
          <p className="panel-muted">
            记录 {c.seq} · 轮次 {c.runId?.slice(0, 8) ?? "未知"}
          </p>
          {c.patch && sessionId ? (
            <DiffView
              sessionId={sessionId}
              digest={c.patch.sha256}
              path={c.path}
              locate={locate}
            />
          ) : (
            <p>历史 diff 证据不可用</p>
          )}
        </article>
      ))}
      {next !== undefined && (
        <button disabled={loading} onClick={() => void loadOlder()}>{loading ? "加载中…" : "更早的修改"}</button>
      )}
    </section>
  );
}
