import { Brand } from "./Brand";
import type { TimelineRow } from "../../shared/protocol";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { statusText } from "../presentation";
export { statusText } from "../presentation";
export function Timeline({
  sessionId,
  rows,
  inspect,
  older,
  latest,
  hasOlder,
}: {
  sessionId: string;
  rows: TimelineRow[];
  inspect: (row: TimelineRow) => void;
  older: () => void;
  latest: () => void;
  hasOlder: boolean;
}) {
  return (
    <div className="timeline" aria-label="任务时间线">
      {hasOlder && (
        <div className="history-actions">
          <button onClick={older}>加载更早记录</button>
          <button onClick={latest}>回到最新记录</button>
        </div>
      )}
      {rows.map((row) =>
        row.kind === "tool" ? (
          <ToolCard key={row.id} row={row} sessionId={sessionId} />
        ) : (
          <article className={`row row-${row.kind}`} key={row.id}>
            {row.kind === "call" ? (
              <button
                className="trace-step"
                aria-label="检查调用"
                onClick={() => inspect(row)}
              >
                <span className={`step-dot ${row.status}`} />
                <span>
                  {row.title === "会话命名" ? "会话命名" : row.status === "running"
                    ? "Nekomimi 正在思考"
                    : row.status === "failed"
                      ? "本次响应失败"
                      : "思考过程"}
                </span>
                <span className="trace-meta">{statusText(row.status)}</span>
                <span>↗</span>
              </button>
            ) : (
              <div className="row-head">
                <strong>
                  {row.kind === "user"
                    ? "你"
                    : row.kind === "assistant"
                      ? <Brand compact />
                      : statusText(row.status)}
                </strong>
              </div>
            )}
            {row.text && row.kind === "assistant" ? (
              <Markdown text={row.text} />
            ) : row.text && row.kind !== "call" ? (
              <div className="row-text">{row.text}</div>
            ) : row.kind === "call" && row.status === "failed" ? (
              <p className="error">{row.text}</p>
            ) : null}
          </article>
        ),
      )}
    </div>
  );
}
