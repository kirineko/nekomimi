import { WorkspaceFiles, listFiles } from "./workspace.js";
import { fileChangesPage, changeDiff } from "./changes.js";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { Sessions, type ServiceOptions } from "./sessions.js";
import { authorize, body, json, safeView } from "./http.js";
import {
  ApiError,
  integer,
  object,
  parseSubmit,
  validId,
} from "../shared/protocol.js";
import {
  artifactPage,
  prepareDownload,
  contextPage,
  tracePage,
} from "./evidence.js";
import { resolveResource } from "./resource-path.js";
import { ProviderProfiles } from "../customization/provider-profiles.js";
import { subscribe } from "./stream.js";
export async function startWeb(
  options: ServiceOptions & { port?: number; staticDir?: string; openFile?: (path: string) => Promise<void> },
) {
  const sessions = await Sessions.open(options);
  const files = new WorkspaceFiles(sessions.workspace, options.openFile);
  const token = randomBytes(32).toString("hex");
  const abort = new AbortController();
  let origin = "";
  let cookie = "";
  const staticDir =
    options.staticDir ??
    fileURLToPath(new URL("../web-dist/", import.meta.url));
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", origin);
      const path = url.pathname;
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("cache-control", "no-store");
      if (path.startsWith("/api/")) {
        authorize(req, origin, token, cookie);
        if (req.method === "POST" && path === "/api/v1/connect") {
          res.setHeader(
            "set-cookie",
            `${cookie}=${token}; HttpOnly; SameSite=Strict; Path=/api/v1`,
          );
          json(res, { version: 1 });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/workspace/files") {
          const reading = new AbortController(); res.once("close", () => reading.abort());
          json(res, await listFiles(sessions.workspace, url.searchParams.get("path") ?? ".", url.searchParams.get("hidden") === "true", url.searchParams.get("cursor") ?? undefined, reading.signal)); return;
        }
        if (req.method === "POST" && path === "/api/v1/workspace/open") {
          const value = object(await body(req));
          if (typeof value.path !== "string") throw new ApiError(400, "path", "路径无效");
          json(res, await files.open(value.path)); return;
        }
        const panelFrame = /^\/api\/v1\/panels\/([a-f0-9-]{36})\/frame$/.exec(path);
        if (panelFrame && req.method === 'GET') {
          const document = await sessions.customization.panels.document(panelFrame[1]!);
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.setHeader('content-security-policy', `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${document.nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'self'`);
          res.end(document.html); return;
        }
        if (path === '/api/v1/customization') {
          if (req.method === 'GET') { json(res, await sessions.customization.describe()); return; }
          if (req.method === 'POST') { json(res, await sessions.customizationAction(object(await body(req)))); return; }
        }
        if (req.method === "GET" && path === "/api/v1/config") {
          json(res, {
            workspace: sessions.workspace,
            ...(await sessions.config.describe()),
            configured: !!(await sessions.settings()).apiKey || !!(await new ProviderProfiles(sessions.paths.home).list()).selection.main,
          });
          return;
        }
        if (path === "/api/v1/settings" && req.method === "POST") {
          const v = object(await body(req));
          if (v.kind !== "settings" && v.kind !== "auth")
            throw new ApiError(400, "config", "配置类型无效");
          json(res, await sessions.config.save(v.kind, v));
          return;
        }
        if (
          path === "/api/v1/migrations" &&
          ["GET", "POST"].includes(req.method ?? "")
        ) {
          json(res, await sessions.migration(req.method === "POST"));
          return;
        }
        if (path === "/api/v1/sessions") {
          if (req.method === "GET") {
            json(
              res,
              await sessions.list(
                integer(url.searchParams.get("offset"), 0),
                Math.max(1, integer(url.searchParams.get("limit"), 30, 100)),
              ),
            );
            return;
          }
          if (req.method === "POST") {
            const v = object(await body(req));
            if (v.version !== 1 || typeof v.title !== "string")
              throw new ApiError(400, "input", "会话参数无效");
            json(res, await sessions.create(v.title), 201);
            return;
          }
        }
        const match = path.match(
          /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/(interactions|answer|changes|diff|snapshot|events|submit|cancel|evidence|artifacts|export|context|trace|delete|diagnostics)(?:\/([a-f0-9]+))?$/,
        );
        if (!match) throw new ApiError(404, "not_found", "接口不存在");
        const sessionId = match[1]!;
        const action = match[2]!;
        if (req.method === 'GET' && action === 'interactions') {
          await sessions.entry(sessionId); json(res, { items: sessions.interactions.list(sessionId) }); return;
        }
        if (req.method === 'POST' && action === 'answer') {
          json(res, await sessions.answerInteraction(sessionId, object(await body(req)))); return;
        }
        if (req.method === "POST" && action === "submit") {
          json(
            res,
            await sessions.submit(sessionId, parseSubmit(await body(req))),
            202,
          );
          return;
        }
        if (req.method === "POST" && action === "cancel") {
          const v = object(await body(req));
          if (
            v.version !== 1 ||
            typeof v.runId !== "string" ||
            !validId(v.runId)
          )
            throw new ApiError(400, "input", "运行 ID 无效");
          json(res, await sessions.cancel(sessionId, v.runId));
          return;
        }
        if (req.method === "POST" && action === "delete") {
          json(res, await sessions.remove(sessionId));
          return;
        }
        if (req.method === "GET" && action === "diagnostics") {
          res.setHeader("Content-Disposition", 'attachment; filename="nekomimi-diagnostics.json"');
          json(res, { version: 1, authoritative: false, diagnostics: await sessions.diagnostics(sessionId) });
          return;
        }
        const entry = await sessions.entry(sessionId);
        if (req.method === "GET" && action === "changes") {
          const before = integer(url.searchParams.get("before"), Number.MAX_SAFE_INTEGER);
          const after = integer(url.searchParams.get("after"), 0);
          const offset = integer(url.searchParams.get("offset"), 0);
          json(res, fileChangesPage(entry.reader.events, before, after, offset)); return;
        }
        if (req.method === "GET" && action === "diff" && match[3]) {
          json(res, await changeDiff(entry, match[3], integer(url.searchParams.get("offset"), 0), Math.max(1, integer(url.searchParams.get("limit"), 120, 500)))); return;
        }
        if (req.method === "GET" && action === "snapshot") {
          json(res, {
            version: 1,
            session: sessions.info(sessionId, entry),
            cursor: entry.reader.cursor,
            ...entry.projection.page(
              integer(url.searchParams.get("before"), Number.MAX_SAFE_INTEGER),
              60,
            ),
          });
          return;
        }
        if (req.method === "GET" && action === "events") {
          await subscribe(
            res,
            sessions,
            sessionId,
            integer(url.searchParams.get("seq"), 0),
            url.searchParams.get("hash") ?? "",
            abort.signal,
          );
          return;
        }
        if (req.method === "GET" && action === "trace") {
          const run = url.searchParams.get("run");
          if (!run || !validId(run))
            throw new ApiError(400, "run", "运行 ID 无效");
          json(
            res,
            safeView(
              tracePage(
                entry,
                run,
                integer(url.searchParams.get("offset"), 0),
                sessions.active?.sessionId === sessionId
                  ? sessions.active.runId
                  : undefined,
              ),
            ),
          );
          return;
        }
        if (req.method === "GET" && action === "context") {
          json(
            res,
            safeView(
              await contextPage(
                entry,
                url.searchParams.get("call") ?? "",
                integer(url.searchParams.get("offset"), 0),
              ),
            ),
          );
          return;
        }
        if (req.method === "GET" && action === "evidence") {
          const call = url.searchParams.get("call");
          const seq = url.searchParams.get("seq");
          const group = url.searchParams.get("group");
          const types: Record<string, string[]> = {
            Prompt: ["context.view"],
            Context: ["context.view"],
            Request: ["request.dispatched"],
            Response: [
              "response.headers",
              "response.chunk",
              "attempt.finished",
              "attempt.retry",
            ],
            Usage: ["attempt.finished"],
          };
          const events = entry.reader.events.filter((e) =>
            seq
              ? e.seq === integer(seq, 0)
              : call
                ? e.modelCallId === call &&
                  (!group || !types[group] || types[group]!.includes(e.type))
                : false,
          );
          const offset = integer(url.searchParams.get("offset"), 0);
          json(res, {
            events: safeView(events.slice(offset, offset + 40)),
            next: offset + 40 < events.length ? offset + 40 : undefined,
          });
          return;
        }
        if (req.method === "GET" && action === "artifacts" && match[3]) {
          json(
            res,
            await artifactPage(
              entry,
              match[3],
              integer(url.searchParams.get("offset"), 0),
              Math.max(1, integer(url.searchParams.get("limit"), 16384, 65536)),
            ),
          );
          return;
        }
        if (req.method === "POST" && action === "export") {
          if (sessions.active?.sessionId === sessionId)
            throw new ApiError(409, "busy", "请等待任务停止后导出");
          const v = object(await body(req));
          if (
            v.version !== 1 ||
            typeof v.format !== "string" ||
            !Array.isArray(v.redact) ||
            v.redact.some((x) => typeof x !== "string")
          )
            throw new ApiError(400, "input", "导出参数无效");
          const releaseDownload = await sessions.downloadLease(sessionId);
          try {
            const download = await prepareDownload(
              entry,
              v.format,
              v.redact as string[],
            );
            try {
              res.writeHead(200, {
                "content-type": download.type,
                "content-disposition": `attachment; filename="${download.name}"`,
              });
              await pipeline(createReadStream(download.file), res);
            } finally {
              await rm(download.directory, { recursive: true, force: true });
            }
          } finally {
            releaseDownload();
          }
          return;
        }
        throw new ApiError(405, "method", "不支持此操作");
      }
      if (req.headers.host !== new URL(origin).host || req.method !== "GET")
        throw new ApiError(403, "host", "请求被拒绝");
      if (path !== "/" && !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path))
        throw new ApiError(404, "not_found", "页面不存在");
      const file = join(staticDir, path === "/" ? "index.html" : path.slice(1));
      const resource = await resolveResource(staticDir, file);
      if (!resource)
        throw new ApiError(403, "path", "资源路径无效");
      res.setHeader(
        "content-security-policy",
        `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${origin}/api/v1/panels/; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      );
      res.setHeader(
        "content-type",
        (
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(file)] ?? "application/octet-stream",
      );
      res.end(await readFile(resource));
    })().catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const known = error instanceof ApiError;
      json(
        res,
        {
          error: {
            code: known ? error.code : "internal",
            message: known
              ? error.message
              : "操作失败，请检查本地配置和数据完整性",
          },
        },
        known ? error.status : 500,
      );
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await sessions.close();
    throw error;
  }
  const port = (server.address() as { port: number }).port;
  origin = `http://127.0.0.1:${port}`;
  cookie = `harness_${port}`;
  return {
    origin,
    url: `${origin}/#token=${token}`,
    token,
    sessions,
    async close() {
      abort.abort();
      await sessions.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
