import { useCallback, useEffect, useRef, useState } from "react";
import type { Receipt, SessionInfo, TimelineRow } from "../shared/protocol";
import { api, connect, request } from "./api";
import { useSession } from "./hooks/useSession";
import { Sidebar } from "./components/Sidebar";
import { Timeline, statusText } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { Settings } from "./components/Settings";
import { Composer } from "./components/Composer";
export function App() {
  const [config, setConfig] = useState<{
    workspace: string;
    configured: boolean;
  }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState<SessionInfo>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [next, setNext] = useState<number>();
  const [selected, setSelected] = useState<string | undefined>(
    new URLSearchParams(location.search).get("session") ?? undefined,
  );
  const conversation = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const [inspection, setInspection] = useState<TimelineRow>();
  const [sidebar, setSidebar] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [redact, setRedact] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [creating, setCreating] = useState(false);
  const pending = useRef<{ text: string; id: string } | undefined>(undefined);
  const {
    snapshot,
    connection,
    error: streamError,
    older,
    latest,
  } = useSession(config ? selected : undefined);
  const load = useCallback(async (offset = 0) => {
    const data = await api<{ sessions: SessionInfo[]; next?: number }>(
      `/sessions?offset=${offset}`,
    );
    setSessions((old) =>
      offset
        ? [
            ...old,
            ...data.sessions.filter((s) => !old.some((o) => o.id === s.id)),
          ]
        : data.sessions,
    );
    setNext(data.next);
  }, []);
  useEffect(() => {
    void connect()
      .then((value) => {
        setConfig(value);
        return load();
      })
      .catch((e) => setError(String(e)));
  }, [load]);
  useEffect(() => {
    if (snapshot)
      setSessions((old) =>
        old.map((s) => (s.id === snapshot.session.id ? snapshot.session : s)),
      );
  }, [snapshot?.session.status, snapshot?.session.id, snapshot?.session.title]);
  useEffect(() => {
    if (follow.current && conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [snapshot?.cursor.seq]);
  const clearSelection = () => {
    setSelected(undefined);
    setInspection(undefined);
    pending.current = undefined;
    history.replaceState(null, "", location.pathname);
  };
  useEffect(() => {
    if (connection === "deleted") {
      clearSelection();
      void load();
    }
  }, [connection, load]);
  const refreshConfig = async () => {
    setConfig(await api("/config"));
    await load();
  };
  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/sessions/${deleting.id}/delete`, {});
      if (selected === deleting.id) clearSelection();
      setDeleting(undefined);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  };
  const choose = (id: string) => {
    follow.current = true;
    setSelected(id);
    setInspection(undefined);
    setSidebar(false);
    pending.current = undefined;
    history.replaceState(null, "", `?session=${id}`);
  };
  const create = async () => {
    setCreating(true);
    try {
      const session = await api<SessionInfo>("/sessions", {
        version: 1,
        title: "新会话",
      });
      setSessions((old) => [session, ...old]);
      choose(session.id);
      return session.id;
    } finally {
      setCreating(false);
    }
  };
  const submit = async (text: string) => {
    const sessionId = selected ?? (await create());
    if (!pending.current || pending.current.text !== text)
      pending.current = { text, id: crypto.randomUUID() };
    await api<Receipt>(`/sessions/${sessionId}/submit`, {
      version: 1,
      commandId: pending.current.id,
      prompt: text,
    });
    pending.current = undefined;
  };
  const busy = ["running", "cancelling"].includes(
    snapshot?.session.status ?? "",
  );
  const cancel = async () => {
    if (snapshot?.session.runId && selected)
      await api(`/sessions/${selected}/cancel`, {
        version: 1,
        runId: snapshot.session.runId,
      });
  };
  const download = async (format: string) => {
    if (!selected) return;
    setDownloading(true);
    setError("");
    try {
      const response = await request(`/sessions/${selected}/export`, {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          format,
          redact: redact.split("\n").filter(Boolean),
        }),
      });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "html" ? "session.html" : "session.tar";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className={`app ${inspection ? "with-inspector" : ""}`}>
      {settingsOpen && (
        <Settings
          close={() => setSettingsOpen(false)}
          changed={refreshConfig}
        />
      )}
      {deleting && (
        <div className="modal-backdrop">
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="删除会话"
          >
            <h2>删除 {deleting.title}？</h2>
            <p>删除会话记录与附件，保留工作区文件。</p>
            {error && <p role="alert">{error}</p>}
            <button
              disabled={deleteBusy}
              onClick={() => setDeleting(undefined)}
            >
              保留会话
            </button>
            <button disabled={deleteBusy} onClick={() => void remove()}>
              确认删除
            </button>
            {(deleting.status === "running" || deleting.naming) && (
              <button
                onClick={() =>
                  void api(`/sessions/${deleting.id}/cancel`, {
                    version: 1,
                    runId: deleting.runId,
                  })
                    .then(() => load())
                    .catch((e) => setError(String(e)))
                }
              >
                停止运行
              </button>
            )}
          </section>
        </div>
      )}
      <Sidebar
        settings={() => setSettingsOpen(true)}
        remove={(s) => {
          setError("");
          setDeleting(s);
        }}
        sessions={sessions}
        selected={selected}
        choose={choose}
        create={() => {
          void create().catch((e) => setError(String(e)));
        }}
        more={
          next !== undefined
            ? () => {
                void load(next).catch((e) => setError(String(e)));
              }
            : undefined
        }
        open={sidebar}
        close={() => setSidebar(false)}
      />
      <main className="workbench">
        <header className="topbar">
          <button
            className="mobile-only icon"
            onClick={() => setSidebar(true)}
            aria-label="打开会话列表"
          >
            ☰
          </button>
          <div>
            <div className="workspace-name">
              {config?.workspace.split("/").at(-1) ?? "连接本地服务…"}
            </div>
          </div>
          <div className="topbar-actions">
            <span className={`connection ${connection}`}>
              {connection === "connected"
                ? "● 已连接"
                : connection === "connecting"
                  ? "连接中"
                  : "连接已断开"}
            </span>
            <button
              disabled={!selected || busy}
              onClick={() => setExportOpen(!exportOpen)}
            >
              导出 ↗
            </button>
          </div>
        </header>
        {(error || streamError) && (
          <div className="error banner" role="alert">
            {error || streamError}
          </div>
        )}
        {exportOpen && (
          <section className="export-panel">
            <strong>离线导出</strong>
            <label>
              需要脱敏的文本（每行一项）
              <textarea
                value={redact}
                onChange={(e) => setRedact(e.target.value)}
              />
            </label>
            <p>脱敏包不可继续会话。</p>
            <button
              disabled={downloading || busy}
              onClick={() => {
                void download("html");
              }}
            >
              下载 HTML
            </button>
            <button
              disabled={downloading || busy}
              onClick={() => {
                void download("bundle");
              }}
            >
              下载诊断包
            </button>
          </section>
        )}
        <section
          className="conversation"
          ref={conversation}
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          <div className="conversation-heading">
            <h1>{snapshot?.session.title ?? "今天想做什么？"}</h1>
            <p>
              {snapshot ? (
                <>
                  <span className={`badge ${snapshot.session.status}`}>
                    {statusText(snapshot.session.status)}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          {snapshot && selected ? (
            <Timeline
              sessionId={selected}
              rows={snapshot.rows}
              inspect={setInspection}
              older={() => {
                void older().catch((e) => setError(String(e)));
              }}
              latest={() => {
                follow.current = true;
                void latest().catch((e) => setError(String(e)));
              }}
              hasOlder={!!snapshot.before}
            />
          ) : (
            <div className="welcome-symbol" aria-hidden="true">
              ✳
            </div>
          )}
        </section>
        <Composer
          key={selected ?? "new"}
          busy={busy}
          configured={!!config?.configured && !creating}
          submit={submit}
          cancel={cancel}
        />
      </main>
      {inspection && selected && (
        <Inspector
          sessionId={selected}
          row={
            snapshot?.rows.find((row) => row.id === inspection.id) ?? inspection
          }
          responseText={
            snapshot?.rows.find(
              (row) =>
                row.attemptId === inspection.attemptId &&
                row.kind === "assistant",
            )?.text
          }
          revision={snapshot?.cursor.seq ?? 0}
          select={setInspection}
          close={() => setInspection(undefined)}
        />
      )}
    </div>
  );
}
