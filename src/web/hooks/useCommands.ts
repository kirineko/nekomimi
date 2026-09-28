import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandCatalog } from "../../shared/protocol";
import { api } from "../api";
export function useCommands(connected: boolean, revision: number, open: boolean) {
  const [catalog, setCatalog] = useState<CommandCatalog>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (!connected) return;
    const current = ++request.current; setLoading(true);
    try {
      const next = await api<CommandCatalog>("/commands");
      if (current === request.current) { setCatalog(next); setError(""); }
    } catch (e) {
      if (current === request.current) { setCatalog(undefined); setError(String(e)); }
    } finally { if (current === request.current) setLoading(false); }
  }, [connected]);
  useEffect(() => { setCatalog(undefined); void refresh(); return () => { request.current++; }; }, [refresh, revision]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [open, refresh]);
  return { catalog, error, loading, refresh };
}
