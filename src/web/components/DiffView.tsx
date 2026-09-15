import { TokenSpans } from "../../presentation/syntax/view";
import { useEffect, useState } from "react";
import type { DiffPage } from "../../presentation/diff";
import { api } from "../api";
export function DiffView({
  sessionId,
  digest,
  path,
  locate,
  embedded = false,
}: {
  sessionId: string;
  digest: string;
  path?: string;
  locate?: (path: string) => void;
  embedded?: boolean;
}) {
  const [page, setPage] = useState<DiffPage>();
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setOffset(0);
    setExpanded(false);
  }, [digest, sessionId]);
  useEffect(() => {
    const abort = new AbortController();
    setPage(undefined);
    setError("");
    void api<DiffPage>(
      `/sessions/${sessionId}/diff/${digest}?offset=${offset}&limit=${expanded ? 120 : 8}`,
      undefined,
      abort.signal,
    )
      .then(value => { if (!abort.signal.aborted) setPage(value); })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [sessionId, digest, offset, expanded]);
  const hideHeaders =
    !expanded &&
    (page?.lines.filter((line) => line.kind === "add" || line.kind === "del")
      .length ?? 0) <= 8;
  return (
    <section
      className={`diff-view ${embedded ? "embedded" : ""}`}
      aria-label="文件差异"
    >
      <header>
        {!embedded && (
          <span className="diff-path" title={path}>
            {path?.split(/[\\/]/).at(-1) ?? "文件修改"}
          </span>
        )}
        {page && !page.unavailable && (
          <span className="diff-stats">
            <b>+{page.added}</b> <em>−{page.removed}</em>
          </span>
        )}
        {path && locate && (
          <button onClick={() => locate(path)}>定位文件</button>
        )}
      </header>
      {error || page?.unavailable ? (
        <p role="alert">{error || page?.unavailable} · 可查看原始证据</p>
      ) : !page ? (
        <p>加载差异…</p>
      ) : (
        <>
          {!page.total && <p>内容无变化</p>}
          <div className="diff-lines">
            {page.lines.map((line, i) =>
              hideHeaders && line.kind === "header" ? null : (
                <div className={`diff-line ${line.kind}`} key={offset + i}>
                  <span>{line.old}</span>
                  <span>{line.next}</span>
                  <code className="syntax">
                    {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}{" "}
                    {line.tokens ? <TokenSpans tokens={line.tokens}/> : line.text}
                    {line.truncated ? " … [长行已截断，原文见附件]" : ""}
                  </code>
                </div>
              ),
            )}
          </div>
          <footer>
            <button
              onClick={() => {
                setExpanded(!expanded);
                setOffset(0);
              }}
            >
              {expanded ? "收起差异" : "查看文件 diff ↗"}
            </button>
            {expanded && (
              <>
                <button
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 120))}
                >
                  上一段
                </button>
                <span>
                  {offset + 1}–{offset + page.lines.length} / {page.total} 行
                </span>
                <button
                  disabled={page.next === undefined}
                  onClick={() => setOffset(page.next!)}
                >
                  下一段
                </button>
              </>
            )}
            {!expanded && page.next !== undefined && (
              <span>还有 {page.total - page.lines.length} 行</span>
            )}
            <button
              onClick={() => {
                void navigator.clipboard
                  .writeText(
                    page.lines
                      .map(
                        (l) =>
                          `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`,
                      )
                      .join("\n"),
                  )
                  .then(() => setCopied(true))
                  .catch(() => setError("复制失败"));
              }}
            >
              {copied ? "已复制" : "复制这段"}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
