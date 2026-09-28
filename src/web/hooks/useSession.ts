import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot, TimelineRow } from "../../shared/protocol";
import { api, ClientError, stream } from "../api";
export function useSession(sessionId: string | undefined) {
  const [liveRows,setLiveRows]=useState<Set<string>>(new Set());
  const replayFloor = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const generation = useRef(0), navigation = useRef(0), loading = useRef(false);
  const history = useRef(false), unseen = useRef(false), tailWindow=useRef(true);
  const loadingDirection = useRef<string|undefined>(undefined);
  const [navigationError,setNavigationError]=useState<{direction:string;message:string}>();
  const [historyMode, setHistoryMode] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [paging, setPaging] = useState(false);
  const [scrollRevision, setScrollRevision] = useState(0);
  const currentSnapshot = useRef(snapshot); currentSnapshot.current = snapshot;
  useEffect(() => {
    const current = ++generation.current;
    navigation.current++; loading.current = false; loadingDirection.current=undefined; setPaging(false);setNavigationError(undefined);
    history.current = false; unseen.current=false;tailWindow.current=true; setHistoryMode(false); setHasNew(false);
    const abort = new AbortController();
    setSnapshot(undefined);setLiveRows(new Set());
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
            cursor = initial.cursor;replayFloor.current=initial.cursor.seq;setLiveRows(new Set());
            if(!history.current)tailWindow.current=initial.after===undefined;
            else if(currentSnapshot.current && initial.cursor.seq>currentSnapshot.current.cursor.seq && initial.rows.some(row=>!currentSnapshot.current?.rows.some(old=>JSON.stringify(old)===JSON.stringify(row)))){unseen.current=true;setHasNew(true);}
            setSnapshot(previous => history.current && previous ? { ...previous, session: initial.session, cursor: initial.cursor, totalRows: initial.totalRows } : initial);
          }
          setConnection("connected");
          setError("");
          await stream(sessionId, cursor, signal, (update) => {
            if (abort.signal.aborted || generation.current !== current) return;
            const previousCursor=cursor;
            cursor = update.cursor;
            if (!history.current && !loading.current) setLiveRows(old=>new Set([...old,...update.rows.filter(r=>r.seq>Math.max(previousCursor?.seq??Infinity,replayFloor.current)).map(r=>r.id)].slice(-180)));
            const changed = update.rows.some(row => {const old=currentSnapshot.current?.rows.find(r=>r.id===row.id);return !old || JSON.stringify(old)!==JSON.stringify(row);});
            if (history.current && changed) {unseen.current=true;setHasNew(true);}
            setSnapshot((previous) => {
              if (!previous || update.cursor.seq < previous.cursor.seq)
                return previous;
              if (history.current) return { ...previous, session: update.session, cursor: update.cursor, after: changed ? previous.after ?? previous.totalRows : previous.after };
              const rows = new Map(previous.rows.map((r) => [r.id, r]));
              const added=update.rows.filter(row=>!rows.has(row.id)).length;
              for (const row of update.rows) rows.set(row.id, row);
              const list = [...rows.values()];
              const overflow = Math.max(0, list.length - 180);
              return {
                ...previous,
                session: update.session,
                cursor: update.cursor,
                rows: list.slice(overflow),
                totalRows:previous.totalRows+added,
                before: overflow
                  ? (previous.before ?? 0) + overflow
                  : previous.before,
              };
            });
          });
          cursor=undefined;setLiveRows(new Set());
          setConnection("disconnected");
        } catch (e) {
          if (abort.signal.aborted) return;
          cursor=undefined;setLiveRows(new Set());
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
  const pageWindow = useCallback(async (direction: 'older' | 'newer' | 'latest') => {
    const previous = currentSnapshot.current;
    if (!sessionId || !previous || (loading.current && (direction !== "latest" || loadingDirection.current === "latest"))) return;
    const boundary = direction === 'older' ? previous.before : previous.after;
    if (direction !== 'latest' && boundary === undefined) return;
    const current = generation.current, request = ++navigation.current;
    setLiveRows(new Set());
    loading.current = true; loadingDirection.current=direction; setPaging(true);setNavigationError(undefined);
    if(direction!=="latest"){history.current=true;setHistoryMode(true);}
    try {
      const query = direction === 'latest' ? '' : `?${direction === 'older' ? 'before' : 'after'}=${boundary}`;
      const page = await api<Snapshot>(`/sessions/${sessionId}/snapshot${query}`);
      if (generation.current !== current || navigation.current !== request) return;
      replayFloor.current=Math.max(replayFloor.current,page.cursor.seq);
      setLiveRows(new Set());
      history.current = direction !== 'latest'; setHistoryMode(history.current);
      if (direction === 'latest') { tailWindow.current=true;setSnapshot(page); unseen.current=false; setHasNew(false); setScrollRevision(n => n + 1); }
      else setSnapshot(old => {
        if (!old) return page;
        const merged = direction === 'older' ? [...page.rows, ...old.rows] : [...old.rows, ...page.rows];
        const unique = [...new Map(merged.map(row => [row.id, row])).values()];
        const rows = direction === 'older' ? unique.slice(0, 180) : unique.slice(-180);
        const start = direction === 'older' ? (page.before ?? 0) : (page.after ?? page.totalRows) - rows.length;
        const end = start + rows.length;
        tailWindow.current=end>=page.totalRows;
        return { ...old, rows, before: start || undefined, after: end < page.totalRows ? end : undefined, totalRows: page.totalRows };
      });
    } catch (error) {
      if (generation.current === current && navigation.current === request) setNavigationError({direction,message:"暂时无法加载，请重试。"});
    } finally {
      if (generation.current === current && navigation.current === request) { loading.current = false; loadingDirection.current=undefined; setPaging(false); }
    }
  }, [sessionId]);
  const older = useCallback(() => pageWindow('older'), [pageWindow]);
  const newer = useCallback(() => pageWindow('newer'), [pageWindow]);
  const latest = useCallback(() => pageWindow('latest'), [pageWindow]);
  const browse = useCallback(() => { history.current = true; setHistoryMode(true); }, []);
  const reachBottom = useCallback(() => {
    if(!history.current || loading.current || !tailWindow.current)return;
    if(unseen.current)void latest();
    else {history.current=false;setHistoryMode(false);setHasNew(false);}
  },[latest]);
  return { reachBottom,navigationError,loadingDirection:loadingDirection.current,browse, snapshot, liveRows, connection, error, older, newer, latest, historyMode, hasNew, paging, scrollRevision };
}
