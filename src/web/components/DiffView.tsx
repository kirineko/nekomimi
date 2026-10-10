import { Button } from "../ui/Button";
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
      className={`min-w-0 space-y-2 rounded-md border border-line p-2 ${embedded ? "text-xs" : "text-sm"}`}
      aria-label="文件差异"
    >
      <header className="flex flex-wrap items-center gap-2">
        {!embedded && (
          <span className="min-w-0 break-all font-medium" title={path}>
            {path?.split(/[\\/]/).at(-1) ?? "文件修改"}
          </span>
        )}
        {page && !page.unavailable && (
          <span className="flex gap-2 text-xs [&_b]:text-brand [&_em]:text-danger">
            <b>+{page.added}</b> <em>−{page.removed}</em>
          </span>
        )}
        {path && locate && (
          <Button variant="outline" size="sm" onClick={() => locate(path)}>定位文件</Button>
        )}
      </header>
      {error || page?.unavailable ? (
        <p role="alert">{error || page?.unavailable} · 可查看原始证据</p>
      ) : !page ? (
        <p>加载差异…</p>
      ) : (
        <>
          {!page.total && <p>内容无变化</p>}
          <div className="max-w-full overflow-x-auto rounded-sm border border-line font-mono text-xs">
            {page.lines.map((line, i) =>
              hideHeaders && line.kind === "header" ? null : (
                <div data-change-kind={line.kind} className={`grid min-w-max grid-cols-[2.5rem_2.5rem_1fr] gap-1 px-1 ${line.kind === "add" ? "bg-brand/10" : line.kind === "del" ? "bg-danger/10" : ""}`} key={offset + i}>
                  <span>{line.old}</span>
                  <span>{line.next}</span>
                  <code className="whitespace-pre">
                    {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}{" "}
                    {line.tokens ? <TokenSpans tokens={line.tokens}/> : line.text}
                    {line.truncated ? " … [长行已截断，原文见附件]" : ""}
                  </code>
                </div>
              ),
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-2 text-xs">
            <Button variant="outline" size="sm"
              onClick={() => {
                setExpanded(!expanded);
                setOffset(0);
              }}
            >
              {expanded ? "收起差异" : "查看文件 diff ↗"}
            </Button>
            {expanded && (
              <>
                <Button variant="outline" size="sm"
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 120))}
                >
                  上一段
                </Button>
                <span>
                  {offset + 1}–{offset + page.lines.length} / {page.total} 行
                </span>
                <Button variant="outline" size="sm"
                  disabled={page.next === undefined}
                  onClick={() => setOffset(page.next!)}
                >
                  下一段
                </Button>
              </>
            )}
            {!expanded && page.next !== undefined && (
              <span>还有 {page.total - page.lines.length} 行</span>
            )}
            <Button variant="outline" size="sm"
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
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}
