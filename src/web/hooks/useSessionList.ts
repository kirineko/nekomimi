import { useCallback, useRef, useState } from "react";
import type { SessionPage, SessionInfo } from "../../shared/protocol";
import { api, ClientError } from "../api";

export function useSessionList() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [next, setNext] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef(30);
  const generation = useRef(0);
  const load = useCallback(async (more = false) => {
    const current = ++generation.current;
    const target = loaded.current + (more ? 30 : 0);
    setLoading(true); setError("");
    try {
      // Always rebuild the loaded window against one server revision.
      let page: SessionPage = await api("/sessions?limit=30");
      let rows = page.sessions;
      try {
        while (page.next !== undefined && rows.length < target) {
          page = await api(`/sessions?offset=${page.next}&limit=30&revision=${encodeURIComponent(page.listRevision)}`);
          if (generation.current !== current) return;
          rows = [...rows, ...page.sessions];
        }
      } catch (e) {
        if (!(e instanceof ClientError) || e.code !== "list_changed") throw e;
        page = await api("/sessions?limit=30"); rows = page.sessions;
      }
      if (generation.current !== current) return;
      setSessions([...new Map(rows.map(s => [s.id, s])).values()]);
      setNext(page.next); loaded.current = Math.max(30, rows.length);
    } catch (e) {
      if (generation.current === current) setError(String(e));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, []);
  return { sessions, setSessions, next, load, loading, error };
}
