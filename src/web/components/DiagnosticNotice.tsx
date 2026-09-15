import type { Diagnostic } from "../../shared/protocol";
import { api } from "../api";
import { useState } from "react";
export function DiagnosticNotice({ value, sessionId }: { value: Diagnostic; sessionId: string }) {
  const [error, setError] = useState("");
  async function download() {
    try {
      const data = await api(`/sessions/${sessionId}/diagnostics`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "nekomimi-diagnostics.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError("");
    } catch { setError("诊断下载失败，请重试"); }
  }
  return <details className="error banner">
    <summary>检测到运行异常 · {value.code ?? value.category} · {value.operation}</summary>
    <p>发生时间：{new Date(value.timestamp).toLocaleString()}。诊断仅用于排查，不改变会话结果。</p>
    <p>运行：{value.runId ?? "未开始"} · 已确认事件：{value.durableSeq ?? "未知"} / {value.seq ?? "未知"}</p>
    <button onClick={() => void download()}>下载诊断</button>
    {error && <span role="alert">{error}</span>}
  </details>;
}
