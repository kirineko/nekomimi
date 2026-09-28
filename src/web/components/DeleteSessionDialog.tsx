import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "../../shared/protocol";
import { api } from "../api";

export function DeleteSessionDialog({ session, close, removed }: {
  session: SessionInfo; close: () => void; removed: (id: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(session);
  const onClose = useRef(close); onClose.current = close;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const backdrop = root.current!.parentElement!;
    const siblings = [...backdrop.parentElement!.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n !== backdrop);
    const inert = siblings.map(n => n.inert);
    siblings.forEach(n => { n.inert = true; });
    cancel.current?.focus();
    const items = () => [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(n => n.getClientRects().length);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (!busyRef.current) onClose.current(); }
      if (e.key === "Tab") {
        e.preventDefault();
        const all = items(); const index = all.indexOf(document.activeElement as HTMLElement);
        (all[(index + (e.shiftKey ? -1 : 1) + all.length) % all.length] ?? root.current)?.focus();
      }
    };
    const focus = (e: FocusEvent) => { if (!root.current?.contains(e.target as Node)) (items()[0] ?? root.current)?.focus(); };
    document.addEventListener("keydown", key, true); document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("keydown", key, true); document.removeEventListener("focusin", focus);
      siblings.forEach((n, i) => { n.inert = inert[i]!; });
      queueMicrotask(() => (opener?.isConnected ? opener : document.querySelector<HTMLElement>(".new-session"))?.focus());
    };
  }, []);
  const act = async (remove: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (remove) { await api(`/sessions/${session.id}/delete`, {}); removed(session.id); }
      else {
        await api(`/sessions/${session.id}/cancel`, { version: 1, runId: target.runId });
        const value = await api<{ session: SessionInfo }>(`/sessions/${session.id}/snapshot`);
        setTarget(value.session);
      }
    } catch (e) { setError(String(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <div className="modal-backdrop delete-backdrop" onClick={e => { if (e.target === e.currentTarget && !busyRef.current) close(); }}>
    <section ref={root} tabIndex={-1} className="settings-panel confirm-dialog" role="dialog" aria-modal="true" aria-label="删除会话" aria-busy={busy}>
      <header><h2>删除 {session.title}？</h2><button aria-label="关闭删除确认" disabled={busy} onClick={close}>×</button></header>
      <p>删除会话记录与附件，保留工作区文件。</p>
      {error && <p role="alert" className="error">{error}</p>}
      {busy && <p role="status">正在处理…</p>}
      <div className="confirm-actions">
        <button ref={cancel} className="ghost" disabled={busy} onClick={close}>保留会话</button>
        <button className="danger" disabled={busy} onClick={() => void act(true)}>确认删除</button>
        {(["running", "cancelling"].includes(target.status) || target.naming) && <button disabled={busy} onClick={() => void act(false)}>停止运行</button>}
      </div>
    </section>
  </div>;
}
