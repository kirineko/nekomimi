import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "../shared/protocol.js";
export function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}
export async function body(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new ApiError(415, "content_type", "需要 application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new ApiError(413, "body_limit", "请求过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "JSON 格式无效");
  }
}
export function authorize(
  req: IncomingMessage,
  origin: string,
  token: string,
  cookie: string,
) {
  if (req.headers.host !== new URL(origin).host)
    throw new ApiError(403, "host", "拒绝未知主机");
  if (req.headers.origin && req.headers.origin !== origin)
    throw new ApiError(403, "origin", "拒绝跨来源请求");
  if (
    !["GET", "HEAD"].includes(req.method ?? "") &&
    req.headers.origin !== origin
  )
    throw new ApiError(403, "origin", "写请求必须来自本服务");
  const bearer = req.headers.authorization?.replace(/^Bearer /, "");
  const fromCookie = req.headers.cookie
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(cookie + "="))
    ?.slice(cookie.length + 1);
  const candidate = Buffer.from(bearer ?? fromCookie ?? "");
  const expected = Buffer.from(token);
  if (
    candidate.length !== expected.length ||
    !timingSafeEqual(candidate, expected)
  )
    throw new ApiError(401, "auth", "连接授权已失效，请重新打开终端中的入口");
}
export function safeView(value: unknown): unknown {
  if (typeof value === "string")
    return value.length > 12000
      ? value.slice(0, 12000) + "\n[显示已截断；打开原始附件查看]"
      : value;
  if (Array.isArray(value))
    return [
      ...value.slice(0, 100).map(safeView),
      ...(value.length > 100
        ? [`[其余 ${value.length - 100} 项请查看完整附件]`]
        : []),
    ];
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, safeView(v)]),
    );
  return value;
}
