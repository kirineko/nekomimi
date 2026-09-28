import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { temporary } from "../helpers.js";

function management(): any {
  return { panels: [], workflows: [], workflowDefinitions: [], providers: [],
    providerProfiles: { revision: 1, entries: {}, selection: {} }, oauth: [], packages: [], packageCandidates: [], candidates: [], managed: [], resources: [], userWrites: false, settingsRevision: 1, busy: false, mcp: [], activeResources: [], receipts: [] };
}
function populated() {
  const data = management();
  data.providers = [{ id: "example-chat", resourceId: "provider-resource", revision: "v1", models: [{ id: "fixture-model", name: "Fixture 模型", protocol: "chat-completions" }] }];
  for (let i = 0; i < 8; i++) data.providerProfiles.entries[`profile-${i}`] = { id: `profile-${i}`, providerId: "example-chat", model: `model-${i}`, baseUrl: "https://fixture.invalid/v1" };
  return data;
}
async function fixture(page: Page, data: any, post?: (body: any) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>) {
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve("dist/web-dist") });
  const writes: any[] = [];
  let reads = 0, loadFailure = false;
  await page.route("**/api/v1/customization", async route => {
    if (route.request().method() === "GET") {
      reads++;
      await route.fulfill(loadFailure ? { status: 503, json: { error: { message: "测试加载失败" } } } : { json: data });
    } else {
      const body = route.request().postDataJSON(); writes.push(body);
      const response = await post?.(body);
      await route.fulfill({ status: response?.status ?? 200, json: response?.json ?? {} });
    }
  });
  await page.goto(app.url);
  return { app, writes, reads: () => reads, failLoading: (value: boolean) => { loadFailure = value; } };
}
async function open(page: Page) { await page.getByRole("button", { name: "定制能力", exact: true }).click(); await page.getByRole("tab", {name:/模型/}).click(); }
async function tab(page: Page, name: string) {
  if (name === '工作流与面板') { await page.getByRole('tab',{name:/管理/}).click(); await page.getByRole('button',{name,exact:true}).click(); return; }
  const selected = page.getByRole("tab", { name: new RegExp(name === '资源' ? '管理' : name) });
  await selected.click();
  await expect(selected).toHaveAttribute('aria-selected','true');
}
async function choose(page: Page, name: string, option: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("option", { name: new RegExp(option) }).click();
}
async function edit(page: Page) {
  await page.getByRole("button", { name: "＋ 新增配置" }).click();
  await page.getByLabel("模型配置名称").fill("new-profile");
  await choose(page, "自定义 Provider", "example-chat");
  await page.getByLabel("Provider 服务地址").fill("https://fixture.invalid/v1");
}

test("empty studio has explicit loading recovery, safe navigation and keyboard focus containment", async ({ page }) => {
  const f = await fixture(page, management());
  try {
    f.failLoading(true); await open(page);
    await expect(page.getByRole("alert")).toContainText("加载失败");
    await expect(page.getByText("尚未发现资源", { exact: false })).not.toBeVisible();
    f.failLoading(false); await page.getByRole("button", { name: "重试加载" }).click();
    await expect(page.getByRole("button", { name: "主对话模型", exact: true })).toContainText("默认 DeepSeek");
    await expect(page.getByRole("form", { name: "模型配置" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "备份并迁移原 DeepSeek 配置" })).not.toBeVisible();
    const modelTab = page.getByRole("tab", { name: /模型/ });
    await modelTab.focus(); await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: /管理/ })).toBeFocused();
    await page.keyboard.press("ArrowLeft"); await expect(modelTab).toBeFocused();
    await page.keyboard.press("Home"); await expect(page.getByRole("tab",{name:/我的定制/})).toBeFocused(); await modelTab.click();
    await page.getByRole("button", { name: "＋ 新增配置" }).click();
    await expect(page.getByText("还没有已启用的自定义 Provider。")).toBeVisible();
    await page.getByRole("button", { name: "前往资源，启用 Provider" }).click();
    await expect(page.getByRole("tab", { name: /管理/ })).toHaveAttribute("aria-selected", "true");
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]') && !document.activeElement?.closest('[hidden]'))).toBe(true);
    }
    expect(f.writes).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "定制能力", exact: true })).toBeFocused();
  } finally { await f.app.close(); }
});

