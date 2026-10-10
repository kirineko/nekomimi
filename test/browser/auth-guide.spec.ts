import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";

/**
 * 1.4 连接授权失效整页引导：未授权时只看到引导；授权失效后草稿保留；
 * 重新授权后恢复原路由，不产生重复写命令。
 */
let app: Awaited<ReturnType<typeof startWeb>>;

test.beforeEach(async () => {
  app = await startWeb({
    workspace: await temporary(),
    home: await temporary(),
    naming: false,
    apiKey: key,
    staticDir: resolve("dist/web-dist"),
    runtime: { fetch: async () => { await delay(30); return response([textItem("完成")]); } },
  });
});

test.afterEach(async () => {
  await app.close();
});

test("unauthorized access shows the full-page guide instead of scattered errors", async ({ page }) => {
  // 无 cookie 直接访问
  await page.goto(`${app.origin}/work`);
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "需要从终端打开 Nekomimi" })).toBeVisible();
  await expect(page.getByText("会话列表不可用")).toHaveCount(0);
  await expect(page.getByText("主题目录读取失败")).toHaveCount(0);
});

test("auth lost mid-session keeps the draft; retry restores the route without duplicate writes", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/v1/**", (route) => {
    if (route.request().method() === "POST") posts++;
    void route.continue();
  });
  const session = await app.sessions.create("授权引导");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await page.getByLabel("任务草稿", { exact: true }).fill("保留的草稿内容");

  // 模拟 cookie 失效：所有后续 API 返回 401 auth
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "auth", message: "连接授权已失效，请重新打开终端中的入口" } }),
    }),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByLabel("任务草稿", { exact: true })).toContainText("保留的草稿内容");
  expect(posts).toBe(1); // 只有一次提交，无自动重发

  const failures: string[] = [];
  page.on("response", (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  // 解除拦截，模拟用户已用终端链接重新授权
  await page.unrouteAll();
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(failures, `重载后出现错误响应`).toEqual([]);
  await expect(page.getByLabel("任务草稿", { exact: true })).toContainText("保留的草稿内容");
  expect(posts).toBeGreaterThanOrEqual(1); // 除首次提交外，仅有 connect，无隐藏写命令
  expect(posts).toBeLessThanOrEqual(2);
});
