import { sessionStatusLabel } from "../../glossary.js";
import { Badge } from "../../ui/Badge";
import { DevValue } from "../dev-only";

/** 会话头部状态：用户语言标签（就绪时不显示）+ 开发者视图下的原始状态码。 */
export function SessionStatusLabel({ status }: { status: string }) {
  const label = sessionStatusLabel(status);
  const tone =
    status === "failed"
      ? "danger"
      : ["accepted", "interrupted", "unknown", "incomplete"].includes(status)
        ? "warning"
        : "default";
  return (
    <>
      {label && <Badge state={tone}>{label}</Badge>}
      <DevValue label="原始状态" value={status} truncate={24} />
    </>
  );
}
