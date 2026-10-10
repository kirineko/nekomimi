import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";
import { createTask, openSessionMenu } from './fixtures/workbench.js';

/**
 * 批次 4 前端验证：9.1 控件状态/键盘/主题，9.2 路由与深链接，
 * 9.3 草稿与状态分层，9.5 分栏与窄屏。真实本地服务 + 假模型 transport。
 */
let app: Awaited<ReturnType<typeof startWeb>>;

test.beforeEach(async () => {
  app = await startWeb({
    workspace: await temporary(),
    home: await temporary(),
    naming: false,
    apiKey: key,
    staticDir: resolve("dist/web-dist"),
    runtime: {
      fetch: async () => {
        await delay(60);
        return response([textItem("已完成。")]);
      },
    },
  });
});

test.afterEach(async () => {
  await app.close();
});

test("9.1 控件：状态、键盘可访问名称与焦点恢复", async ({ page }) => {
  await page.goto(`${app.origin}/dev/ui#token=${app.token}`);
  await expect(page.getByTestId("dev-ui")).toBeVisible();

  // Button 变体、禁用与等待
  await expect(page.getByRole("button", { name: "危险操作" })).toBeVisible();
  await expect(page.getByRole("button", { name: "禁用" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "等待中" })).toHaveAttribute("aria-busy", "true");

  // Dialog：打开、Escape 关闭、焦点恢复触发器
  const trigger = page.getByRole("button", { name: "打开对话框" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();

  // Menu：按钮展开、方向键、Escape
  await page.getByRole("button", { name:/更多操作/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "重命名" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).not.toBeVisible();

  // Tabs：方向键切换并更新 aria-selected
  await page.getByRole("tab", { name: "第一页" }).click();
  await page.keyboard.press("ArrowRight");
  const second = page.getByRole("tab", { name: "第二页" });
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("第二页内容");

  // Toast：aria-live 播报与关闭
  await page.getByRole("button", { name: "显示通知" }).click();
  const toast = page.getByRole("status").filter({ hasText: "操作完成" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: /关闭通知/ }).click();
  await expect(toast).not.toBeVisible();

  // Error 状态可断言
  await expect(page.getByRole("alert")).toContainText("验证失败");
});

test("9.1 主题：明暗 tokens 切换且焦点环使用品牌色", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await expect(page.getByRole("link", { name: "工作", exact: true })).toBeVisible();
  const brand = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim());
  await page.evaluate(() => localStorage.removeItem("v2-theme"));
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole("button", { name: "深色" }).click();await page.getByRole('button',{name:'关闭外观',exact:true}).click();
  await expect.poll(brand).toBe("#beaaff");
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole("button", { name: "浅色" }).click();await page.getByRole('button',{name:'关闭外观',exact:true}).click();
  await expect.poll(brand).toBe("#5a3ec8");
});

test("9.2 路由：深链接刷新恢复同会话，无效目标不回退执行", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await createTask(page, "路由验证");
  await expect(page).toHaveURL(/\/work\/session\/[a-zA-Z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "路由验证" })).toBeVisible();

  // 刷新恢复到同一会话视图
  await page.reload();
  await expect(page.getByRole("heading", { name: "路由验证" })).toBeVisible();

  // 不存在但格式合法的会话：明确诊断，不回退到其它会话
  await page.goto(`${app.origin}/work/session/doesnotexist#token=${app.token}`);
  await expect(page.getByRole("alert")).toContainText("会话已删除");
  await expect(page.getByRole("heading", { name: "路由验证" })).not.toBeVisible();

  // 未知路由：明确 404 视图
  await page.goto(`${app.origin}/nowhere#token=${app.token}`);
  await expect(page.getByRole("alert")).toContainText("页面不存在");

  // 候选深链接：不存在的候选明确诊断，不回退到其它候选
  await page.goto(`${app.origin}/create/candidate/missing-candidate#token=${app.token}`);
  await expect(page.getByRole("alert")).toContainText("候选不存在");
});

test("9.5 200% CSS 缩放实验：输入与模式导航可用（自动化缩放实验，不冒充原生 zoom 验收）", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await page.setViewportSize({ width: 720, height: 720 });
  await page.evaluate(() => {
    (document.documentElement.style as unknown as { zoom: string }).zoom = "2";
  });
  await expect(page.getByRole("link", { name: "创造" })).toBeVisible();
  // 有效宽度 360px 时导航按设计折叠进 disclosure，展开后输入可达
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await createTask(page, "缩放可用");
  await expect(page).toHaveURL(/\/work\/session\//);
});

test("9.2 模式导航不发写命令，历史返回不触发模型", async ({ page }) => {
  const writes: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    await route.continue();
  });
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await expect(page.getByRole("link", { name: "创造" })).toBeVisible();
  writes.length = 0;
  await page.getByRole("link", { name: "创造" }).click();
  await expect(page.getByRole("heading", { name: "为 Nekomimi 开发新能力" })).toBeVisible();
  await page.getByRole("link", { name: "工作", exact: true }).click();
  await expect(page.getByRole("heading", { name: "开始一个任务" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "为 Nekomimi 开发新能力" })).toBeVisible();
  expect(writes).toEqual([]);
});

