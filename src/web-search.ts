import { RecordedCall } from "./recorded-call.js";
import type { Journal, Links } from "./journal.js";
export interface SearchSettings {
  enabled: boolean;
  model: string;
  baseUrl: string;
}
export const searchDefaults: SearchSettings = {
  enabled: true,
  model: "deepseek-flash",
  baseUrl: "https://api.deepseek.com/anthropic/v1",
};
export interface SearchOptions {
  settings?: SearchSettings;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
}
export function parseSearch(payload: any) {
  if (!Array.isArray(payload?.content)) throw new Error("搜索返回格式无效");
  const ids = new Set<string>(
    payload.content
      .filter(
        (b: any) =>
          b?.type === "server_tool_use" &&
          b.name === "web_search" &&
          typeof b.id === "string",
      )
      .map((b: any) => b.id),
  );
  const completed = new Set<string>();
  const sources: SearchSource[] = [];
  const seen = new Set<string>();
  let failed = false;
  for (const block of payload.content) {
    if (
      !block ||
      block.type !== "web_search_tool_result" ||
      !ids.has(block.tool_use_id)
    )
      continue;
    if (!Array.isArray(block.content)) {
      failed = true;
      continue;
    }
    completed.add(block.tool_use_id);
    for (const item of block.content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "web_search_tool_result_error") {
        failed = true;
        continue;
      }
      if (
        item.type !== "web_search_result" ||
        typeof item.url !== "string" ||
        typeof item.title !== "string"
      )
        continue;
      try {
        const u = new URL(item.url);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password ||
          item.url.length > 8192 ||
          seen.has(item.url)
        )
          continue;
      } catch {
        continue;
      }
      seen.add(item.url);
      if (sources.length < 10)
        sources.push({
          title: item.title.slice(0, 1000),
          url: item.url,
          ...(typeof item.snippet === "string"
            ? { snippet: item.snippet.slice(0, 2000) }
            : {}),
        });
    }
  }
  const partial =
    failed ||
    [...ids].some((id) => !completed.has(id)) ||
    ![undefined, null, "end_turn"].includes(payload.stop_reason);
  const status =
    !completed.size || (partial && !sources.length)
      ? "failed"
      : partial
        ? "partial"
        : sources.length
          ? "complete"
          : "empty";
  return { sources, status, usage: payload.usage ?? null };
}
export async function webSearch(
  journal: Journal,
  links: Links,
  query: string,
  options: SearchOptions,
  signal?: AbortSignal,
) {
  if (!query.trim() || query.length > 4000)
    throw new Error("搜索 query 必须为 1–4000 字符");
  if (!options.apiKey)
    throw new Error("请配置 DeepSeek API key 后使用网页搜索");
  const settings = options.settings ?? searchDefaults;
  const base = new URL(settings.baseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
    )
  )
    throw new Error("搜索服务地址无效");
  const call = new RecordedCall(journal, links);
  const record = await call.attempt(
    {
      ...options,
      timeoutMs: options.timeoutMs ?? 60000,
      maxResponseBytes: options.maxResponseBytes ?? 2 * 1024 * 1024,
    },
    {
      purpose: "web-search",
      protocol: "messages",
      model: settings.model,
      attempt: 1,
      source: `tool:${links.toolCallId}`,
    },
    signal,
  );
  try {
    const response = await record.fetch(
      settings.baseUrl.replace(/\/$/, "") + "/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: settings.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Perform a web search for the query: ${query}`,
            },
          ],
          tools: [
            { type: "web_search_20250305", name: "web_search", max_uses: 3 },
          ],
        }),
      },
    );
    const text = await response.text();
    record.signal.throwIfAborted();
    if (!response.ok)
      throw new Error(`DeepSeek 搜索失败（HTTP ${response.status}）`);
    const payload = JSON.parse(text);
    const result = parseSearch(payload);
    const artifact = await journal.artifact(text);
    await record.finish({
      status: result.status === "failed" ? "failed" : "completed",
      searchStatus: result.status,
      response: artifact,
      usage: result.usage,
      protocol: "messages",
    });
    await journal.append(
      "search.result",
      { query, ...result, artifact },
      record.links,
    );
    if (result.status === "failed")
      throw new SearchFailure("未返回成功的服务端搜索记录");
    const content = [
      `Web search: ${query}`,
      result.status === "partial"
        ? "部分结果，搜索未全部完成"
        : result.status === "empty"
          ? "搜索完成，无结果"
          : "搜索完成",
      ...result.sources.map((s) => `${s.title}\n${s.url}\n${s.snippet ?? ""}`),
    ].join("\n\n");
    return {
      content: [{ type: "text" as const, text: content }],
      details: { query, ...result, artifact },
    };
  } catch (error) {
    if (!(error instanceof SearchFailure))
      await record.finish({
        status: signal?.aborted ? "cancelled" : "failed",
        error: journal.clean(
          record.timeout.aborted ? "搜索超时" : String(error),
        ),
        protocol: "messages",
      });
    throw error;
  }
}
class SearchFailure extends Error {}