test("model selection supports search, keyboard, cancellation, failures and independent persisted purposes", async ({ page }) => {
  const data = populated(); let fail = true;
  const f = await fixture(page, data, body => {
    if (fail) return { status: 409, json: { error: { message: "版本冲突，请重试" } } };
    data.providerProfiles.selection[body.purpose] = body.id; data.providerProfiles.revision++;
    return {};
  });
  try {
    await open(page);
    const trigger = page.getByRole("button", { name: "主对话模型", exact: true });
    await trigger.click(); await expect(page.getByRole("option", { selected: true })).toBeFocused();
    await page.keyboard.press("End"); await expect(page.getByRole("option", { name: /profile-7/ })).toBeFocused();
    await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: /profile-0/ })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    expect(f.writes).toHaveLength(0); await expect(page.getByRole("dialog")).toBeVisible();
    await trigger.click(); await page.getByLabel("搜索主对话模型").fill("no-matches");
    await expect(page.getByText("没有匹配的选项")).toBeVisible();
    await page.getByLabel("搜索主对话模型").fill("profile-3");
    await page.getByRole("option", { name: /profile-3/ }).click();
    await expect(page.getByRole("alert")).toContainText("版本冲突");
    await expect(trigger).toContainText("默认 DeepSeek");
    fail = false; await choose(page, "主对话模型", "profile-3");
    await expect(trigger).toContainText("profile-3");
    await expect(page.getByRole("button", { name: "辅助调用模型", exact: true })).toContainText("默认 DeepSeek");
    await page.getByRole("button", { name: "关闭定制能力" }).click(); await open(page);
    await expect(trigger).toContainText("profile-3");
    expect(f.writes.map(body => body.purpose)).toEqual(["main", "main"]);
  } finally { await f.app.close(); }
});

test("draft survives polling, revision failure and partial credential success but cancellation clears it", async ({ page }) => {
  const data = populated(); let fail = true;
  const f = await fixture(page, data, body => {
    if (body.action === "provider-save") {
      if (fail) { data.providerProfiles.revision = 2; return { status: 409, json: { error: { message: "配置版本冲突" } } }; }
      data.providerProfiles.entries[body.profile.id] = body.profile;
      data.providerProfiles.revision++; return {};
    }
    return {};
  });
  try {
    await open(page); await edit(page);
    await page.getByLabel("Provider API key").fill("fixture-secret");
    const before = f.reads(); await expect.poll(f.reads).toBeGreaterThan(before);
    await expect(page.getByLabel("Provider API key")).toBeFocused();
    await tab(page, "资源"); await tab(page, "模型");
    await expect(page.getByLabel("模型配置名称")).toHaveValue("new-profile");
    await page.getByRole("button", { name: "授权并保存模型配置" }).click();
    await expect(page.getByRole("alert")).toContainText("配置版本冲突");
    await expect(page.getByLabel("Provider API key")).toHaveValue("");
    await expect(page.getByLabel("模型配置名称")).toHaveValue("new-profile");
    expect(f.writes.filter(body => body.action === "provider-save")).toHaveLength(1);
    fail = false; await page.getByRole("button", { name: "授权并保存模型配置" }).click();
    await expect(page.getByRole("status")).toContainText("模型配置已保存");
    await expect(page.getByRole("form", { name: "模型配置" })).toHaveCount(0);
    const saves = f.writes.filter(body => body.action === "provider-save");
    expect(saves[1].profile.credentialRef).toBe("new-profile"); expect(saves[1].revision).toBe(2);
    expect(f.writes.filter(body => body.action === "provider-credential")).toHaveLength(1);
    expect(await page.locator("body").textContent()).not.toContain("fixture-secret");
    await edit(page); await page.getByLabel("Provider API key").fill("cancelled-secret");
    const count = f.writes.length; await page.getByRole("button", { name: "取消编辑" }).click();
    await page.getByRole("button", { name: "＋ 新增配置" }).click();
    await expect(page.getByLabel("模型配置名称")).toHaveValue("");
    await expect(page.getByLabel("Provider API key")).toHaveValue(""); expect(f.writes).toHaveLength(count);
    await page.getByRole("button", { name: "关闭定制能力" }).click(); await open(page);
    await expect(page.getByRole("region", { name: "已保存模型配置" })).toContainText("new-profile");
  } finally { await f.app.close(); }
});

