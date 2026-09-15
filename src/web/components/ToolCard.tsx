import { toolContent } from "../../presentation/content";
import { useState } from "react";
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
  const [opened, setOpened] = useState<string>();
  const {input,result,target}=toolContent(row.text);
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
        {row.refs
          .filter((r) => r.sha256 !== patch)
          .map((ref) => (
            <div key={ref.sha256}>
              <button
                className="evidence-link"
                onClick={() =>
                  setOpened(opened === ref.sha256 ? undefined : ref.sha256)
                }
              >
                完整结果 ↗
              </button>
              {opened === ref.sha256 && (
                <Artifact sessionId={sessionId} reference={ref} />
              )}
            </div>
          ))}
      </details>
      {row.refs
        .filter((r) => r.sha256 === patch)
        .map((ref) => (
          <div key={ref.sha256}>
            <button
              className="evidence-link diff-link"
              onClick={() =>
                setOpened(opened === ref.sha256 ? undefined : ref.sha256)
              }
            >
              查看文件 diff ↗
            </button>
            {opened === ref.sha256 && (
              <Artifact sessionId={sessionId} reference={ref} />
            )}
          </div>
        ))}
    </article>
  );
}
