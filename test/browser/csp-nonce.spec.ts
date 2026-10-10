import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";
import { collectCspViolations, openSessionMenu } from './fixtures/workbench.js';

/**
 * 1.2 前端 CSP nonce：打开各类对话框时宿主资源不产生 CSP 违规，
 * 且对话框打开时页面背景不可滚动（Radix 滚动锁生效 = 动态样式未被拦截）。
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

test("dialogs open without CSP violations and lock background scroll", async ({ page }) => {
  const violations = await collectCspViolations(page);
  const session = await app.sessions.create("CSP 检查");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();

  // 删除确认对话框（Radix Dialog）
  await openSessionMenu(page, "删除会话");
  await expect(page.getByRole("dialog")).toBeVisible();
  const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  expect(bodyOverflow).toBe("hidden");
  await page.keyboard.press("Escape");

  // 调用证据对话框（deferred chunk + Dialog）
  await openSessionMenu(page, "调用证据");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // 更多操作 → 外观对话框
  await page.getByRole("button", { name:"设置",exact:true }).click();
  await page.getByRole("menuitem", { name: "外观", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  expect(await violations(), "宿主资源触发 CSP 违规").toEqual([]);
});
