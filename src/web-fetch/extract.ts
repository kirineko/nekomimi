import { Parser } from "htmlparser2";
import { setImmediate } from "node:timers/promises";

const hiddenTags = new Set(["script", "style", "noscript", "svg", "template", "iframe", "object", "embed"]);
const blocks = new Set(["p", "div", "section", "article", "main", "header", "footer", "nav", "aside", "blockquote", "ul", "ol", "dl", "dt", "dd", "figure", "figcaption", "caption"]);
const placeholders = new Set(["", "loading", "loading...", "loading…", "please enable javascript", "you need to enable javascript to run this app."]);
const compact = (text: string) => text.replace(/\s+/g, " ").trim();
const escape = (text: string) => text.replace(/[\\`*_\[\]<>|]/g, "\\$&");
export interface ExtractedPage { title: string; text: string; extraction: "body" | "metadata" | "empty" | "text" }

/** Event parser with bounded stack/output; never builds or executes a browser DOM. */
export async function extractHtml(html: string, base: string, signal: AbortSignal, clean: (text: string) => string = text => text): Promise<ExtractedPage> {
  interface Frame { tag: string; hidden: boolean; link?: string; code?: string[] }
  const stack: Frame[] = [];
  let activeCode: Frame | undefined;
  const inCell = () => stack.some(f => f.tag === "td" || f.tag === "th");
  const parts: string[] = [], visible: string[] = [], titles: string[] = [];
  const metadata = new Map<string, string>();
  let size = 0, tags = 0, title = 0, rowCells = 0;
  let headingRow = false;
  const add = (text: string) => {
    if (inCell()) text = text.replace(/\r?\n/g, " ");
    size += text.length;
    if (size > 8 * 1024 * 1024) throw new Error("HTML 提取输出超过限制");
    parts.push(text);
  };
  // htmlparser2 may split one decoded text node at entities or input chunk boundaries.
  // Buffer it before redaction and Markdown escaping so neither can hide a credential.
  let pendingText = "";
  const flushText = () => {
    if (!pendingText) return;
    const text = pendingText; pendingText = "";
    if (stack.at(-1)?.hidden) return;
    if (title) { titles.push(text); return; }
    if (stack.some(f => f.tag === "head")) return;
    if (activeCode) { visible.push(text); activeCode.code!.push(text); return; }
    if (stack.some(f => f.tag === "table") && !inCell() && !text.trim()) return;
    visible.push(text);
    add(escape(clean(text).replace(/\s+/g, " ")));
  };
  const parser = new Parser({
    onopentag(tag, attrs) {
      flushText();
      if (++tags > 100000 || stack.length >= 256) throw new Error("HTML 结构超过解析限制");
      const parentHidden = stack.at(-1)?.hidden ?? false;
      const hidden = parentHidden || hiddenTags.has(tag) || "hidden" in attrs || attrs["aria-hidden"]?.toLowerCase() === "true" ||
        /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(attrs.style ?? "");
      const frame: Frame = { tag, hidden };
      stack.push(frame);
      if (hidden || activeCode) return;
      if (tag === "pre" || tag === "code") {
        frame.code = [];
        activeCode = frame;
        return;
      }
      if (tag === "meta") {
        const key = (attrs.name || attrs.property || "").toLowerCase().trim();
        const value = compact(clean(attrs.content ?? ""));
        if (["description", "og:description", "twitter:description"].includes(key) && value && !metadata.has(key)) metadata.set(key, value);
      }
      if (tag === "title") { title++; return; }
      if (tag === "head") return;
      if (/^h[1-6]$/.test(tag)) add(`\n\n${"#".repeat(Number(tag[1]))} `);
      else if (tag === "li") add("\n- ");
      else if (tag === "br") add("\n");
      else if (tag === "tr") { rowCells = 0; headingRow = false; add("\n| "); }
      else if (tag === "td" || tag === "th") { rowCells++; headingRow ||= tag === "th"; }
      else if (blocks.has(tag) || tag === "table") add("\n\n");
      else if (tag === "a" && attrs.href) {
        try {
          const url = new URL(attrs.href, base);
          if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
            frame.link = clean(url.href).replace(/[()]/g, c => c === "(" ? "%28" : "%29"); add("[");
          }
        } catch {}
      }
    },
    ontext(text) { pendingText += text; },
    onclosetag(tag) {
      flushText();
      const frame = stack.pop();
      if (!frame || frame.hidden) return;
      if (tag === "title") { title--; return; }
      if (activeCode) {
        if (frame !== activeCode) return;
        let text = clean(frame.code!.join(""));
        let fenceLength = frame.tag === "pre" ? 4 : 1;
        for (const match of text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
        const fence = "`".repeat(fenceLength);
        if (frame.tag === "pre" && !inCell()) add(`\n\n${fence}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}\n\n`);
        else {
          text = text.replace(/\r\n|\r|\n/g, " ");
          const pad = text.startsWith("`") || text.endsWith("`") || (/^ .* $/.test(text) && /[^ ]/.test(text)) ? " " : "";
          if (inCell()) text = text.replace(/\|/g, "\\|");
          if (text) add(`${fence}${pad}${text}${pad}${fence}`);
        }
        activeCode = undefined;
        return;
      }
      if (frame.link) add(`](${frame.link})`);
      else if (tag === "td" || tag === "th") add(" | ");
      else if (tag === "tr") { if (headingRow) add(`\n| ${Array(rowCells).fill("---").join(" | ")} |`); }
      else if (blocks.has(tag) || tag === "table" || /^h[1-6]$/.test(tag)) add("\n\n");
    },
  }, { decodeEntities: true });
  for (let offset = 0; offset < html.length; offset += 16384) {
    signal.throwIfAborted(); parser.write(html.slice(offset, offset + 16384)); await setImmediate();
  }
  signal.throwIfAborted(); parser.end(); flushText();
  const body = parts.join("").trim();
  const useful = !placeholders.has(compact(visible.join("")).toLowerCase());
  const description = ["description", "og:description", "twitter:description"].map(k => metadata.get(k)).find(Boolean);
  const text = useful ? body : description ? escape(description) : body;
  return { title: compact(clean(titles.join(""))), text, extraction: !useful && description ? "metadata" : text ? "body" : "empty" };
}

export function responseDecoder(contentType: string): TextDecoder {
  const charset = /charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType);
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset?.[1] ?? charset?.[2] ?? charset?.[3] ?? "utf-8"); }
  catch { throw new Error("不支持的字符编码"); }
  return decoder;
}

export function decodePage(bytes: Uint8Array, contentType: string): { html: boolean; text: string } {
  const text = responseDecoder(contentType).decode(bytes);
  const mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
  const html = mime === "text/html" || mime === "application/xhtml+xml" || (!mime && /<html\b|<!doctype\s+html/i.test(text.slice(0, 500)));
  if (!html && !(mime.startsWith("text/") || /^application\/(?:json|xml|[^;]+\+(?:json|xml))$/.test(mime)))
    throw new Error(`不支持的内容类型：${mime || "未知"}`);
  return { html, text };
}
