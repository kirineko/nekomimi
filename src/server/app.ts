import {inspectionImage} from './inspection-image.js';
import {inspectSession} from './inspection.js';
import {contextDetails} from "./context-details.js";
import { CoreSwitchGate } from '../core/switch-gate.js';
import { WorkspaceReferences } from "./references.js";
import { WorkspaceFiles, listFiles } from "./workspace.js";
import { fileChangesPage, changeDiff } from "./changes.js";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { parseSessionCreation } from "../session/identity.js";
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
  options: ServiceOptions & { port?: number; staticDir?: string; openFile?: (path: string) => Promise<void>; browserToken?: string; initialCoreFence?: string; coreControl?: (action: string, value: Record<string, unknown>) => Promise<unknown> },
) {
  if (options.browserToken !== undefined && !/^[a-f0-9]{64}$/.test(options.browserToken)) throw new ApiError(400, 'input', '托管连接身份无效');
  const sessions = await Sessions.open(options);
  const files = new WorkspaceFiles(sessions.workspace, options.openFile);
  const references = new WorkspaceReferences(sessions.workspace);
  const referenceTargets = new Map<string,WorkspaceReferences>();
  const switchGate = new CoreSwitchGate();
  if (options.initialCoreFence) {
    try {
      await sessions.waitInitialization();
      const readiness = await switchGate.prepare(options.initialCoreFence, () => sessions.beginCoreSwitch(options.initialCoreFence!));
      if (!readiness.ready) throw new ApiError(409, 'core_busy', '候选启动时存在未完成任务，不能接受新操作');
    } catch (error) { await sessions.close(); throw error; }
  }
  const token = options.browserToken ?? randomBytes(32).toString("hex");
  const abort = new AbortController();
  abort.signal.addEventListener("abort", () => { references.close();for(const target of referenceTargets.values())target.close();referenceTargets.clear(); }, { once: true });
  let origin = "";
  let cookie = "";
  const staticDir =
    options.staticDir ??
    fileURLToPath(new URL("../web-dist/", import.meta.url));
  const server = createServer((req, res) => {
    let releaseMutation: (() => void) | undefined;
    void (async () => {
      const url = new URL(req.url ?? "/", origin);
      const path = url.pathname;
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("cache-control", "no-store");
      if (path.startsWith("/api/")) {
        authorize(req, origin, token, cookie);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '') && !path.startsWith('/api/v1/core/')) releaseMutation = switchGate.enter(`${req.method} ${path}`);
        const core = /^\/api\/v1\/core\/(status|preview|switch|receipt|recovery)$/.exec(path);
        if (core) {
          if (req.method !== (['status', 'receipt', 'recovery'].includes(core[1]!) ? 'GET' : 'POST')) throw new ApiError(405, 'method', '核心控制方法无效');
          if (!options.coreControl) {
            if (core[1] === 'recovery') { json(res, await (await import('../core/recovery-view.js')).coreRecoveryView(await (await import('../core/installation.js')).CoreInstallation.locate())); return; }
            if (core[1] !== 'status') throw new ApiError(409, 'core_unmanaged', '当前启动方式不支持切换，请使用 core launch-info 查看明确启动步骤');
            json(res, { mode: 'unmanaged', switchSupported: false, identity: await (await import('../customization/sdk.js')).hostIdentity() }); return;
          }
          const value = req.method === 'GET' ? { commandId: url.searchParams.get('commandId') ?? undefined } : object(await body(req));
          json(res, await options.coreControl(core[1]!, value)); return;
        }
        if (req.method === "POST" && path === "/api/v1/connect") {
          res.setHeader(
            "set-cookie",
            `${cookie}=${token}; HttpOnly; SameSite=Strict; Path=/api/v1`,
          );
          json(res, { version: 1 });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/workspace/references") {
          const reading = new AbortController(); res.once("close", () => reading.abort());
          const root=await sessions.referenceWorkspace(url.searchParams.get('session') ?? undefined);
          let scoped=references;
          if(root!==sessions.workspace) {
            scoped=referenceTargets.get(root)!;
            if(!scoped) {
              if(referenceTargets.size>=64){const oldest=referenceTargets.entries().next().value!;oldest[1].close();referenceTargets.delete(oldest[0]);}
              scoped=new WorkspaceReferences(root);referenceTargets.set(root,scoped);
            }
          }
          json(res, url.searchParams.get("mode") === "resolve"
            ? await scoped.resolve(url.searchParams.get("path") ?? "", reading.signal)
            : await scoped.list(url.searchParams.get("query") ?? "", url.searchParams.get("cursor") ?? undefined, url.searchParams.get("refresh") === "true", reading.signal)); return;
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
          const document = await sessions.panelDocument(panelFrame[1]!, url.searchParams.get('session') ?? undefined);
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.setHeader('content-security-policy', `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${document.nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'self'`);
          res.end(document.html); return;
        }
        if (req.method === "GET" && path === "/api/v1/commands") {
          json(res, await sessions.commandCatalog(url.searchParams.get("session") ?? undefined)); return;
        }
        if(req.method==='GET'&&path==='/api/v1/runtime-ui'){json(res,await sessions.runtimeUi(url.searchParams.get('session') ?? undefined));return;}
        if (path === '/api/v1/customization') {
          if (req.method === 'GET') { json(res, await sessions.describeCustomization(url.searchParams.get("session") ?? undefined)); return; }
          if (req.method === 'POST') { json(res, await sessions.customizationAction(object(await body(req)))); return; }
        }
        const validationTasks = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]{1,80})\/validation-tasks$/.exec(path);
        if (validationTasks && req.method === 'GET') { json(res, await sessions.validationTaskView(validationTasks[1]!)); return; }
        const validationPreview = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]{1,80})\/validation-tasks\/([a-zA-Z0-9_-]{1,80})\/preview$/.exec(path);
        if (validationPreview && req.method === 'GET') { json(res, await sessions.validationPreview(validationPreview[1]!, validationPreview[2]!)); return; }
        const coreLaunchInfo = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]{1,80})\/core-launch-info$/.exec(path);
        if (coreLaunchInfo && req.method === 'GET') { json(res, await sessions.coreLaunchInfo(coreLaunchInfo[1]!, url.searchParams.get('buildId') ?? '')); return; }
        const coreOperations = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]{1,80})\/core-operations$/.exec(path);
        if (coreOperations && req.method === 'GET') { json(res, await sessions.coreOperationView(coreOperations[1]!)); return; }
        const coreCandidateView = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]{1,80})\/core-candidate$/.exec(path);
        if (coreCandidateView && req.method === 'GET') { json(res, await sessions.coreCandidateView(coreCandidateView[1]!)); return; }
        const candidateView = /^\/api\/v1\/customization\/candidates\/([a-z0-9-]{1,100})$/.exec(path);
        if (candidateView && req.method === 'GET') {
          json(res, await sessions.candidateView(candidateView[1]!, url.searchParams.get('session') ?? undefined)); return;
        }
        if (req.method === "GET" && path === "/api/v1/config") {
          const selected=(await new ProviderProfiles(sessions.paths.home).list()).selection;
          const stored = await sessions.config.describe(), runtime = await sessions.settings();
          json(res, {
            workspace: sessions.workspace,
            ...stored,
            configured: !!runtime.apiKey || !!(selected.work??selected.main),
            storedCredentialConfigured: stored.configured,
            runtimeDefault: { model: runtime.model, baseUrl: runtime.baseUrl, configured: !!runtime.apiKey, overrides: { model: sessions.options.model !== undefined, baseUrl: sessions.options.baseUrl !== undefined, credential: sessions.options.apiKey !== undefined } },
            modelPurposes: selected,
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
            const mode = url.searchParams.get("mode"), targetId = url.searchParams.get("target");
            if (mode !== null && mode !== "work" && mode !== "create") throw new ApiError(400, "mode", "模式无效");
            if (targetId !== null && !/^[a-f0-9]{64}$/.test(targetId)) throw new ApiError(400, "target", "目标身份无效");
            json(
              res,
              await sessions.list(
                integer(url.searchParams.get("offset"), 0),
                Math.max(1, integer(url.searchParams.get("limit"), 30, 100)),
                url.searchParams.get("revision") ?? undefined,
                { mode: mode ?? undefined, targetId: targetId ?? undefined },
              ),
            );
            return;
          }
          if (req.method === "POST") {
            const v = object(await body(req));
            if (v.version !== 1 || typeof v.title !== "string")
              throw new ApiError(400, "input", "会话参数无效");
            const creation = v.mode !== undefined || v.commandId !== undefined || v.target !== undefined ? parseSessionCreation(v) : undefined;
            json(res, await sessions.create(v.title, creation), 201);
            return;
          }
        }
        const handoff = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/(handoff-references|handoff-preview|handoff-summary|handoff-summary-cancel|handoff-confirm|handoff-recover|handoffs|deliveries)$/.exec(path);
        if (handoff && req.method === "GET" && handoff[2] === "handoff-references") { json(res, await sessions.handoffReferenceOptions(handoff[1]!)); return; }
        if (handoff && req.method === "GET" && handoff[2] === "handoffs") { json(res, await sessions.handoffStates(handoff[1]!)); return; }
        if (handoff && req.method === "GET" && handoff[2] === "deliveries") { json(res, await sessions.deliveries(handoff[1]!)); return; }
        if (handoff && req.method === "POST") {
          const value = object(await body(req)), sessionId = handoff[1]!;
          if (handoff[2] === "handoff-preview") json(res, await sessions.handoffPreview(sessionId, value));
          else if (handoff[2] === "handoff-summary-cancel") json(res, await sessions.cancelHandoffPreparation(sessionId, value.commandId));
          else if (handoff[2] === "handoff-confirm") json(res, await sessions.confirmHandoff(sessionId, value));
          else if (handoff[2] === "handoff-recover") json(res, await sessions.recoverHandoff(sessionId, value));
          else if (["handoffs", "deliveries", "handoff-references"].includes(handoff[2]!)) throw new ApiError(405, "method", "交接状态只接受读取");
          else {
            const reading = new AbortController(); res.once("close", () => reading.abort(new Error("摘要客户端断开")));
            json(res, await sessions.prepareHandoff(sessionId, value, reading.signal));
          }
          return;
        }
        const match = path.match(
          /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/(interactions|answer|changes|diff|snapshot|events|submit|cancel|evidence|artifacts|export|context|context-details|inspection|inspection-image|trace|delete|deletion-preview|handoff-relations|diagnostics)(?:\/([a-f0-9]+))?$/,
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
        if (req.method === "GET" && action === "handoff-relations") {
          json(res, safeView(await sessions.handoffRelations(sessionId))); return;
        }
        if (req.method === "GET" && action === "deletion-preview") {
          json(res, safeView(await sessions.deletionPreview(sessionId))); return;
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
            ...await sessions.context(entry),
            ...entry.projection.page(
              integer(url.searchParams.get("before"), Number.MAX_SAFE_INTEGER),
              60,
              url.searchParams.has("after") ? integer(url.searchParams.get("after"), 0) : undefined,
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
                sessions.activeFor(sessionId)?.runId,
              ),
            ),
          );
          return;
        }
        if (req.method === "GET" && action === "inspection-image" && match[3]) {
          const image=await inspectionImage(entry,match[3]);res.writeHead(200,{'content-type':image.mime,'content-length':image.bytes.length,'x-content-type-options':'nosniff','cache-control':'no-store','content-security-policy':"default-src 'none'"});res.end(image.bytes);return;
        }
        if (req.method === "GET" && action === "inspection") {
          json(res,inspectSession(entry,sessionId,{group:url.searchParams.get('group')??undefined,run:url.searchParams.get('run')??undefined,runBefore:integer(url.searchParams.get('runBefore'),Number.MAX_SAFE_INTEGER),parent:url.searchParams.get('parent')??undefined,node:url.searchParams.get('node')??undefined,attempt:url.searchParams.get('attempt')??undefined,offset:integer(url.searchParams.get('offset'),0),attemptOffset:integer(url.searchParams.get('attemptOffset'),0),eventOffset:integer(url.searchParams.get('eventOffset'),0)},sessions.activeFor(sessionId)?.runId)); return;
        }
        if (req.method === "GET" && action === "context-details") {
          json(res, await contextDetails(sessions, entry, sessionId, {handoffOffset:integer(url.searchParams.get('handoffOffset'),0),checkpoint:url.searchParams.get('checkpoint')??undefined,referenceOffset:integer(url.searchParams.get('referenceOffset'),0),snapshotBefore:integer(url.searchParams.get('snapshotBefore'),Number.MAX_SAFE_INTEGER),snapshot:url.searchParams.get('snapshot')??undefined,offset:integer(url.searchParams.get('offset'),0),decision:url.searchParams.get('decision')??undefined,compactionBefore:integer(url.searchParams.get('compactionBefore'),Number.MAX_SAFE_INTEGER)})); return;
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
          if (sessions.activeFor(sessionId))
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
      // SPA 页面路径（无扩展名的 GET）回退到 index.html，支撑前端路由深链接刷新；
      // /api 与未知扩展名资源仍按原规则拒绝。
      const page = path === "/" || (!path.includes(".") && /^\/[a-zA-Z0-9/_-]*$/.test(path));
      if (!page && !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path))
        throw new ApiError(404, "not_found", "页面不存在");
      const file = join(staticDir, page ? "index.html" : path.slice(1));
      const resource = await resolveResource(staticDir, file);
      if (!resource)
        throw new ApiError(403, "path", "资源路径无效");
      // 每个 HTML 响应独立 nonce；不写日志、不进入 Journal / API 响应（S1 静态页面内容安全策略）。
      const nonce = page ? randomBytes(16).toString("base64") : undefined;
      res.setHeader(
        "content-security-policy",
        [
          "default-src 'self'",
          "script-src 'self'",
          nonce ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "worker-src 'self'",
          `frame-src ${origin}/api/v1/panels/`,
          "base-uri 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
        ].join("; "),
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
      const bytes = await readFile(resource);
      res.end(nonce ? Buffer.from(bytes.toString("utf8").replaceAll("__CSP_NONCE__", nonce)) : bytes);
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
    }).finally(() => releaseMutation?.());
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
    async coreSwitchStatus() { return { blockers: [...switchGate.blockers(), ...await sessions.coreSwitchBlockers()] }; },
    prepareCoreSwitch(token: string) { return switchGate.prepare(token, () => sessions.beginCoreSwitch(token)); },
    async releaseCoreSwitch(token: string) { await sessions.endCoreSwitch(token); switchGate.release(token); },
    async close() {
      abort.abort();
      await sessions.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
