import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { temporary } from "../helpers.js";
function management(): any {
    return { panels: [], workflows: [], workflowDefinitions: [], providers: [],
        providerProfiles: { revision: 1, entries: {}, selection: {} }, oauth: [], packages: [], packageCandidates: [], candidates: [], managed: [], resources: [], userWrites: false, settingsRevision: 1, busy: false, mcp: [], activeResources: [], receipts: [], abilities: [], defaultModel: { model: "deepseek-flash", configured: false }, managedRevision: 0, packageRevisions: { project: 0, user: 0 } };
}
function populated() {
    const data = management();
    data.providers = [{ id: "example-chat", resourceId: "provider-resource", revision: "v1", models: [{ id: "fixture-model", name: "Fixture 模型", protocol: "chat-completions", operation: "chat", identity: "fixture-chat", profileStates: [], available: false, credentialStatus: "missing" }] }];
    for (let i = 0; i < 8; i++)
        data.providerProfiles.entries[`profile-${i}`] = { id: `profile-${i}`, providerId: "example-chat", model: `model-${i}`, baseUrl: "https://fixture.invalid/v1", resourceId: "provider-resource", paths: ["/chat/completions"] };
    return data;
}
async function fixture(page: Page, data: any, post?: (body: any) => {
    status?: number;
    json?: unknown;
} | Promise<{
    status?: number;
    json?: unknown;
}>) {
    const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve("dist/web-dist"), runtime: { fetch: async () => { throw Error("Unexpected model call"); } } });
    const writes: any[] = [];
    let reads = 0, loadFailure = false;
    let readGate: Promise<void> | undefined;
    await page.route("**/api/v1/customization", async (route) => {
        if (route.request().method() === "GET") {
            reads++;
            await readGate;
            await route.fulfill(loadFailure ? { status: 503, json: { error: { message: "测试加载失败" } } } : { json: data });
        }
        else {
            const body = route.request().postDataJSON();
            writes.push(body);
            const response = await post?.(body);
            await route.fulfill({ status: response?.status ?? 200, json: response?.json ?? {} });
        }
    });
    await page.goto(app.origin + "/create#token=" + app.token);
    // 应用在 connect 完成后才挂载：等待渲染，避免后续 goto 中断授权导致无 cookie
    await page.getByRole("navigation", { name: "模式" }).waitFor();
    return { app, writes, pauseRead: () => { let release!: () => void; readGate = new Promise<void>(resolve => { release = resolve; }); return () => { readGate = undefined; release(); }; }, reads: () => reads, failLoading: (value: boolean) => { loadFailure = value; } };
}
async function open(page: Page) { await tab(page, "模型"); }
async function tab(page: Page, name: string) {
    const path = name === "资源" ? "resources" : name === "工作流与面板" ? "workflows" : "models";
    const url = new URL(page.url());
    await page.goto(`${url.origin}/create/${path}`);
}
async function choose(page: Page, name: string, option: string) {
    await page.getByRole("button", { name: `选择${name}`, exact: true }).click();
    await page.getByLabel(`${name}配置`, { exact: true }).selectOption(option);
    await page.getByRole("button", { name: "确认用途选择", exact: true }).click();
}
async function edit(page: Page) {
    await page.getByRole("button", { name: "新增模型配置", exact: true }).click();
    await page.getByLabel("模型配置名称").fill("new-profile");
    await page.getByLabel("模型 Provider", { exact: true }).selectOption("example-chat");
    await page.getByLabel("模型与操作", { exact: true }).selectOption("fixture-chat");
    await page.getByLabel("Provider 服务地址").fill("https://fixture.invalid/v1");
}
test("empty management pages recover reads and modal choices contain keyboard focus without writes", async ({ page }) => {
    const f = await fixture(page, management());
    try {
        f.failLoading(true);
        await open(page);
        await expect(page.getByRole("alert")).toContainText("加载失败");
        await expect(page.getByText("尚无自定义配置。", { exact: true })).not.toBeVisible();
        f.failLoading(false);
        await page.getByRole("button", { name: "重新读取模型配置" }).click();
        await expect(page.getByText("默认 DeepSeek / deepseek-flash · 未配置凭证 · Responses", { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("region", { name: "新增模型配置" })).toHaveCount(0);
        const trigger = page.getByRole("button", { name: "选择工作对话模型", exact: true });
        await trigger.focus();
        await page.keyboard.press("Enter");
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press("Tab");
            expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]') && !document.activeElement?.closest('[hidden]'))).toBe(true);
        }
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await page.getByRole("button", { name: "新增模型配置", exact: true }).click();
        await expect(page.getByText("没有已启用的自定义 Provider。先在能力目录检查资源及授权。", { exact: true })).toBeVisible();
        await tab(page, "资源");
        await expect(page.getByRole("heading", { name: "能力与权限", exact: true })).toBeVisible();
        expect(f.writes).toEqual([]);
    }
    finally {
        await f.app.close();
    }
});
test("model choice supports keyboard focus, cancellation, failures and independent persisted purposes", async ({ page }) => {
    const data = populated();
    let fail = true;
    const f = await fixture(page, data, body => {
        if (fail)
            return { status: 409, json: { error: { message: "版本冲突，请重试" } } };
        data.providerProfiles.selection[body.purpose] = body.id;
        data.providerProfiles.revision++;
        return { json: data.providerProfiles };
    });
    try {
        await open(page);
        const trigger = page.getByRole("button", { name: "选择工作对话模型", exact: true });
        await trigger.click();
        const select = page.getByLabel("工作对话模型配置", { exact: true });
        await select.focus();
        await expect(select).toBeFocused();
        // Native option popups are OS-owned on macOS; selectOption exercises the
        // select/change contract while Tab and Escape verify the host dialog keys.
        await select.selectOption("profile-7");
        await expect(select).toHaveValue("profile-7");
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: "确认用途选择", exact: true })).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(select).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        expect(f.writes).toHaveLength(0);
        await choose(page, "工作对话模型", "profile-3");
        await expect(page.getByRole("alert")).toContainText("版本冲突");
        await expect(page.getByRole("button", { name: "确认用途选择", exact: true })).toBeDisabled();
        await page.getByRole("button", { name: "取消选择", exact: true }).click();
        await expect(trigger.locator('..')).toContainText("默认 DeepSeek");
        fail = false;
        await choose(page, "工作对话模型", "profile-3");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(trigger.locator('..')).toContainText("profile-3");
        await expect(page.getByRole("button", { name: "选择辅助调用模型", exact: true }).locator('..')).toContainText("默认 DeepSeek");
        await tab(page, "资源");
        await open(page);
        await expect(trigger.locator('..')).toContainText("profile-3");
        expect(f.writes.map(body => body.purpose)).toEqual(["work", "work"]);
    }
    finally {
        await f.app.close();
    }
});
test("draft survives read refresh, revision failure and partial credential success but cancellation clears it", async ({ page }) => {
    const data = populated();
    let fail = true;
    const f = await fixture(page, data, body => {
        if (body.action === "provider-save") {
            if (fail) {
                data.providerProfiles.revision = 2;
                return { status: 409, json: { error: { message: "配置版本冲突" } } };
            }
            data.providerProfiles.entries[body.profile.id] = body.profile;
            data.providerProfiles.revision++;
            return {};
        }
        return {};
    });
    try {
        await open(page);
        await edit(page);
        await page.getByLabel("Provider API key").fill("fixture-secret");
        const before = f.reads(), releaseRead = f.pauseRead();
        await page.getByRole("button", { name: "刷新模型目录", exact: true }).click();
        await expect.poll(f.reads).toBeGreaterThan(before);
        await page.getByLabel("Provider API key").focus();
        const refreshed = page.waitForResponse(response => response.url().endsWith("/customization") && response.request().method() === "GET");
        releaseRead();
        await refreshed;
        await expect(page.getByLabel("Provider API key")).toBeFocused();
        await expect(page.getByLabel("Provider API key")).toHaveValue("fixture-secret");
        await expect(page.getByLabel("模型配置名称")).toHaveValue("new-profile");
        await page.getByRole("button", { name: "授权并保存模型配置" }).click();
        await expect(page.getByRole("alert")).toContainText("配置版本冲突");
        await expect(page.getByLabel("Provider API key")).toHaveValue("");
        await expect(page.getByLabel("模型配置名称")).toHaveValue("new-profile");
        expect(f.writes.filter(body => body.action === "provider-save")).toHaveLength(1);
        fail = false;
        await page.getByRole("button", { name: "采用当前修订继续编辑", exact: true }).click();
        await page.getByRole("button", { name: "授权并保存模型配置" }).click();
        await expect(page.getByRole("region", { name: "已保存模型配置", exact: true })).toContainText("new-profile");
        await expect(page.getByRole("region", { name: "新增模型配置" })).toHaveCount(0);
        const saves = f.writes.filter(body => body.action === "provider-save");
        expect(saves[1].profile.credentialRef).toMatch(/^profile-/);
        expect(saves[1].revision).toBe(2);
        expect(f.writes.filter(body => body.action === "provider-credential")).toHaveLength(1);
        expect(await page.locator("body").textContent()).not.toContain("fixture-secret");
        await edit(page);
        await page.getByLabel("Provider API key").fill("cancelled-secret");
        const count = f.writes.length;
        await page.getByRole("button", { name: "取消编辑" }).click();
        await page.getByRole("button", { name: "新增模型配置", exact: true }).click();
        await expect(page.getByLabel("模型配置名称")).toHaveValue("");
        await expect(page.getByLabel("Provider API key")).toHaveValue("");
        expect(f.writes).toHaveLength(count);
        await tab(page, "资源");
        await open(page);
        await expect(page.getByRole("region", { name: "已保存模型配置" })).toContainText("new-profile");
    }
    finally {
        await f.app.close();
    }
});
test("closing during a submitted save reads its result on reopen without submitting twice", async ({ page }) => {
    const data = populated();
    let release!: () => void;
    const submitted = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(page, data, async (body) => {
        if (body.action === "provider-save") {
            await submitted;
            data.providerProfiles.entries[body.profile.id] = body.profile;
        }
        return {};
    });
    try {
        await open(page);
        await edit(page);
        await page.getByRole("button", { name: "授权并保存模型配置" }).click();
        await expect.poll(() => f.writes.length).toBe(1);
        await tab(page, "资源");
        release();
        await open(page);
        await expect(page.getByRole("region", { name: "已保存模型配置" })).toContainText("new-profile");
        expect(f.writes).toHaveLength(1);
    }
    finally {
        release();
        await f.app.close();
    }
});
test("studio screenshots cover long content, error summaries, responsive controls and reduced motion", async ({ page }) => {
    test.setTimeout(90000);
    const data = populated();
    data.resources = [
        { id: "skill", name: "代码审查小助手", kind: "skill", scope: "project", status: "enabled", source: ".agents/skills/code-review/SKILL.md", hash: "a".repeat(64), description: "帮你检查代码中的细节。" },
        { id: "provider-resource", name: "自定义模型供应商-with-a-very-long-unbroken-name".repeat(2), kind: "extension", scope: "project", status: "untrusted", source: "/very-long-path/" + "provider-resource/".repeat(15), hash: "b".repeat(64) },
        { id: "broken", name: "等待修复的扩展", kind: "extension", scope: "user", status: "error", error: "index.ts:12: 无法加载扩展，旧版本继续运行。", source: "extensions/broken/index.ts", hash: "c".repeat(64), shadowedBy: "project-extension" },
    ];
    data.activeResources = [{ ...data.resources[2], hash: "d".repeat(64) }];
    data.workflows = [{ mode: "create", id: "flow", resourceId: "resource", definitionId: "代码审查", definitionRevision: "v1", schemaVersion: 1, status: "unknown", revision: 2, step: "write", error: "结果未知，请核对外部效果。" }];
    const f = await fixture(page, data);
    const folder = "output/playwright/customization-studio";
    await mkdir(folder, { recursive: true });
    try {
        await open(page);
        await expect(page.getByRole("heading", { name: "模型用途与配置", exact: true })).toBeVisible();
        for (const [name, width, height, zoom] of [["desktop", 1440, 900, 1], ["mobile", 390, 844, 1], ["narrow", 360, 800, 1], ["zoom-200", 1440, 900, 2]] as const) {
            // Viewport/device-scale emulation, not a native browser zoom measurement.
            await page.setViewportSize({ width: width / zoom, height: height / zoom });
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Emulation.setDeviceMetricsOverride", { width: width / zoom, height: height / zoom, deviceScaleFactor: zoom, mobile: false });
            await expect(page.getByTestId(width / zoom <= 760 ? "mobile-layout" : "desktop-layout")).toBeVisible();
            await tab(page, "模型");
            await page.screenshot({ animations: "disabled", path: `${folder}/${name}-models.png` });
            await edit(page);
            await page.screenshot({ animations: "disabled", path: `${folder}/${name}-editor.png` });
            await expect(page.getByLabel("模型 Provider", { exact: true })).toBeVisible();
            await page.getByRole("button", { name: "取消编辑" }).click();
            await tab(page, "资源");
            await page.getByRole("region", { name: "能力目录", exact: true }).getByRole("article").nth(1).locator("summary").click();
            await page.screenshot({ animations: "disabled", path: `${folder}/${name}-resources.png` });
            expect(await page.getByRole("region", { name: "能力目录", exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
            await tab(page, "工作流与面板");
            await expect(page.getByRole("region", { name: "核对未知结果" })).toBeVisible();
            await page.screenshot({ animations: "disabled", path: `${folder}/${name}-workflows.png` });
            await cdp.detach();
        }
        await tab(page, "模型");
        await expect(page.getByRole("heading", { name: "模型用途与配置", exact: true })).toBeVisible();
        const palette = await page.evaluate(() => {
            const surface = getComputedStyle(document.querySelector('.ds')!).backgroundColor;
            const heading = getComputedStyle(document.querySelector('main h1')!);
            const muted = getComputedStyle(document.querySelector('main header p')!);
            const button = getComputedStyle(document.querySelector('main button[data-variant="default"]')!);
            return [{ name: "正文", foreground: heading.color, background: surface }, { name: "辅助文字", foreground: muted.color, background: surface }, { name: "主按钮", foreground: button.color, background: button.backgroundColor }];
        });
        const luminance = (color: string) => {
            const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
            return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
        };
        const contrast = palette.map(pair => { const a = luminance(pair.foreground), b = luminance(pair.background); return { ...pair, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
        for (const pair of contrast)
            expect(pair.ratio, pair.name).toBeGreaterThanOrEqual(4.5);
        await writeFile(`${folder}/contrast.json`, JSON.stringify(contrast, null, 2));
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(page.getByRole("button", { name: "新增模型配置", exact: true })).toHaveCSS("transition-duration", "0s");
        expect(f.writes).toEqual([]);
    }
    finally {
        await f.app.close();
    }
});
test("validates fields, exposes endpoint scope and requires explicit recovery of an unknown credential write", async ({ page }) => {
    const data = populated();
    let failCredential = true;
    const f = await fixture(page, data, body => {
        if (body.action === "provider-credential" && failCredential)
            return { status: 503, json: { error: { message: "无法确认凭证保存" } } };
        if (body.action === "provider-save")
            data.providerProfiles.entries[body.profile.id] = body.profile;
        return {};
    });
    try {
        await open(page);
        await edit(page);
        const save = page.getByRole("button", { name: "授权并保存模型配置" });
        await page.getByLabel("模型配置名称").fill("INVALID NAME");
        await save.click();
        expect(f.writes).toHaveLength(0);
        await page.getByLabel("模型配置名称").fill("new-profile");
        await page.getByLabel("Provider 服务地址").fill("invalid-url");
        await save.click();
        expect(f.writes).toHaveLength(0);
        await page.getByLabel("Provider 服务地址").fill("https://fixture.invalid/v1");
        await expect(page.getByRole("region", { name: "新增模型配置", exact: true })).toContainText("/chat/completions");
        await page.getByText("高级请求范围", { exact: true }).click();
        await page.getByLabel("Provider 请求路径").fill("");
        await save.click();
        expect(f.writes).toHaveLength(0);
        await page.getByLabel("Provider 请求路径").fill("/custom-path");
        await page.getByText("高级请求范围", { exact: true }).click();
        await expect(page.getByRole("region", { name: "新增模型配置", exact: true })).toContainText("/custom-path");
        await page.getByLabel("Provider API key").fill("unknown-secret");
        await save.click();
        await expect(page.getByRole("alert")).toContainText("无法确认凭证保存");
        await expect(page.getByLabel("Provider API key")).toHaveValue("");
        await save.click();
        expect(f.writes).toHaveLength(1);
        failCredential = false;
        await page.getByLabel("Provider API key").fill("replacement-secret");
        await save.click();
        await expect(page.getByRole("region", { name: "已保存模型配置", exact: true })).toContainText("new-profile");
        expect(f.writes.filter(body => body.action === "provider-save")).toHaveLength(1);
    }
    finally {
        await f.app.close();
    }
});
test("resource diagnostics preserve active versions and display deferred changes without hidden writes", async ({ page }) => {
    const data = management();
    data.busy = true;
    data.degraded = "仍在使用旧版本";
    data.receipts = [{ id: "receipt", status: "failed", error: "broken/index.ts:3: 语法错误" }];
    const resource = { id: "broken", name: "broken", kind: "extension", scope: "project", status: "error", error: "语法错误", source: "broken/index.ts", hash: "b".repeat(64), shadowedBy: "project-override" };
    data.resources = [resource];
    data.activeResources = [{ ...resource, hash: "a".repeat(64) }];
    const f = await fixture(page, data);
    try {
        await open(page);
        await tab(page, "资源");
        await expect(page.getByRole("status").filter({ hasText: "任务运行中" })).toBeVisible();
        await page.getByText("加载记录与诊断", { exact: true }).click();
        await expect(page.getByText("receipt · failed · broken/index.ts:3: 语法错误", { exact: true })).toBeVisible();
        const card = page.getByRole("article", { name: "资源 broken", exact: true });
        await expect(page.getByRole("alert").filter({ hasText: "仍在使用旧版本" })).toBeVisible();
        await card.getByText("来源、版本与权限", { exact: true }).click();
        await expect(card).toContainText("发现版本 " + "b".repeat(64));
        await expect(card).toContainText("活动版本 " + "a".repeat(64));
        await expect(card).toContainText("project-override");
        expect(f.writes).toEqual([]);
    }
    finally {
        await f.app.close();
    }
});