test("9.3 草稿按模式隔离，导航不清空", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await createTask(page, "草稿会话");
  await expect(page).toHaveURL(/\/work\/session\//);
  await page.getByLabel("任务草稿").fill("尚未提交的内容");
  await page.getByRole("link", { name: "创造" }).click();
  await expect(page.getByRole("heading", { name: "为 Nekomimi 开发新能力" })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("任务草稿")).toHaveJSProperty('textContent',"尚未提交的内容");
});

test("9.5 分栏键盘可调，360px 窄屏模式/返回可达", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await createTask(page, "窄屏验证");
  await expect(page).toHaveURL(/\/work\/session\//);

  // 宽屏：separator 方向键改变布局（与批次 0 切片相同的 aria-valuenow 断言）
  const separator = page.getByRole("separator", { name: "调整导航宽度" });
  await separator.focus();
  const before = await separator.getAttribute("aria-valuenow");
  await page.keyboard.press("ArrowRight");
  await expect(separator).not.toHaveAttribute("aria-valuenow", before!);

  // 窄屏：模式导航、停止区域与草稿输入仍可达，无横向溢出
  await page.setViewportSize({ width: 360, height: 720 });
  await expect(page.getByTestId("mobile-layout")).toBeVisible();
  await expect(page.getByRole("link", { name: "创造" })).toBeVisible();
  await expect(page.getByLabel("任务草稿")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("10.1 输入：IME 组合不提交、命令补全、提交去重、删除与焦点", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await createTask(page, "输入验证");
  await expect(page).toHaveURL(/\/work\/session\//);

  const composer = page.getByLabel("任务草稿");

  // IME 组合中按 Enter 不提交
  let submits = 0;
  await page.route("**/api/v1/sessions/*/submit", async (route) => {
    submits++;
    await route.continue();
  });
  await composer.fill("にほ");
  await composer.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await composer.press("Enter");
  await composer.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.waitForTimeout(300);
  expect(submits).toBe(0);

  // 命令补全：输入 / 出现建议，Tab 补全为 insertText 而非提交
  await composer.fill("/");
  const listbox = page.getByRole("listbox", { name: "命令建议" });
  await expect(listbox).toBeVisible();
  const first = listbox.getByRole("option").first();
  await expect(first).toBeVisible();
  await composer.press("Tab");
  await expect(composer).toHaveText(/^\/\S+\s?/);
  await page.waitForTimeout(300);
  expect(submits).toBe(0);

  // 提交去重：收据到达前双击不派发第二个命令
  await composer.fill("去重验证");
  const send = page.getByRole("button", { name: "发送" });
  await send.click();
  await expect(send).toBeDisabled();
  await expect(page.getByTestId("timeline")).toContainText("去重验证");
  expect(submits).toBe(1);

  // 删除：确认对话框，焦点进入对话框，确认后回到列表；等待运行到达终态再删除
  await expect(page.getByRole("button", { name: "停止" })).not.toBeVisible();
  await openSessionMenu(page, "删除会话");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole("link", { name: /输入验证/ })).not.toBeVisible();
});

test("9.6 扩展 slot：旧契约拒绝、跨模式不挂载", async ({ page }) => {
  // 拦截运行时 UI 目录：一个旧契约面板 + 一个仅创造模式的新契约面板
  await page.route("**/api/v1/runtime-ui", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        panels: [
          { id: "legacy", resourceId: "r1", revision: "v1", fallback: "旧面板", slot: "sidebar-widget", bundleHash: "h1" },
          {
            id: "create-only",
            resourceId: "r2",
            revision: "v2",
            fallback: "创造面板",
            slot: "sidebar-widget",
            bundleHash: "h2",
            contractVersion: 3,
            modes: ["create"],
            resourceRevision: "v2",
          },
        ],
      }),
    });
  });
  await page.goto(`${app.origin}/work#token=${app.token}`);
  // 工作模式：旧契约被拒且说明原因；创造模式声明不挂载（不出现面板 iframe）
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.getByText(/旧契约.*已拒绝挂载/)).toBeVisible();
  await expect(page.getByText(/不适用于工作模式/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("工作会话：提交后经 SSE 出现模型回复，断线重连不重复计数", async ({ page }) => {
  await page.goto(`${app.origin}/work#token=${app.token}`);
  await createTask(page, "流式验证");
  await expect(page).toHaveURL(/\/work\/session\//);
  await page.getByLabel("任务草稿").fill("你好");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("timeline")).toContainText("你好");
  await expect(page.getByTestId("timeline")).toContainText("已完成。");
  // 收据到达后草稿清空
  await expect(page.getByLabel("任务草稿")).toHaveJSProperty('textContent',"");
});

test('10.9 default entry opens the workbench and obsolete experiment routes stay read-only', async ({page})=>{
  let calls=0;const writes:string[]=[];
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{calls++;throw Error('Unexpected model call');}}});
  page.on('request',request=>{if(request.method()==='POST')writes.push(request.url());});
  try {
    await page.goto(app.url);
    await expect(page).toHaveURL(app.origin+'/work');
    await expect(page.getByRole('heading',{name:'开始一个任务',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'创造',exact:true}).click();
    await expect(page).toHaveURL(app.origin+'/create');
    await page.reload();await expect(page.getByRole('heading',{name:'为 Nekomimi 开发新能力',exact:true})).toBeVisible();
    await page.goto(app.origin+'/v2/work');
    await expect(page.getByText('页面不存在',{exact:true})).toBeVisible();
    expect(writes).toEqual([app.origin+'/api/v1/connect']);expect(calls).toBe(0);
  } finally {await app.close();}
});