test("closing during a submitted save reads its result on reopen without submitting twice", async ({ page }) => {
  const data = populated(); let release!: () => void;
  const submitted = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(page, data, async body => {
    if (body.action === "provider-save") { await submitted; data.providerProfiles.entries[body.profile.id] = body.profile; }
    return {};
  });
  try {
    await open(page); await edit(page);
    await page.getByRole("button", { name: "授权并保存模型配置" }).click();
    await expect.poll(() => f.writes.length).toBe(1);
    await page.getByRole("button", { name: "关闭定制能力" }).click(); release();
    await open(page); await expect(page.getByRole("region", { name: "已保存模型配置" })).toContainText("new-profile");
    expect(f.writes).toHaveLength(1);
  } finally { release(); await f.app.close(); }
});

test("studio screenshots cover long content, error summaries, responsive controls and reduced motion", async ({ page }) => {
  test.setTimeout(90_000);
  const data = populated();
  data.resources = [
    { id: "skill", name: "代码审查小助手", kind: "skill", scope: "project", status: "enabled", source: ".agents/skills/code-review/SKILL.md", hash: "a".repeat(64), description: "帮你检查代码中的细节。" },
    { id: "provider-resource", name: "自定义模型供应商-with-a-very-long-unbroken-name".repeat(2), kind: "extension", scope: "project", status: "untrusted", source: "/very-long-path/" + "provider-resource/".repeat(15), hash: "b".repeat(64) },
    { id: "broken", name: "等待修复的扩展", kind: "extension", scope: "user", status: "error", error: "index.ts:12: 无法加载扩展，旧版本继续运行。", source: "extensions/broken/index.ts", hash: "c".repeat(64), shadowedBy: "project-extension" },
  ];
  data.activeResources = [{ ...data.resources[2], hash: "d".repeat(64) }];
  data.workflows = [{ id: "flow", resourceId: "resource", definitionId: "代码审查", definitionRevision: "v1", schemaVersion: 1, status: "unknown", revision: 2, step: "write", error: "结果未知，请核对外部效果。" }];
  const f = await fixture(page, data);
  const folder = "output/playwright/customization-studio"; await mkdir(folder, { recursive: true });
  try {
    await open(page);
    await expect(page.getByRole("tab", { name: /管理/ })).toContainText("2");

    for (const [name, width, height, zoom] of [["desktop",1440,900,1],["mobile",390,844,1],["narrow",360,800,1],["zoom-200",1440,900,2]] as const) {
      // Browser zoom changes the CSS viewport and device scale together; CSS zoom does not.
      await page.setViewportSize({ width: width / zoom, height: height / zoom });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: width / zoom, height: height / zoom, deviceScaleFactor: zoom, mobile: false });

      await tab(page, "模型");
      await page.screenshot({ animations: "disabled", path: `${folder}/${name}-models.png` });
      await edit(page);
      await page.screenshot({ animations: "disabled", path: `${folder}/${name}-editor.png` });
      await expect(page.getByRole("button", { name: "关闭定制能力" })).toBeInViewport();
      await page.getByRole("button", { name: "自定义 Provider", exact: true }).click();
      await expect(page.getByRole("option", { name: "example-chat", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "取消编辑" }).click();
      await tab(page, "资源");
      await page.locator(".customization-resource").nth(1).locator("summary").click();
      await page.screenshot({ animations: "disabled", path: `${folder}/${name}-resources.png` });
      expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await tab(page, "工作流与面板");
      await expect(page.getByRole("region", { name: "核对未知结果" })).toBeVisible();
      await page.screenshot({ animations: "disabled", path: `${folder}/${name}-workflows.png` });
      await cdp.detach();
    }

    await tab(page, "模型");
    const palette = await page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return [
        { name: "正文", foreground: style(".customization-purpose strong").color, background: style(".customization-models").backgroundColor, minimum: 4.5 },
        { name: "辅助文字", foreground: style(".customization-purpose small").color, background: style(".customization-models").backgroundColor, minimum: 4.5 },
        { name: "主按钮", foreground: style(".customization-primary").color, background: style(".customization-primary").backgroundColor, minimum: 4.5 },
        { name: "控件边框", foreground: style(".customization-choice-trigger").borderTopColor, background: style(".customization-choice-trigger").backgroundColor, minimum: 3 },
        { name: "选中页签边框", foreground: style('.customization-tabs [aria-selected="true"]').borderTopColor, background: style('.customization-tabs [aria-selected="true"]').backgroundColor, minimum: 3 },
      ];
    });
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    const contrast = palette.map(pair => { const a = luminance(pair.foreground), b = luminance(pair.background); return { ...pair, ratio: (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05) }; });
    for (const pair of contrast) expect(Number.isFinite(pair.ratio), pair.name).toBe(true);
    await writeFile(`${folder}/contrast.json`, JSON.stringify(contrast, null, 2));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".customization-close")).toHaveCSS("transition-duration", "0s");
    expect(f.writes).toEqual([]);
  } finally { await f.app.close(); }
});

