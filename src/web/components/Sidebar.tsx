import { useInspectorFocus } from "../hooks/useInspectorFocus";
import { Brand } from "./Brand";
import type { SessionInfo } from "../../shared/protocol";
import { statusText } from "./Timeline";
export function Sidebar({
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
      <div className="section-label">
        会话 <span>{sessions.length}</span>
      </div>
      <nav aria-label="会话列表">
        {sessions.map((session) => (
          <div className="session-item" key={session.id}>
            <button
              className={`session ${selected === session.id ? "selected" : ""}`}
              key={session.id}
              onClick={() => choose(session.id)}
            >
              <span className="session-title">{session.title}</span>
              <span className="session-meta">
                <i
                  className={session.status === "running" ? "active-dot" : ""}
                />
                {statusText(session.status)}
              </span>
            </button>
            <details className="session-options">
              <summary aria-label={`会话操作 ${session.title}`} title="会话操作">•••</summary>
              <div className="session-menu">
                <button aria-label={`删除会话 ${session.title}`} onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  remove(session);
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
                  删除会话
                </button>
              </div>
            </details>
          </div>
        ))}
      </nav>
      {more && <button onClick={more}>更多会话</button>}
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
