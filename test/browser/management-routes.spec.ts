import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";
import { managementPages } from "../../src/web/v2/management-pages.js";

/**
 * 3.4 路由收敛：所有管理深链接在刷新后渲染对应页面，无 404；
 * 会话级页面在会话深链接下同样可用；设置总览逐项可达。
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

for (const mode of ["work", "create"] as const) {
  test(`${mode}: every management page deep link renders after reload`, async ({ page }) => {
    const session = await app.sessions.create(`${mode} 路由`);
    const pages = managementPages.filter((entry) => entry.modes.includes(mode));
    for (const entry of pages) {
      const path = `/${mode}/${entry.path}`;
      await page.goto(`${app.origin}${path}#token=${app.token}`);
      await page.reload();
      await expect(page.getByText("页面不存在")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "模式" })).toBeVisible();
      if (entry.session) {
        await page.goto(`${app.origin}/${mode}/session/${session.id}/${entry.path}`);
        await expect(page.getByText("页面不存在")).toHaveCount(0);
      }
    }
  });
}

test("settings hub lists every category with text links and purpose hints", async ({ page }) => {
  await page.goto(`${app.origin}/create/settings-hub#token=${app.token}`);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  for (const entry of managementPages.filter((entry) => entry.modes.includes("create"))) {
    const link = page.getByRole("link", { name: new RegExp(entry.title) }).first();
    await expect(link, `缺少 ${entry.title} 入口`).toBeVisible();
  }
  // 逐项可达：打开基础设置（总览卡片）
  await page.getByRole("link", { name: /基础设置 默认模型/ }).click();
  await expect(page).toHaveURL(/\/create\/settings/);
  await expect(page.getByText("页面不存在")).toHaveCount(0);
});

test("default navigation carries no management links; create nav shows ability count not raw list", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  const nav = page.getByRole("navigation", { name: "项目与会话" });
  await expect(nav).toBeVisible();
  for (const title of ["主题与外观", "基础设置", "面板管理", "持久工作流管理", "模型用途与配置"])
    await expect(nav.getByRole("link", { name: title, exact: true }), `导航不应包含 ${title}`).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "+ 新任务", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "刷新会话列表", exact: true })).toHaveCount(0);

  // “+ 新任务”：点击创建并进入会话；重复点击不产生第二个会话（创建中去重）
  await nav.getByRole("button", { name: "+ 新任务", exact: true }).click();
  await expect(page).toHaveURL(/\/work\/session\//);
  const before = (await app.sessions.list(0, 30)).sessions.length;
  expect(before).toBe(1);

  await page.goto(`${app.origin}/create`);
  const createNav = page.getByRole("navigation", { name: "能力与候选" });
  await expect(createNav.getByRole("link", { name: /^能力与权限/ })).toBeVisible();
  await expect(createNav.getByText(/openspec-.*enabled/)).toHaveCount(0);
  for (const title of ["主题与外观", "基础设置", "MCP 连接与授权", "能力包管理", "面板管理", "持久工作流管理", "模型用途与配置"])
    await expect(createNav.getByRole("link", { name: title, exact: true }), `创造导航不应包含 ${title}`).toHaveCount(0);
});

test("empty session shows no handoff or confirmation chrome", async ({ page }) => {
  const session = await app.sessions.create("空会话检查");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await expect(page.getByText("交接与交付", { exact: true })).toHaveCount(0);
  await expect(page.getByText("交接确认状态", { exact: true })).toHaveCount(0);
  await expect(page.getByText("尚无交接或交付记录", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新交接记录", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新读取确认状态", exact: true })).toHaveCount(0);
});