test("validates fields, exposes endpoint scope and requires explicit recovery of an unknown credential write", async ({ page }) => {
  const data = populated(); let failCredential = true;
  const f = await fixture(page, data, body => {
    if (body.action === "provider-credential" && failCredential) return { status: 503, json: { error: { message: "无法确认凭证保存" } } };
    if (body.action === "provider-save") data.providerProfiles.entries[body.profile.id] = body.profile;
    return {};
  });
  try {
    await open(page); await edit(page);
    const save = page.getByRole("button", { name: "授权并保存模型配置" });
    await page.getByLabel("模型配置名称").fill("INVALID NAME"); await save.click(); expect(f.writes).toHaveLength(0);
    await page.getByLabel("模型配置名称").fill("new-profile");
    await page.getByLabel("Provider 服务地址").fill("invalid-url"); await save.click(); expect(f.writes).toHaveLength(0);
    await page.getByLabel("Provider 服务地址").fill("https://fixture.invalid/v1");
    await expect(page.locator(".customization-editor .customization-notice")).toContainText("/chat/completions");
    await page.getByText("高级请求设置", { exact: true }).click();
    await page.getByLabel("Provider 请求路径").fill(""); await save.click(); expect(f.writes).toHaveLength(0);
    await page.getByLabel("Provider 请求路径").fill("/custom-path");
    await page.getByText("高级请求设置", { exact: true }).click();
    await expect(page.locator(".customization-editor .customization-notice")).toContainText("/custom-path");
    await page.getByLabel("Provider API key").fill("unknown-secret"); await save.click();
    await expect(page.getByRole("alert")).toContainText("凭证写入结果未确认");
    await expect(page.getByLabel("Provider API key")).toHaveValue("");
    await save.click(); expect(f.writes).toHaveLength(1);
    failCredential = false; await page.getByLabel("Provider API key").fill("replacement-secret"); await save.click();
    await expect(page.getByRole("status")).toContainText("模型配置已保存");
    expect(f.writes.filter(body => body.action === "provider-save")).toHaveLength(1);
  } finally { await f.app.close(); }
});

test("resource diagnostics preserve active versions and display deferred changes without hidden writes", async ({ page }) => {
  const data = management();
  data.busy = true; data.degraded = "仍在使用旧版本";
  data.receipts = [{ id: "receipt", status: "failed", error: "broken/index.ts:3: 语法错误" }];
  const resource = { id: "broken", name: "broken", kind: "extension", scope: "project", status: "error", error: "语法错误", source: "broken/index.ts", hash: "b".repeat(64), shadowedBy: "project-override" };
  data.resources = [resource]; data.activeResources = [{ ...resource, hash: "a".repeat(64) }];
  const f = await fixture(page, data);
  try {
    await open(page);
    await expect(page.getByRole("dialog")).toContainText("资源变更将在任务结束后生效");
    await tab(page,"资源"); await page.getByText("加载记录",{exact:true}).click();
    await expect(page.getByRole("dialog")).toContainText("重载：失败");
    await expect(page.getByRole("tab", { name: /管理/ })).toContainText("1");
    await tab(page, "资源");
    await expect(page.locator(".customization-resource")).toContainText("配置待生效");
    await page.getByText("资源详情 · 来源与诊断", { exact: true }).click();
    await expect(page.locator(".customization-resource")).toContainText("发现版本 bbbbbbbbbbbb · 当前版本 aaaaaaaaaaaa");
    await expect(page.locator(".customization-resource")).toContainText("project-override");
    expect(f.writes).toEqual([]);
  } finally { await f.app.close(); }
});
