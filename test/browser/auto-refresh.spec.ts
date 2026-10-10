import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";

/**
 * 3.11 自动刷新取代手动刷新：聚焦/重连自动重新读取；聚焦只发 GET；
 * 交接事件经 SSE 到达后交接卡自动更新，无需手动刷新。
 */
let app: Awaited<ReturnType<typeof startWeb>>;

test.beforeEach(async () => {
  app = await startWeb({
    workspace: await temporary(),
    home: await temporary(),
    naming: false,
    apiKey: key,
    staticDir: resolve("dist/web-dist"),
    runtime: { fetch: async () => { await delay(20); return response([textItem("完成")]); } },
  });
});

test.afterEach(async () => {
  await app.close();
});

test("window focus refetches with GET only; handoff cards update via SSE without manual refresh", async ({ page, context }) => {
  // 另一“窗口”新建会话后，当前窗口聚焦即自动出现
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/")) requests.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await expect(page.getByRole("button", { name: "+ 新任务", exact: true })).toBeVisible();
  const before = requests.length;

  const other = await context.newPage();
  await other.goto(`${app.origin}/work#token=${app.token}`);
  await other.getByRole("button", { name: "+ 新任务", exact: true }).click();
  await expect(other).toHaveURL(/\/work\/session\//);

  // 聚焦当前窗口：会话列表自动更新，且只有 GET
  requests.length = 0;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "未命名任务" }).first()).toBeVisible();
  const writes = requests.filter((entry) => !entry.startsWith("GET"));
  expect(writes, `聚焦产生了写请求：${writes.join(", ")}`).toEqual([]);
  expect(before).toBeGreaterThanOrEqual(0);
  await other.close();

  // 交接事件：从 create 会话发起交接到 work 会话，work 侧卡片经 SSE 自动出现
  const work = await app.sessions.create("工作接收");
  const create = await app.sessions.create("创造来源", { commandId: "src-create", mode: "create", target: { kind: "extension", root: await temporary(), scope: "project" } });
  await page.goto(`${app.origin}/work/session/${work.id}`);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await expect(page.getByText("交接与交付", { exact: true })).toHaveCount(0);

  // 通过 API 完成一次真实交接（等价于另一窗口操作）
  const authHeaders = {
    "content-type": "application/json",
    origin: app.origin,
    authorization: `Bearer ${app.token}`,
  };
  const preview = await (
    await fetch(`${app.origin}/api/v1/sessions/${create.id}/handoff-preview`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ version: 1, target: { sessionId: work.id }, goal: "自动刷新验证", summary: "s", constraints: [], references: [] }),
    })
  ).json();
  const confirmed = await fetch(`${app.origin}/api/v1/sessions/${create.id}/handoff-confirm`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ version: 1, confirmed: true, commandId: crypto.randomUUID(), payloadHash: preview.payloadHash, draft: { version: 1, target: { sessionId: work.id }, goal: "自动刷新验证", summary: "s", constraints: [], references: [] } }),
  });
  expect(confirmed.status).toBe(200);

  // SSE 事件驱动失效后卡片自动出现（无需开发者视图或手动刷新）
  await expect(page.getByText("交接与交付", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("收到交接：自动刷新验证")).toBeVisible();
});
