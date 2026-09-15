import { Markdown } from "./Markdown";
import { toolTitle } from "../presentation";

/** A readable view of a recorded Responses item; never used to rebuild requests. */
export function WireContent({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <>
        {value.map((item, i) => (
          <WireContent key={i} value={item} />
        ))}
      </>
    );
  if (typeof value === "string")
    return <div className="wire-text">{value}</div>;
  if (!value || typeof value !== "object")
    return <p className="muted">没有可显示的文本</p>;
  const item = value as Record<string, any>;
  if (item.type === "function_call")
    return (
      <div className="wire-tool">
        <strong>{toolTitle(item.name ?? "工具")}</strong>
        <pre>{pretty(item.arguments)}</pre>
      </div>
    );
  if (item.type === "function_call_output")
    return (
      <div className="wire-tool">
        <span className="detail-label">工具返回</span>
        <WireContent value={item.output} />
      </div>
    );
  if (item.type === "reasoning")
    return (
      <details>
        <summary>推理记录</summary>
        <WireContent
          value={item.summary ?? item.content ?? "未提供可读推理文本"}
        />
      </details>
    );
  if (item.text !== undefined) return <Markdown text={String(item.text)} />;
  if (item.content !== undefined) return <WireContent value={item.content} />;
  return (
    <details>
      <summary>{String(item.type ?? "记录")} · 查看原文</summary>
      <pre>{pretty(item)}</pre>
    </details>
  );
}
function pretty(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}
