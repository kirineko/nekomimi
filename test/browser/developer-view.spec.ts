import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";
import { enableDeveloperView, chooseSetting } from "./fixtures/workbench.js";

/**
 * 2.6 开发者视图非权威：开关只改变显示。两种状态下提交任务的请求体完全一致；
 * 切换开关本身不产生任何 API 写请求。
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

test("toggle emits no writes and submissions are identical in both states", async ({ page }) => {
  const writes: { url: string; body: string }[] = [];
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    if (request.method() === "POST" && !request.url().endsWith("/connect"))
      writes.push({ url: request.url(), body: request.postData() ?? "" });
    void route.continue();
  });

  const sessionA = await app.sessions.create("状态对比 A");
  const sessionB = await app.sessions.create("状态对比 B");

  // 关闭状态提交
  await page.goto(`${app.origin}/work/session/${sessionA.id}#token=${app.token}`);
  await page.getByLabel("任务草稿", { exact: true }).fill("同一任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible();

  // 切换开关：只允许 connect 之外的零写请求
  const before = writes.length;
  await chooseSetting(page, "开发者视图");
  await expect(page.locator("html[data-developer-view]")).toHaveCount(1);
  expect(writes.length, "开启开发者视图产生写请求").toBe(before);

  // 开启状态提交
  await page.goto(`${app.origin}/work/session/${sessionB.id}`);
  await page.getByLabel("任务草稿", { exact: true }).fill("同一任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible();

  // 两次 submit 的请求体除 commandId 外完全一致
  const submits = writes.filter((write) => write.url.endsWith("/submit"));
  expect(submits).toHaveLength(2);
  const normalize = (body: string) => {
    const value = JSON.parse(body);
    delete value.commandId;
    return JSON.stringify(value);
  };
  expect(normalize(submits[0]!.body)).toBe(normalize(submits[1]!.body));

  // 再次关闭开关也不产生写请求
  const before2 = writes.length;
  await chooseSetting(page, "开发者视图");
  await expect(page.locator("html[data-developer-view]")).toHaveCount(0);
  expect(writes.length, "关闭开发者视图产生写请求").toBe(before2);
});

test("default view hides internal terms and L2 chrome; developer view shows them", async ({ page }) => {
  const session = await app.sessions.create("术语检查");
  // 默认视图：无内部术语、无眉标、无原始状态
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  const { expectNoInternalTerms } = await import("./fixtures/workbench.js");
  await expectNoInternalTerms(page);
  await expect(page.locator("[data-dev-value]")).toHaveCount(0);
  await expect(page.locator("[data-dev-eyebrow]")).toHaveCount(0);

  // 空工作台 / 创造首页同样干净
  await page.goto(`${app.origin}/work`);
  await expectNoInternalTerms(page);
  await page.goto(`${app.origin}/create`);
  await expectNoInternalTerms(page);

  // 开发者视图：眉标与原始状态可见
  const { enableDeveloperView } = await import("./fixtures/workbench.js");
  await enableDeveloperView(page);
  await page.goto(`${app.origin}/work/session/${session.id}`);
  await expect(page.locator("[data-dev-eyebrow]").first()).toBeVisible();
  await expect(page.locator("[data-dev-value]").first()).toBeVisible();
});

test("toggle syncs across windows without losing drafts or dialogs", async ({ page, context }) => {
  const session = await app.sessions.create("双窗口同步");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await page.getByLabel("任务草稿", { exact: true }).fill("未提交草稿");
  const second = await context.newPage();
  await second.goto(`${app.origin}/work/session/${session.id}`);

  await chooseSetting(page, "开发者视图");
  await expect(page.locator("html[data-developer-view]")).toHaveCount(1);
  await expect(second.locator("html[data-developer-view]")).toHaveCount(1);
  await expect(second.locator("[data-dev-eyebrow]").first()).toBeVisible();

  await chooseSetting(page, "开发者视图");
  await expect(second.locator("html[data-developer-view]")).toHaveCount(0);
  await expect(page.getByLabel("任务草稿", { exact: true })).toContainText("未提交草稿");
  await second.close();
});
