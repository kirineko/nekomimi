import {RuntimeViews} from "./RuntimeViews";
import { useEffect, useRef, useState } from "react";
import { sessionTime } from "../session-time";
import { useInspectorFocus } from "../hooks/useInspectorFocus";
import { Brand } from "./Brand";
import type { SessionInfo } from "../../shared/protocol";
import { statusText } from "./Timeline";
export function Sidebar({
  loading, error, retry,
  sessions,
  selected,
  choose,
  create,
  more,
  open,
  close,
  settings,
  remove,
}: {
  loading: boolean; error: string; retry: () => void;
  sessions: SessionInfo[];
  selected?: string;
  choose: (id: string) => void;
  create: () => void;
  more?: () => void;
  open: boolean;
  close: () => void;
  settings: () => void;
  remove: (session: SessionInfo) => void;
}) {
  const [menu, setMenu] = useState<string>();
  const [timeOpen, setTimeOpen] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { setMenu(undefined); setTimeOpen(undefined); }, [selected]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const node = e.target as Element;
      if (!node.closest(".session-options")) setMenu(undefined);
      if (!node.closest(".session-time")) setTimeOpen(undefined);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (menu || timeOpen)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (menu) trigger.current?.focus();
        setMenu(undefined); setTimeOpen(undefined);
      }
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key, true); };
  }, [menu, timeOpen]);
  const panel = useInspectorFocus(close, open, true);
  return (
    <aside ref={panel} className={`sidebar ${open ? "is-open" : ""}`}>
      <div className="brand">
        <Brand />
        <button
          className="mobile-only icon"
          onClick={close}
          aria-label="关闭会话列表"
        >
          ×
        </button>
      </div>
      <button className="new-session" onClick={create}>
        <span>＋</span> 新建会话
      </button>
      <RuntimeViews slot="sidebar-widget"/>
      <div className="section-label">
        会话 <span>{sessions.length}</span>
      </div>
      <nav aria-label="会话列表" aria-busy={loading}>
        {sessions.map((session, index) => {
          const time = sessionTime(session.activityAt, now);
          const previous = index ? sessionTime(sessions[index - 1]!.activityAt, now).group : undefined;
          return <div key={session.id}>
            {time.group !== previous && <h3 className="session-group">{time.group}</h3>}
            <div className={`session-item ${selected === session.id ? "is-selected" : ""}`}>
              <button className={`session ${selected === session.id ? "selected" : ""}`} aria-current={selected === session.id ? "page" : undefined} onClick={() => { setMenu(undefined); setTimeOpen(undefined); choose(session.id); }}>
                <span className="session-title" title={session.title}>{session.title}</span>
                <span className={`session-meta status-${session.status}`}><i className={session.status === "running" ? "active-dot" : ""} />{statusText(session.status)}</span>
              </button>
              <div className="session-time">
                <button className="session-time-trigger" aria-label={`活动时间 ${session.title}：${time.full}`} aria-expanded={timeOpen === session.id} onClick={() => setTimeOpen(timeOpen === session.id ? undefined : session.id)} onBlur={e => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setTimeOpen(undefined); }}>
                  <time dateTime={time.iso}>{time.relative}</time>
                </button>
                <span className={`session-time-full ${timeOpen === session.id ? "is-visible" : ""}`}>{time.full}</span>
              </div>
              <div className="session-options">
                <button className="session-menu-trigger" aria-label={`会话操作 ${session.title}`} aria-expanded={menu === session.id} aria-haspopup="true" onClick={e => { trigger.current = e.currentTarget; setMenu(menu === session.id ? undefined : session.id); }} onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); trigger.current = e.currentTarget; setMenu(session.id); const parent = e.currentTarget.parentElement; requestAnimationFrame(() => parent?.querySelector<HTMLElement>('.session-menu button')?.focus()); } }}>•••</button>
                {menu === session.id && <div className="session-menu" role="group" aria-label="会话操作" onKeyDown={e => { if (e.key === "Tab") setMenu(undefined); }}>
                  <button aria-label={`删除会话 ${session.title}`} onClick={() => { trigger.current?.focus(); setMenu(undefined); remove(session); }}>删除会话</button>
                </div>}
              </div>
            </div>
          </div>;
        })}
        {more && <button className="session-more" disabled={loading} onClick={more}>{loading ? "加载中…" : "更多会话"}</button>}
      </nav>
      {error && <div className="session-list-error" role="alert">{error}<button onClick={retry}>重试会话列表</button></div>}
      <div className="sidebar-bottom">
        <button className="settings-entry" onClick={settings}>
          设置
        </button>
        <span className="sidebar-foot">
          <span className="green-dot" />
          本地
        </span>
      </div>
    </aside>
  );
}
