import { diffPage } from "../presentation/diff.js";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { markdownHtml } from "../presentation/syntax/markdown.js";
import { nodeSyntax } from "../presentation/syntax/node.js";
import { colorDiff } from "../presentation/syntax/diff.js";
import { fileLanguage, maxSyntaxBytes } from "../presentation/syntax/types.js";
import { syntaxCss } from "../presentation/syntax/palette.js";
import { TokenSpans } from "../presentation/syntax/view.js";
import { randomUUID } from "node:crypto";
import type { Artifact } from "../journal.js";
import { toolContent } from "../presentation/content.js";
import { SessionProjection } from "../projection/session.js";
import type { SessionSnapshot } from "../journal.js";
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const status = (s?: string) =>
  ({
    completed: "已完成",
    running: "未结束",
    cancelled: "已停止",
    failed: "失败",
    interrupted: "已中断",
    incomplete: "未完成",
  })[s ?? ""] ??
  s ??
  "";
const tool = (name: string) =>
  ({
    read: "读取文件",
    write: "写入文件",
    edit: "修改文件",
    bash: "运行命令",
    powershell: "运行命令",
  })[name] ?? name;
export async function renderSessionHtml(
  snapshot: SessionSnapshot,
  artifacts: Map<string, Buffer>,
  redact: (text: string) => string,
) {
  const projection = new SessionProjection(snapshot.directory);
  await projection.update(snapshot.events.slice(0, snapshot.durableSeq));
  const rows = [...projection.rows.values()].map((row) => ({
    ...row,
    text: redact(row.text),
    title: redact(row.title),
  }));
  const title = redact(
    String(
      (
        snapshot.events.findLast((e) =>
          ["session.title", "web.session"].includes(e.type),
        )?.payload as any
      )?.title ?? "会话记录",
    ),
  );
  let round = 0;
  const navigation: string[] = [];
  const scope = `export:${randomUUID()}`;
  const bodies: string[] = [];
  try {
  for (const row of rows) {
      let anchor = "";
      if (row.kind === "user") {
        round++;
        anchor = ` id="round-${round}"`;
        navigation.push(
          `<a href="#round-${round}">${round}. ${escape(row.text.slice(0, 48))}</a>`,
        );
      }
      const label =
        row.kind === "user"
          ? "你的任务"
          : row.kind === "assistant"
            ? "Nekomimi"
            : row.kind === "tool"
              ? tool(row.title)
              : row.kind === "call"
                ? row.title === "会话命名"
                  ? "会话命名"
                  : "模型调用"
                : "本轮结束";
      let content = "";
      if (row.kind === "assistant")
        content = await markdownHtml(row.text, scope);
      else if (row.kind === "tool") {
        const { input, result, target } = toolContent(row.text);
        content = `<code>${escape(target)}</code><details><summary>调用参数</summary><pre>${escape(input)}</pre></details><details${row.status === "failed" ? " open" : ""}><summary>返回结果 · ${escape(result.slice(0, 100) || "结果未记录，状态未知")}</summary><pre>${escape(result)}</pre></details>`;
        const patch = (row.details as any)?.patch?.sha256;
        if (patch && artifacts.has(patch)) {
          if (row.status === "completed") {
            try {
              let page = diffPage(
                redact(artifacts.get(patch)!.toString("utf8")),
                0,
                Number.MAX_SAFE_INTEGER,
              );
              const details = row.details as {path?:string;before?:Artifact;after?:Artifact;patch?:Artifact};
              const language = fileLanguage(details.path ?? target);
              const source = async (ref?:Artifact) => {
                if (!ref || ref.redacted || !language || ref.bytes > maxSyntaxBytes) return;
                const bytes = artifacts.get(ref.sha256);
                if (!bytes || bytes.length > maxSyntaxBytes) return;
                try {
                  const text = redact(new TextDecoder("utf8", {fatal:true,ignoreBOM:true}).decode(bytes));
                  return await nodeSyntax.run(text,language,scope);
                } catch { return; }
              };
              if (!details.patch?.redacted) page = colorDiff(page, await source(details.before), await source(details.after));
              content += `<section><strong>+${page.added} −${page.removed}</strong>${page.lines.map((l) => `<pre style="margin:0;background:${l.kind === "add" ? "#edf7ee" : l.kind === "del" ? "#fff0ef" : "transparent"}">${escape(`${l.old ?? ""} ${l.next ?? ""} ${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} `)}<code class="syntax">${l.tokens ? renderToStaticMarkup(h(TokenSpans,{tokens:l.tokens})) : escape(l.text)}</code>${l.truncated ? " … [长行已截断，原文见附件]" : ""}</pre>`).join("")}</section>`;
            } catch {
              content += "<p>无法解析 diff，请查看原始证据</p>";
            }
          }
          content += `<details open><summary>${row.status === "completed" ? "文件 diff" : "准备修改证据（未确认）"}</summary><pre>${escape(redact(artifacts.get(patch)!.toString("utf8")))}</pre></details>`;
        }
      } else content = `<p class="text">${escape(row.text)}</p>`;
      if (row.kind === "call") {
        const reasoning = snapshot.events
          .filter(
            (e) => e.attemptId === row.attemptId && e.type === "context.add",
          )
          .flatMap((e) => (e.payload as any).items ?? [])
          .filter((item: any) => item.type === "reasoning")
          .flatMap((item: any) => item.content ?? item.summary ?? [])
          .map((block: any) => block.text ?? "")
          .join("\n");
        if (reasoning)
          content += `<details><summary>推理记录</summary><pre>${escape(redact(reasoning))}</pre></details>`;
      }
      if (row.kind === "call")
        content += `<details><summary>用量与耗时</summary><pre>${escape(redact(JSON.stringify(row.details ?? { status: "统计未提供" }, null, 2)))}</pre></details>`;
      if (row.refs.length)
        content += `<details><summary>原始证据</summary>${row.refs.map((r) => `<a href="#artifact-${r.sha256}">附件 ${r.sha256.slice(0, 10)}</a>`).join(" · ")}</details>`;
      bodies.push(`<article class="${row.kind}"${anchor}><header><strong>${escape(label)}</strong><span>${escape(status(row.status))}</span></header>${content}</article>`);
  }
  } finally { nodeSyntax.clearScope(scope); }
  const body=bodies.join("");
  const events = snapshot.events
    .slice(0, snapshot.durableSeq)
    .map(
      (e) =>
        `<details><summary>${e.seq} · ${escape(e.type)}</summary><pre>${escape(redact(JSON.stringify(e, null, 2)))}</pre></details>`,
    )
    .join("");
  const attachments = [...artifacts]
    .map(([digest, bytes]) => {
      let text: string;
      try {
        text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
      } catch {
        text = "[Binary artifact, base64]\n" + bytes.toString("base64");
      }
      return `<section id="artifact-${digest}"><details><summary>附件 ${digest.slice(0, 12)} · ${bytes.length} bytes</summary><pre>${escape(redact(text))}</pre></details></section>`;
    })
    .join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(title)} · Nekomimi</title><style>${styles}\n${syntaxCss}</style><body><aside><h2>Nekomimi</h2><nav>${navigation.join("")}</nav><a href="#evidence">原始记录与附件</a></aside><main><h1>${escape(title)}</h1><p class="muted">离线阅读副本 · 已脱敏 · 不可用于继续会话</p><p class="muted">持久化水位 ${snapshot.durableSeq} · 尾部异常 ${snapshot.tornBytes} bytes · 未确认事件 ${snapshot.tentativeEvents}</p>${snapshot.pending.length ? `<section class="warning"><h2>未完成操作</h2><pre>${escape(redact(JSON.stringify(snapshot.pending, null, 2)))}</pre></section>` : ""}${body}<section id="evidence"><h2>原始记录与附件</h2><details><summary>Journal 事件</summary>${events}</details>${attachments}</section></main></body></html>`;
}
const styles = `*{box-sizing:border-box}body{margin:0;background:#faf9fc;color:#292532;font:15px/1.7 system-ui;display:grid;grid-template-columns:240px minmax(0,900px);justify-content:center}aside{padding:32px 24px;position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid #e8e4ee}main{padding:36px;min-width:0}h1{font-size:26px}nav a{display:block;margin:12px 0}a{color:#7054ac;overflow-wrap:anywhere}article{padding:22px;margin:20px 0;border:1px solid #e7e2ed;background:white;border-radius:12px}article header{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}header span,.muted{font-size:12px;color:#797180}.user{background:#f0edf6}.call{font-size:13px;background:transparent}.text,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{background:#f4f2f7;padding:16px;border-radius:8px;font-size:12px;max-height:600px;overflow:auto}code{overflow-wrap:anywhere}summary{cursor:pointer;padding:8px 0;overflow-wrap:anywhere}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e7e2ed;padding:8px;text-align:left}.warning{background:#fff4db;padding:16px}section[id],article[id]{scroll-margin-top:20px}@media(max-width:700px){body{display:block}aside{position:static;height:auto;border-bottom:1px solid #e8e4ee}main{padding:18px}article{padding:16px}}`;
