import type { Diagnostic } from "../../shared/protocol";
import { api } from "../api";
import {Button} from "../ui/Button";
import { useEffect, useRef, useState } from "react";
export function DiagnosticNotice({ value, sessionId }: { value: Diagnostic; sessionId: string }) {
  const [error, setError] = useState("");
  const pending=useRef<AbortController|undefined>(undefined),[busy,setBusy]=useState(false);
  useEffect(()=>()=>pending.current?.abort(),[sessionId]);
  async function download() {
    if(pending.current)return;const abort=new AbortController();pending.current=abort;setBusy(true);
    try {
      const data = await api(`/sessions/${sessionId}/diagnostics`,undefined,abort.signal);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "nekomimi-diagnostics.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError("");
    } catch { if(!abort.signal.aborted)setError("诊断下载失败，请重试"); } finally {pending.current=undefined;if(!abort.signal.aborted)setBusy(false);}
  }
  return <details className="rounded-md border border-line bg-panel p-3 text-sm">
    <summary>检测到运行异常 · {value.code ?? value.category} · {value.operation}</summary>
    <p>发生时间：{new Date(value.timestamp).toLocaleString()}。诊断仅用于排查，不改变会话结果。</p>
    <p>运行：{value.runId ?? "未开始"} · 已确认事件：{value.durableSeq ?? "未知"} / {value.seq ?? "未知"}</p>
    <Button size="sm" variant="outline" busy={busy} onClick={() => void download()}>下载诊断</Button>
    {error && <span role="alert">{error}</span>}
  </details>;
}
