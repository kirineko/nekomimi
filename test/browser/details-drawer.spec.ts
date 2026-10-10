import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";

/**
 * 3.1/3.2 两栏布局与详情抽屉：宽屏默认无详情栏；抽屉开合保持挂载与焦点；
 * 窄屏导航/详情为覆盖层且互不覆盖。
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

test("wide layout defaults to two columns; drawer opens, keeps content mounted and restores focus", async ({ page }) => {
  const session = await app.sessions.create("抽屉检查");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();

  // 默认：无详情侧栏，主区宽度 >= 70%
  await expect(page.getByRole("complementary", { name: "详情" })).toBeHidden();
  const main = await page.locator("[data-panel][id='main']").boundingBox();
  expect(main!.width).toBeGreaterThanOrEqual(1440 * 0.7);

  // 打开“变更”：抽屉出现并定位到变更标签，内容挂载
  await page.getByRole("button", { name: "变更", exact: true }).click();
  const aside = page.getByRole("complementary", { name: "详情" });
  await expect(aside).toBeVisible();
  await expect(aside.getByRole("tab", { name: "变更", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(aside.getByRole("button", { name: "关闭详情" })).toBeFocused();

  // Escape 关闭：焦点回到“变更”按钮
  await page.keyboard.press("Escape");
  await expect(aside).toBeHidden();
  await expect(page.getByRole("button", { name: "变更", exact: true })).toBeFocused();

  // 再次打开仍挂载（同一 tab 状态保留）
  await page.getByRole("button", { name: "变更", exact: true }).click();
  await expect(aside).toBeVisible();
});

test("narrow viewport: nav and details are separate overlays", async ({ page }) => {
  const session = await app.sessions.create("窄屏抽屉");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await page.setViewportSize({ width: 390, height: 844 });

  // “会话”打开导航覆盖层
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(page.locator(".workbench-shell[data-nav-open]")).toHaveCount(1);
  // 打开详情后导航覆盖层关闭（互不覆盖）
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.locator(".workbench-shell[data-nav-open]")).toHaveCount(0);
  await expect(page.locator(".workbench-shell[data-details-open]")).toHaveCount(1);

  // 模式切换、发送仍可达；无页面级横向溢出
  await expect(page.getByRole("link", { name: "工作", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("任务草稿", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
