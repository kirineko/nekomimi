import { useInspectorFocus } from "../hooks/useInspectorFocus";
import { useEffect, useState } from "react";
import type { EvidenceRef, TimelineRow } from "../../shared/protocol";
import { api } from "../api";
import { ExecutionTrace } from "./ExecutionTrace";
import { WireContent } from "./WireContent";
import { Markdown } from "./Markdown";
import { Artifact, references } from "./Artifact";
import { duration, eventTitle, sourceTitle, statusText } from "../presentation";
interface EventView {
  seq: number;
  type: string;
  attemptId?: string;
  payload: Record<string, any>;
}
const tabs = [
  { id: "Usage", label: "总览" },
  { id: "Prompt", label: "指令" },
  { id: "Context", label: "输入" },
  { id: "Request", label: "请求" },
  { id: "Response", label: "响应" },
];
export function Inspector({
  sessionId,
  row,
  close,
  responseText,
  revision,
  select,
}: {
  sessionId: string;
  row: TimelineRow;
  close: () => void;
  responseText?: string;
  revision: number;
  select: (row: TimelineRow) => void;
}) {
  const panel = useInspectorFocus(close);
  const [tab, setTab] = useState("Usage");
  const [events, setEvents] = useState<EventView[]>([]);
  const [ref, setRef] = useState<EvidenceRef>();
  const [error, setError] = useState("");
  const [context, setContext] = useState<any>();
  const [offset, setOffset] = useState(0);
  const [next, setNext] = useState<number>();
  const [source, setSource] = useState<number>();
  useEffect(() => {
    setOffset(0);
    setSource(undefined);
    setRef(undefined);
  }, [row.id, tab]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setRef(undefined);
    setEvents([]);
    setContext(undefined);
    const query = source
      ? `seq=${source}`
      : row.modelCallId
        ? `call=${row.modelCallId}&group=${tab}&offset=${offset}`
        : `seq=${row.seq}`;
    void api<{ events: EventView[]; next?: number }>(
      `/sessions/${sessionId}/evidence?${query}`,
      undefined,
      abort.signal,
    )
      .then((data) => {
        setEvents(data.events);
        setNext(data.next);
        if (["Prompt", "Context", "Request"].includes(tab))
          setRef(data.events.flatMap((e) => references(e.payload))[0]);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    if (!source && row.modelCallId && ["Prompt", "Context"].includes(tab))
      void api(
        `/sessions/${sessionId}/context?call=${row.modelCallId}&offset=${offset}`,
        undefined,
        abort.signal,
      )
        .then(setContext)
        .catch((e) => {
          if (!abort.signal.aborted) setError(String(e));
        });
    return () => abort.abort();
  }, [sessionId, row.id, row.modelCallId, row.seq, tab, offset, source]);
  const sourceView = source && events[0];
  return (
    <aside className="inspector" ref={panel} aria-label="执行追踪">
      <header>
        <div>
          <span className="trace-kicker">Nekomimi</span>
          <h2>执行追踪</h2>
        </div>
        <button className="icon" onClick={close} aria-label="关闭检查面板">
          ×
        </button>
      </header>
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {source && (
          <button className="back-link" onClick={() => setSource(undefined)}>
            ← 返回调用
          </button>
        )}
        {tab === "Usage" && !source && (
          <>
            <ExecutionTrace
              sessionId={sessionId}
              row={row}
              revision={revision}
              select={(step) => {
                select(step);
                setTab("Context");
              }}
            />
            <details className="trace-statistics">
              <summary>当前调用 · 耗时与用量</summary>
              <div className="trace-status">
                <span className={`step-dot ${row.status}`} />
                <strong>{statusText(row.status)}</strong>
              </div>
              {events.length === 0 && <p className="muted">等待响应…</p>}
              {events.map((e, i) => (
                <section className="attempt-card" key={e.seq}>
                  <div className="attempt-heading">
                    <span>响应 {i + 1}</span>
                    <span className={`badge ${e.payload.status}`}>
                      {statusText(e.payload.status)}
                    </span>
                  </div>
                  <div className="metrics">
                    <div>
                      <span>总耗时</span>
                      <strong>{duration(e.payload.elapsedMs)}</strong>
                    </div>
                    <div>
                      <span>首次响应</span>
                      <strong>{duration(e.payload.firstByteMs)}</strong>
                    </div>
                    <div>
                      <span>输入 tokens</span>
                      <strong>
                        {e.payload.usage?.input_tokens?.toLocaleString() ?? "—"}
                      </strong>
                    </div>
                    <div>
                      <span>输出 tokens</span>
                      <strong>
                        {e.payload.usage?.output_tokens?.toLocaleString() ??
                          "—"}
                      </strong>
                    </div>
                  </div>
                  <div className="metric-foot">
                    <span>缓存用量</span>
                    <span>
                      {e.payload.usage?.input_tokens_details?.cached_tokens?.toLocaleString() ??
                        "—"}
                    </span>
                  </div>
                  {e.payload.error && (
                    <p className="error">{e.payload.error}</p>
                  )}
                  <details className="technical">
                    <summary>技术详情</summary>
                    <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                  </details>
                </section>
              ))}
            </details>
          </>
        )}
        {context && !source && (
          <section>
            {tab === "Prompt" ? (
              context.fragments.map((fragment: any, i: number) => (
                <details className="source-card" key={i}>
                  <summary>{sourceTitle(fragment.source)}</summary>
                  <div className="instruction-text">{fragment.text}</div>
                </details>
              ))
            ) : (
              <div className="sources">
                {context.nodes.map((n: any, i: number) => (
                  <article
                    className="context-message"
                    key={`${n.eventId}:${n.itemIndex}`}
                  >
                    <button onClick={() => setSource(n.seq)}>
                      <span className="source-number">{offset + i + 1}</span>
                      <span>{sourceTitle(n.source)}</span>
                      <span>来源 ↗</span>
                    </button>
                    <WireContent value={n.item} />
                  </article>
                ))}
              </div>
            )}
            {context.next !== undefined && (
              <button
                className="evidence-link"
                onClick={() => setOffset(context.next)}
              >
                后续输入来源 →
              </button>
            )}
          </section>
        )}
        {sourceView && (
          <section className="source-card">
            <h3>{sourceTitle(sourceView.payload.source ?? sourceView.type)}</h3>
            <WireContent
              value={
                sourceView.payload.item ??
                sourceView.payload.items ??
                sourceView.payload
              }
            />
          </section>
        )}
        {tab === "Request" &&
          !source &&
          events.map((e) => (
            <section className="request-summary" key={e.seq}>
              <span className="request-method">POST</span>
              <span>
                {e.payload.url ? new URL(e.payload.url).pathname : "/responses"}
              </span>
              <details className="technical">
                <summary>技术详情</summary>
                <pre>{JSON.stringify(e.payload, null, 2)}</pre>
              </details>
            </section>
          ))}
        {tab === "Response" && !source && (
          <div className="response-events">
            {responseText && <Markdown text={responseText} />}
            <details className="technical">
              <summary>原始响应记录</summary>
              {events.map((e) => (
                <details key={e.seq}>
                  <summary>
                    <span>{eventTitle(e.type)}</span>
                    <span className="muted">{e.payload.status ?? ""}</span>
                  </summary>
                  <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                  {references(e.payload).map((r, i) => (
                    <button
                      key={i}
                      className="evidence-link"
                      onClick={() => setRef(r)}
                    >
                      完整内容 ↗
                    </button>
                  ))}
                </details>
              ))}
            </details>
          </div>
        )}
        {!["Usage", "Response", "Request"].includes(tab) &&
          events.length > 0 && (
            <details className="technical">
              <summary>原始记录</summary>
              {events.map((e) => (
                <pre key={e.seq}>{JSON.stringify(e, null, 2)}</pre>
              ))}
            </details>
          )}
        {next !== undefined && (
          <button className="evidence-link" onClick={() => setOffset(next)}>
            后续证据 →
          </button>
        )}
        {offset > 0 && (
          <button className="evidence-link" onClick={() => setOffset(0)}>
            返回首组
          </button>
        )}
        {ref && (
          <details
            className="raw-evidence"
            key={`${tab}:${ref.sha256}`}
            open={tab === "Response"}
          >
            <summary>{tab === "Request" ? "原始请求" : "完整原文"}</summary>
            <Artifact sessionId={sessionId} reference={ref} />
          </details>
        )}
      </div>
    </aside>
  );
}
