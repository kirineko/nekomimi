import { toolContent } from "../../presentation/content";
import { useEffect, useState } from "react";
import type { EvidenceRef, TimelineRow } from "../../shared/protocol";
import { api } from "../api";
import { Markdown } from "./Markdown";
import { Artifact } from "./Artifact";
import { duration, statusText, toolTitle } from "../presentation";

interface TracePage {
  rows: TimelineRow[];
  total: number;
  next?: number;
}
export function ExecutionTrace({
  sessionId,
  row,
  revision,
  select,
}: {
  sessionId: string;
  row: TimelineRow;
  revision: number;
  select: (row: TimelineRow) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<TracePage>();
  const [error, setError] = useState("");
  useEffect(() => {
    setOffset(0);
  }, [sessionId, row.runId]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    if (!row.runId) {
      setPage({ rows: [row], total: 1 });
      return;
    }
    void api<TracePage>(
      `/sessions/${sessionId}/trace?run=${row.runId}&offset=${offset}`,
      undefined,
      abort.signal,
    )
      .then(setPage)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [sessionId, row.runId, offset, revision]);
  return (
    <section className="execution-trace" aria-label="本轮执行记录">
      <div className="trace-section-heading">
        <h3>本轮执行</h3>
        <span>
          {page
            ? `${offset + 1}–${offset + page.rows.length} / ${page.total}`
            : "加载…"}
        </span>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ol className="trace-flow">
        {page?.rows.map((step, i) => (
          <li
            key={step.id}
            className={`trace-entry trace-${step.kind} ${step.id === row.id ? "selected" : ""}`}
          >
            <span className="trace-index">{offset + i + 1}</span>
            <TraceStep
              step={step}
              sessionId={sessionId}
              selected={step.id === row.id}
              select={select}
            />
          </li>
        ))}
      </ol>
      <div className="pager">
        <button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 40))}
        >
          前 40 条
        </button>
        <button
          disabled={page?.next === undefined}
          onClick={() => setOffset(page!.next!)}
        >
          后续执行记录 →
        </button>
      </div>
    </section>
  );
}
function TraceStep({
  step,
  sessionId,
  selected,
  select,
}: {
  step: TimelineRow;
  sessionId: string;
  selected: boolean;
  select: (row: TimelineRow) => void;
}) {
  const { input, result, target } = toolContent(step.text);
  const details = step.details as Record<string, any> | undefined;
  const label =
    step.kind === "user"
      ? "你的任务"
      : step.kind === "assistant"
        ? "Nekomimi 的回答"
        : step.kind === "tool"
          ? toolTitle(step.title)
          : step.kind === "call"
            ? step.title === "会话命名" ? "会话命名" : "模型调用"
            : "本轮结束";
  return (
    <article>
      <div className="trace-entry-heading">
        <strong>{label}</strong>
        {step.status && (
          <span className={`badge ${step.status}`}>
            {statusText(step.status)}
          </span>
        )}
      </div>
      {step.kind === "call" ? (
        <>
          <div className="trace-call-meta">
            {step.text} · {duration(details?.elapsedMs)}
          </div>
          <button className="evidence-link" onClick={() => select(step)}>
            {selected ? "当前调用 · 查看输入 →" : "检查这次调用 →"}
          </button>
        </>
      ) : step.kind === "tool" ? (
        <>
          <code className="trace-target">
            {target || step.title}
          </code>
          {result ? (
            <details className="trace-output" open={step.status === "failed"}>
              <summary>
                <span>返回结果</span>
                <span className="trace-preview">{result.slice(0, 160)}</span>
              </summary>
              <pre>{result}</pre>
            </details>
          ) : (
            <p className="muted">
              {step.status === "running" ? "等待工具返回…" : "未记录工具结果"}
            </p>
          )}
          <details className="technical">
            <summary>调用参数</summary>
            <pre>{input}</pre>
          </details>
        </>
      ) : (
        <div
          className={
            step.kind === "status" && step.text ? "error" : "trace-message"
          }
        >
          {step.kind === "assistant" ? (
            <Markdown text={step.text} />
          ) : (
            step.text
          )}
        </div>
      )}
      {step.refs.length > 0 && (
        <details className="technical">
          <summary>原始证据 · {step.refs.length}</summary>
          {step.refs.map((reference, i) => (
            <TraceArtifact
              key={reference.sha256}
              sessionId={sessionId}
              reference={reference}
              index={i}
            />
          ))}
        </details>
      )}
    </article>
  );
}

function TraceArtifact({
  sessionId,
  reference,
  index,
}: {
  sessionId: string;
  reference: EvidenceRef;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>附件 {index + 1}</summary>
      {open && <Artifact sessionId={sessionId} reference={reference} />}
    </details>
  );
}
