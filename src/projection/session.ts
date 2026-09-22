import { artifactRefs, readArtifact, type JournalEvent } from "../journal.js";
import type { SessionInfo, TimelineRow } from "../shared/protocol.js";
const clipped = (text: string) =>
  text.length > 24000
    ? text.slice(0, 24000) + "\n[摘要已截断，请查看完整证据]"
    : text;
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((c) => c?.text ?? (c?.type?.includes("image") ? "[图片]" : ""))
          .join("\n")
      : "";
/** Disposable display projection. Provider request construction never reads this module. */
export class SessionProjection {
  rows = new Map<string, TimelineRow>();
  private auxiliary = new Set<string>();
  private seq = 0;
  private digest = "";
  private frames = new Map<string, { decoder: TextDecoder; buffer: string }>();
  private error?: string;
  constructor(private directory: string) {}
  async update(events: JournalEvent[]) {
    if (
      events.length < this.seq ||
      (this.seq && events[this.seq - 1]?.hash !== this.digest)
    ) {
      this.rows.clear();
      this.auxiliary.clear();
      this.frames.clear();
      this.seq = 0;
    }
    for (const e of events.slice(this.seq)) {
      await this.apply(e);
      this.seq = e.seq;
      this.digest = e.hash;
    }
  }
  private row(
    e: JournalEvent,
    id: string,
    kind: TimelineRow["kind"],
    title: string,
  ) {
    let row = this.rows.get(id);
    if (!row) {
      row = {
        id,
        seq: e.seq,
        kind,
        title,
        text: "",
        refs: [],
        runId: e.runId,
        modelCallId: e.modelCallId,
        attemptId: e.attemptId,
        toolCallId: e.toolCallId,
      };
      this.rows.set(id, row);
    }
    row.seq = e.seq;
    const refs = artifactRefs(e.payload);
    for (const ref of refs)
      if (!row.refs.some((r) => r.sha256 === ref.sha256)) row.refs.push(ref);
    return row;
  }
  private async apply(e: JournalEvent) {
    const p = e.payload as Record<string, any>;
    if (e.type === "branch.created") this.row(e, e.eventId, "status", "显式历史分支").text = `保留原始证据；新请求省略 ${p.omittedReasoning} 项供应商 reasoning。未重放工具。`;
    if (e.type === "context.add" && String(p.source).startsWith("branch:")) this.row(e, e.eventId, p.item?.role === "user" ? "user" : p.item?.role === "assistant" ? "assistant" : "status", "分支历史").text = clipped(textOf(p.item?.content) || JSON.stringify(p.item));
    if (e.type === "context.add" && p.source === "user")
      this.row(e, e.eventId, "user", "你").text = clipped(
        textOf(p.item?.content),
      );
    if (e.type === "context.add" && Array.isArray(p.items) && e.attemptId) {
      const text = p.items
        .filter((i: any) => i.type === "message")
        .map((i: any) => textOf(i.content))
        .join("\n");
      if (text)
        this.row(e, `${e.attemptId}:text`, "assistant", "助手").text =
          clipped(text);
    }
    if (e.type === 'workflow.reference') { const r=this.row(e,e.eventId,'status','持久工作流');r.text=`工作流 ${p.definitionId} · ${p.workflowId}。结果与交互以独立工作流 Journal 为准。`;r.details=p; }
    if (['extension.ui', 'extension.command_result', 'extension.error', 'interaction.opened', 'interaction.answered', 'interaction.cancelled', 'tool.evidence_gap', 'tool.execution_error'].includes(e.type)) {
      const r = this.row(e, String(p.instanceId ?? p.id ?? e.eventId), 'status', p.title ?? p.value?.title ?? (e.type === 'extension.command_result' ? '命令结果' : e.type));
      r.text = clipped(p.text ?? p.message ?? JSON.stringify(p.answer ?? p.value ?? p));
      r.details = p; r.status = e.type === 'interaction.opened' ? 'waiting' : e.type === 'interaction.cancelled' ? 'cancelled' : 'completed';
    }
    if (e.type === "attempt.started") {
      const r = this.row(
        e,
        e.attemptId!,
        "call",
        `模型调用 · 尝试 ${p.attempt}`,
      );
      r.status = "running";
      r.text = p.model;
      if (p.purpose === "web-search") {
        r.title = "网页搜索调用";
        this.auxiliary.add(e.attemptId!);
      }
      if (p.purpose === 'extension') { r.title = '扩展模型调用'; this.auxiliary.add(e.attemptId!); }
      if (p.purpose === "session-title") {
        r.title = "会话命名";
        this.auxiliary.add(e.attemptId!);
      }
    }
    if (
      [
        "request.dispatched",
        "response.headers",
        "attempt.finished",
        "attempt.retry",
      ].includes(e.type)
    ) {
      const r = this.row(e, e.attemptId!, "call", "模型调用");
      if (e.type === "attempt.finished") {
        r.status = p.status;
        r.details = p;
        if (p.error) r.text = clipped(p.error);
        this.frames.delete(e.attemptId!);
      }
    }
    if (e.type === "response.chunk" && !this.auxiliary.has(e.attemptId!)) {
      const key = e.attemptId!;
      let frame = this.frames.get(key);
      if (!frame) {
        frame = { decoder: new TextDecoder(), buffer: "" };
        this.frames.set(key, frame);
      }
      try {
        frame.buffer += frame.decoder.decode(
          await readArtifact(this.directory, p.artifact),
          { stream: true },
        );
        const parts = frame.buffer.split(/\r?\n\r?\n/);
        frame.buffer = parts.pop() ?? "";
        for (const part of parts) {
          const data = part
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event.type === "response.output_text.delta") {
            const r = this.row(e, `${key}:text`, "assistant", "助手");
            r.text = clipped(r.text + String(event.delta ?? ""));
          }
        }
        if (frame.buffer.length > 16 * 1024 * 1024)
          throw new Error("Display frame limit exceeded");
      } catch (error) {
        this.error = String(error);
        this.row(e, `${key}:evidence-error`, "status", "证据读取失败").text =
          String(error);
        this.frames.delete(key);
      }
    }
    if (
      e.toolCallId &&
      [
        "tool.requested",
        "tool.intent",
        "tool.result",
        "tool.failed",
        "file.change_prepared",
        "shell.finished",
        "fetch.finished",
      ].includes(e.type)
    ) {
      const r = this.row(
        e,
        `${e.runId}:${e.toolCallId}`,
        "tool",
        p.name ?? "工具",
      );
      if (e.type === "tool.requested") {
        r.status = "running";
        r.title = p.name;
        r.text = clipped(JSON.stringify(p.args, null, 2));
      }
      // Read-only compatibility for sessions saved before web_fetch was retired.
      if (e.type === "fetch.finished") {
        r.title = "web_fetch";
        r.details = p;
        r.status = p.status === "cancelled" ? "cancelled" : p.status === "failed" ? "failed" : "completed";
      }
      if (e.type === "file.change_prepared" || e.type === "shell.finished")
        r.details = p;
      if (e.type === "tool.result" || e.type === "tool.failed") {
        r.status = e.type === "tool.failed" ? "failed" : "completed";
        r.text += "\n\n" + clipped(textOf(p.item?.output));
        if (p.details && (r.title !== "web_fetch" || Object.keys(p.details).length)) r.details = p.details;
        if (r.title === "web_fetch" && (r.details as any)?.status === "cancelled") r.status = "cancelled";
      }
    }
    if (e.type === "run.finished") {
      const r = this.row(e, e.eventId, "status", "任务结束");
      r.status = p.status;
      r.text = clipped(p.error ?? "");
    }
  }
  info(
    id: string,
    events: JournalEvent[],
    active?: { runId: string; cancelling: boolean },
  ): SessionInfo {
    const meta = [...events]
      .reverse()
      .find((e) => e.type === "session.title" || e.type === "web.session")
      ?.payload as { title?: string } | undefined;
    const started = [...events]
      .reverse()
      .find((e) => e.type === "command.accepted" || e.type === "run.started");
    const terminal =
      started &&
      events.find(
        (e) => e.type === "run.finished" && e.runId === started.runId,
      );
    return {
      id,
      title: meta?.title ?? "未命名会话",
      updatedAt: events.at(-1)?.timestamp ?? "",
      runId: active?.runId ?? started?.runId,
      status: active
        ? active.cancelling
          ? "cancelling"
          : "running"
        : terminal
          ? String((terminal.payload as any).status)
          : started
            ? "interrupted"
            : "idle",
      error: this.error,
    };
  }
  page(before = Number.MAX_SAFE_INTEGER, limit = 60) {
    const all = [...this.rows.values()];
    const rows = all.slice(0, before);
    const start = Math.max(0, rows.length - limit);
    return {
      rows: rows.slice(start),
      before: start || undefined,
      totalRows: all.length,
    };
  }
}
