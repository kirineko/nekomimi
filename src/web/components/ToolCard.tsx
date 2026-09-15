import { DiffView } from "./DiffView";
import { LocateFile } from "./WorkspacePanel";
import { toolContent } from "../../presentation/content";
import { useContext, useState } from "react";
import type { TimelineRow } from "../../shared/protocol";
import { Artifact } from "./Artifact";
import { statusText, toolTitle } from "../presentation";
export function ToolCard({
  row,
  sessionId,
}: {
  row: TimelineRow;
  sessionId: string;
}) {
  const locate = useContext(LocateFile);
  const [opened, setOpened] = useState<string>();
  const { input, result, target } = toolContent(row.text);
  const patch = (row.details as { patch?: { sha256: string } } | undefined)
    ?.patch?.sha256;
  return (
    <article className="row row-tool">
      <div className="tool-heading">
        <span className="tool-icon">
          {row.title === "bash" || row.title === "powershell" ? "⌘" : "↳"}
        </span>
        <strong>{toolTitle(row.title)}</strong>
        <span className={`badge ${row.status}`}>{statusText(row.status)}</span>
      </div>
      {target && (
        <div className="tool-target" title={target}>
          {target}
        </div>
      )}
      {row.status === "failed" && <p className="error">{result || row.text}</p>}
      <details className="tool-details">
        <summary>查看详情</summary>
        <div className="detail-label">输入</div>
        <pre>{input}</pre>
        {result && (
          <>
            <div className="detail-label">结果</div>
            <pre>{result}</pre>
          </>
        )}
        <details>
          <summary>执行记录</summary>
          <pre>{JSON.stringify(row.details, null, 2)}</pre>
        </details>
        {row.refs.map((ref) => (
          <div key={ref.sha256}>
            <button
              className="evidence-link"
              onClick={() =>
                setOpened(opened === ref.sha256 ? undefined : ref.sha256)
              }
            >
              {ref.sha256 === patch ? "原始 patch ↗" : "完整结果 ↗"}
            </button>
            {opened === ref.sha256 && (
              <Artifact sessionId={sessionId} reference={ref} />
            )}
          </div>
        ))}
      </details>
      {patch && row.status === "completed" && (
        <DiffView
          embedded
          sessionId={sessionId}
          digest={patch}
          path={(row.details as any)?.path}
          locate={locate}
        />
      )}
      {!patch && ["edit", "write"].includes(row.title) && row.status === "completed" && <p className="panel-muted">历史 diff 证据不可用，请查看执行记录</p>}
      {patch && row.status !== "completed" && (
        <p className="panel-muted">修改尚未确认，准备证据可在执行记录中查看</p>
      )}
      {row.title === "web_search" && <SearchSources details={row.details} />}
      {row.title === "web_fetch" && <FetchSummary details={row.details} />}
    </article>
  );
}
function SearchSources({ details }: { details: any }) {
  if (!Array.isArray(details?.sources)) return null;
  return (
    <section className="search-sources" aria-label="搜索来源">
      <p className="panel-muted">
        {
          (
            {
              complete: "搜索完成",
              partial: "部分结果，搜索未全部完成",
              empty: "搜索完成，无结果",
              failed: "搜索失败",
            } as Record<string, string>
          )[details.status]
        }
      </p>
      {details.sources.slice(0, 10).map((s: any, i: number) => {
        if (!s || typeof s.title !== "string" || typeof s.url !== "string") return null;
        let url: URL;
        try {
          url = new URL(s.url);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            return null;
        } catch {
          return null;
        }
        return (
          <a
            key={s.url}
            href={url.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="source-number">{i + 1}</span>
            <div>
              <strong>{s.title}</strong>
              <small>{url.hostname} ↗</small>
              {typeof s.snippet === "string" && <p>{s.snippet}</p>}
            </div>
          </a>
        );
      })}
    </section>
  );
}

// Historical evidence only; web_fetch is no longer an executable tool.
function FetchSummary({ details }: { details: any }) {
  if (!details || typeof details.finalUrl !== "string") return null;
  let url: URL;
  try {
    url = new URL(details.finalUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  } catch { return null; }
  return <section className="search-sources fetch-summary" aria-label="网页读取结果">
    <a href={url.href} target="_blank" rel="noopener noreferrer">
      <div><strong>{typeof details.title === "string" && details.title ? details.title : url.hostname}</strong><small>{url.href}</small></div>
    </a>
    <p className="panel-muted">{({ complete: "读取完成", partial: "部分内容", empty: "未提取到可读文本", failed: "读取失败", cancelled: "读取已停止" } as Record<string, string>)[details.status] ?? "读取记录"}
      {typeof details.statusCode === "number" && ` · HTTP ${details.statusCode}`}
    </p>
    {details.extraction === "metadata" && <p className="panel-muted">页面摘要（description 回退，非完整正文）</p>}
    {details.bodyTruncated && <p className="panel-muted">响应体已截断，未下载部分不可恢复。</p>}
    {details.outputTruncated && <p className="panel-muted">输出已截断，可在详情中查看完整已保存文本。</p>}
  </section>;
}
