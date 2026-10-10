import { readArtifact } from './read-artifact.js';
import { test, expect } from "@playwright/test";
import { startWeb } from "../../src/server/app.js";
import { temporary, key, reasoning, callItem, response, textItem, } from "../helpers.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createTask, gotoManagement, openDrawerTab, openEvidence } from './fixtures/workbench.js';
let app: Awaited<ReturnType<typeof startWeb>>;
let opened: string[];
let searchCalls = 0;
test.beforeEach(async () => {
    const workspace = await temporary();
    await mkdir(join(workspace, "src"));
    await writeFile(join(workspace, "src", "hello.txt"), "old\n");
    opened = [];
    let calls = 0;
    searchCalls = 0;
    app = await startWeb({
        workspace,
        home: await temporary(),
        apiKey: key,
        naming: false,
        staticDir: resolve("dist/web-dist"),
        openFile: async (path) => {
            opened.push(path);
        },
        runtime: {
            fetch: async (url) => {
                if (String(url).endsWith("/messages")) {
                    searchCalls++;
                    return Response.json({
                        content: [
                            { type: "server_tool_use", name: "web_search", id: "s" },
                            {
                                type: "web_search_tool_result",
                                tool_use_id: "s",
                                content: [
                                    {
                                        type: "web_search_result",
                                        title: "Node.js documentation",
                                        url: "https://nodejs.org/api/fs.html",
                                        snippet: "Filesystem API documentation",
                                    },
                                ],
                            },
                        ],
                        stop_reason: "end_turn",
                    });
                }
                calls++;
                if (calls === 1)
                    return response([
                        reasoning,
                        callItem("web_search", { query: "Node filesystem" }, "search"),
                    ]);
                if (calls === 2)
                    return response([
                        callItem("write", { path: "result.txt", content: "A new file\n" }, "write"),
                    ]);
                return response([
                    textItem("## 已完成\n\n已查询文档并新增 `result.txt`。"),
                ]);
            },
        },
    });
});
test.afterEach(async () => {
    await app?.close();
});
test("search, diff, locate, open and reload preserve evidence and draft", async ({ page, }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const session = await app.sessions.create('工作台文件验收');
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    await page.getByRole("textbox", { name: "任务草稿" }).fill("搜索并创建文件");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Node.js documentation/ })).toBeVisible();
    await expect(page.locator('[data-change-kind="add"]')).toContainText("A new file");
    const draft = page.getByRole("textbox", { name: "任务草稿" });
    await draft.fill("下一步草稿");
    await draft.focus();
    await expect(draft).toBeFocused();
    await page.getByRole("button", { name: "定位文件" }).click();
    const file = page.getByRole("treeitem", { name: /result.txt/ });
    await expect(file).toBeVisible();
    await file.click();
    expect(opened).toEqual([]);
    await file.dblclick();
    await expect(page.getByRole('status').filter({ hasText: '已提交给本机默认程序' })).toBeVisible();
    expect(opened).toHaveLength(1);
    await openDrawerTab(page,'变更');
    await expect(page.getByRole('region', { name: '会话文件修改' }).locator('[data-change-kind="add"]')).toContainText("A new file");
    await page.getByRole("tab", { name: "证据", exact: true }).click();
    await expect(draft).toHaveJSProperty('textContent', "下一步草稿");
    await openEvidence(page);
    const inspection = page.getByRole('dialog', { name: '调用证据', exact: true });
    await inspection.getByRole('button', { name: '展开子调用（1）', exact: true }).first().click();
    await inspection.getByRole('button', { name: 'web_search · 完成', exact: true }).click();
    await inspection.getByRole('list', { name: '子调用', exact: true }).getByRole('button', { name: '展开子调用（1）', exact: true }).click();
    await inspection.getByRole('button', { name: 'web-search · 完成', exact: true }).click();
    const selected = inspection.getByRole('region', { name: '所选调用证据' });
    await selected.getByRole('combobox', { name: '证据分组', exact: true }).selectOption('request');
    await selected.getByText(/#\d+ · request.dispatched/).click();
    expect(await readArtifact(selected)).toContain('web_search_20250305');
    await page.getByRole('button', { name: '关闭调用证据', exact: true }).click();
    await page.reload();
    await expect(page.locator('[data-change-kind="add"]')).toContainText("A new file");
    await page.getByRole('button', { name:'设置',exact:true }).click();
    await page.getByRole('menuitem', { name:'导出当前会话',exact:true }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 HTML" }).click();
    const download = await downloading;
    const html = await readFile((await download.path())!, "utf8");
    expect(html).toContain("Node.js documentation");
    expect(html).toContain("A new file");
    expect(searchCalls).toBe(1);
    expect(opened).toHaveLength(1);
    expect(errors).toEqual([]);
});
test("workspace API authentication and side effect boundary", async ({ request, }) => {
    expect((await request.get(app.origin + "/api/v1/workspace/files")).status()).toBe(401);
    const headers = { Authorization: `Bearer ${app.token}`, Origin: app.origin };
    expect((await request.post(app.origin + "/api/v1/workspace/open", {
        headers: { ...headers, Origin: "https://example.com" },
        data: { path: "src/hello.txt" },
    })).status()).toBe(403);
    expect((await request.post(app.origin + "/api/v1/workspace/open", {
        headers,
        data: { path: "../escape" },
    })).status()).toBe(403);
    expect(opened).toEqual([]);
});
test('files and settings remain usable at all viewports', async ({ page }, info) => {
    const session = await app.sessions.create('文件与设置');
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [390, 844]]) {
        await page.setViewportSize({ width: width!, height: height! });
        if (width! <= 760)
            await page.getByRole('button', { name: '详情', exact: true }).click();
        await openDrawerTab(page,'文件');
        const folder = page.getByRole('treeitem', { name: 'src', exact: true });
        if (await folder.getAttribute('aria-expanded') !== 'true')
            await folder.click();
        await expect(page.getByRole('treeitem', { name: /hello.txt/ })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`files-${width}.png`) });
        if (width! <= 760) {
            await page.keyboard.press('Escape');
            await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoManagement(page, '基础设置');
    await page.getByRole('switch', { name: /^网页搜索/ }).click();
    await page.getByRole('button', { name: '审阅并保存设置', exact: true }).click();
    await page.getByRole('button', { name: '确认保存设置', exact: true }).click();
    await expect(page.getByText('设置已保存。', { exact: true })).toBeVisible();
    expect((await app.sessions.config.snapshot()).search.enabled).toBe(false);
    await page.screenshot({ path: info.outputPath('settings.png') });
});
test("changes keep expanded history while new journal events arrive", async ({ page }) => {
    const session = await app.sessions.create('工作台文件验收');
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    const sessionId = session.id;
    let total = 120;
    await page.route("**/api/v1/sessions/*/changes?*", async (route) => {
        const url = new URL(route.request().url());
        const before = Number(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
        const after = Number(url.searchParams.get("after") ?? 0);
        const all = url.pathname.includes(sessionId) ? Array.from({ length: total }, (_, i) => ({
            id: `change-${i + 1}`, seq: i + 1, path: `file-${i + 1}.txt`, patch: { sha256: "a".repeat(64) },
        })).reverse().filter(c => c.seq < before && c.seq > after) : [];
        const changes = all.slice(0, 50);
        await route.fulfill({ json: { changes, nextBefore: all.length > 50 ? changes.at(-1)!.seq : undefined } });
    });
    await page.route("**/api/v1/sessions/*/diff/*", async (route) => {
        const url = new URL(route.request().url());
        const offset = Number(url.searchParams.get("offset"));
        const limit = Number(url.searchParams.get("limit"));
        const lines = Array.from({ length: Math.min(limit, 240 - offset) }, (_, i) => ({ kind: "add", text: `line ${offset + i}`, next: offset + i + 1 }));
        await route.fulfill({ json: { lines, total: 240, added: 240, removed: 0, offset, next: offset + limit < 240 ? offset + limit : undefined } });
    });
    await openDrawerTab(page,'变更');
    await expect(page.getByRole('region', { name: '会话文件修改' }).locator(':scope > article')).toHaveCount(50);
    await page.getByRole("button", { name: "更早的修改" }).click();
    await expect(page.getByRole('region', { name: '会话文件修改' }).locator(':scope > article')).toHaveCount(100);
    const entry = page.getByRole('region', { name: '会话文件修改' }).locator(':scope > article').filter({ has: page.locator('[title="file-80.txt"]') });
    await entry.getByRole("button", { name: "查看文件 diff" }).click();
    await entry.getByRole("button", { name: "下一段" }).click();
    await expect(entry).toContainText("121–240 / 240 行");
    await entry.evaluate(el => el.setAttribute("data-preserved", "yes"));
    total = 180; // More than one page arrives while the user reads older history.
    await page.getByRole("textbox", { name: "任务草稿" }).fill("继续执行");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: '会话文件修改' }).locator(':scope > article')).toHaveCount(160);
    await expect(entry).toHaveAttribute("data-preserved", "yes");
    await expect(entry).toContainText("121–240 / 240 行");
    await page.getByRole("button", { name: "更早的修改" }).click();
    await expect(page.getByRole('region', { name: '会话文件修改' }).locator(':scope > article')).toHaveCount(180);
    await expect(page.getByRole('region', { name: '会话文件修改' }).locator(':scope > article').last()).toContainText("记录 1 ·");
    await createTask(page);
    await expect(page.getByRole('region', { name: '会话文件修改' }).locator(':scope > article')).toHaveCount(0);
});
