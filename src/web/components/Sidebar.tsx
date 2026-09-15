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
}: {
  sessions: SessionInfo[];
  selected?: string;
  choose: (id: string) => void;
  create: () => void;
  more?: () => void;
  open: boolean;
  close: () => void;
}) {
  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          d.
        </span>
        <strong>Deepy</strong>
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
          <button
            className={`session ${selected === session.id ? "selected" : ""}`}
            key={session.id}
            onClick={() => choose(session.id)}
          >
            <span className="session-title">{session.title}</span>
            <span className="session-meta">
              <i className={session.status === "running" ? "active-dot" : ""} />
              {statusText(session.status)}
            </span>
          </button>
        ))}
      </nav>
      {more && <button onClick={more}>更多会话</button>}
      <div className="sidebar-foot">
        <span className="green-dot" /> 本地
      </div>
    </aside>
  );
}
