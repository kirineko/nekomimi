import { readArtifact } from './read-artifact.js';
import { test, expect } from "@playwright/test";
import { startWeb } from "../../src/server/app.js";
import { temporary, key, response, textItem, callItem, reasoning, delay, } from "../helpers.js";
import { createTask, openEvidence } from './fixtures/workbench.js';
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
let app: Awaited<ReturnType<typeof startWeb>>;
let calls = 0;
test.beforeEach(async () => {
    calls = 0;
    app = await startWeb({
        workspace: await temporary(),
        home: await temporary(), naming: false,
        apiKey: key,
        staticDir: resolve("dist/web-dist"),
        runtime: {
            fetch: async (_u, init) => {
                calls++;
                const body = JSON.parse(String(init?.body));
                const prompt = body.input.filter((i: any) => i.role === "user" && !i.content?.[0]?.text?.startsWith("[Runtime environment data;")).at(-1)?.content[0]
                    ?.text ?? "";
                if (prompt.includes("wait"))
                    return await new Promise<Response>((_r, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("cancel")), { once: true }));
                await delay(100);
                return calls === 1
                    ? response([
                        reasoning,
                        callItem("write", {
                            path: "hello.txt",
                            content: "hello browser\n",
                        }),
                    ])
                    : response([
                        textItem("## 任务已完成\n\n- **写入**文件\n- 验证结果\n\n| 文件 | 状态 |\n| --- | --- |\n| hello.txt | 完成 |\n\n```ts\nconst ready = true;\n```\n\n<script>window.hacked=true</script>\n\n[危险](javascript:alert(1))\n\n![远程图片](https://example.com/track.png)"),
                    ]);
            },
        },
    });
});
test.afterEach(async () => {
    await app.close();
});
async function openSession(page: import('@playwright/test').Page, title = '工作台验收') {
    const session = await app.sessions.create(title);
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    return session;
}
test("submits, observes tool diff, inspects request, reloads, continues and exports", async ({ page, context }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const session = await openSession(page);
    await page.getByLabel('任务草稿', { exact: true }).fill('write a greeting');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    await expect.poll(() => calls).toBe(2);
    expect(await readFile(join(app.sessions.workspace, 'hello.txt'), 'utf8')).toBe('hello browser\n');
    const rich = page.locator('[data-rich-content]');
    await expect(rich.locator('h2')).toHaveText('任务已完成');
    await expect(rich.getByRole('table')).toBeVisible();
    await expect(rich.locator('pre code')).toContainText('const ready = true;');
    await expect(rich.locator('img,script,a[href^="javascript:"]')).toHaveCount(0);
    await expect(page).toHaveTitle('Nekomimi');
    await page.getByRole('button', { name: /查看文件 diff/ }).click();
    await expect(page.locator('[data-change-kind="add"]')).toContainText('hello browser');
    await openEvidence(page);
    const inspection = page.getByRole('dialog', { name: '调用证据', exact: true });
    await inspection.getByRole('button', { name: '展开子调用（1）', exact: true }).click();
    await expect(inspection.getByRole('list', { name: '调用树', exact: true })).toContainText('write');
    await inspection.getByRole('button', { name: 'write · 完成', exact: true }).click();
    const selected = inspection.getByRole('region', { name: '所选调用证据' });
    await selected.getByText(/#\d+ · tool.result/).click();
    await expect(selected).toContainText('hello.txt');
    await inspection.getByRole('button', { name: 'work · 完成', exact: true }).last().click();
    await selected.getByRole('combobox', { name: '证据分组', exact: true }).selectOption('request');
    await selected.getByText(/#\d+ · request.dispatched/).click();
    const request = await readArtifact(selected);
    expect(request).toContain('tool_choice');
    expect(request).toContain('write a greeting');
    expect(JSON.parse(request).input).toBeInstanceOf(Array);
    await selected.getByRole('combobox', { name: '证据分组', exact: true }).selectOption('response');
    await selected.getByText(/#\d+ · response.chunk/).first().click();
    const rawResponse = await readArtifact(selected);
    expect(rawResponse).toContain('response.output_text.delta');
    expect(rawResponse).toContain('任务已完成');
    await selected.getByRole('combobox', { name: '证据分组', exact: true }).selectOption('sources');
    await selected.getByText(/#\d+ · context.view/).click();
    await selected.getByRole('button', { name: '查看此请求的上下文', exact: true }).click();
    const details = page.getByRole('dialog', { name: '上下文详情', exact: true });
    await expect(details.getByLabel('请求选择清单')).toContainText('选入');
    await page.keyboard.press('Escape');
    await expect(inspection).toBeVisible();
    await page.screenshot({ path: info.outputPath('trace.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(inspection).toBeInViewport();
    expect(await inspection.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('trace-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '关闭调用证据', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    await expect.poll(() => calls).toBe(2);
    const second = await context.newPage();
    await second.goto(page.url());
    await expect(second.getByText('已完成', { exact: true }).first()).toBeVisible();
    expect(calls).toBe(2);
    await page.bringToFront();
    await page.getByLabel('任务草稿', { exact: true }).fill('continue');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => calls).toBe(3);
    await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as any).hacked)).toBeUndefined();
    await page.getByRole('button', { name:'设置',exact:true }).click();
    await page.getByRole('menuitem', { name:'导出当前会话',exact:true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 HTML' }).click();
    expect((await downloading).suggestedFilename()).toBe(`session-${session.id}.html`);
    await page.getByRole('button', { name: '关闭导出' }).click();
    await openEvidence(page);
    await expect(inspection.getByRole('list', { name: '调用树', exact: true })).toContainText('work');
    await page.screenshot({ path: info.outputPath('workbench.png') });
    expect(errors).toEqual([]);
});
test('cancels and remains usable on a narrow viewport', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSession(page);
    await page.getByLabel('任务草稿', { exact: true }).fill('wait');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    await expect.poll(() => calls).toBe(1);
    await page.context().setOffline(true);
    await expect(page.getByText('已断线，重连中', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await page.context().setOffline(false);
    await expect(page.getByText('已断线，重连中', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByText('已停止', { exact: true }).first()).toBeVisible();
    expect(calls).toBe(1);
    await page.getByRole('button', { name: '会话', exact: true }).click();
    await expect(page.getByRole('button', { name: '+ 新任务', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('mobile.png') });
});
test('windows long history and pages context sources beyond a raw artifact page', async ({ page }) => {
    const { Journal } = await import('../../src/journal.js');
    const session = await app.sessions.create('长历史验收'), entry = await app.sessions.entry(session.id), j = await Journal.open(entry.directory);
    try {
        for (let i = 0; i < 250; i++)
            await j.append('context.add', { source: 'user', item: { role: 'user', content: [{ type: 'input_text', text: `历史 ${i}` }] } }, {}, false);
    }
    finally {
        await j.close();
    }
    // Capture a real request snapshot containing more than one artifact page.
    await app.sessions.submit(session.id, { version: 1, commandId: 'long-history-request', prompt: 'read saved history' });
    await app.sessions.activeFor(session.id)?.done;
    expect(calls).toBe(2);
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    // Two successful calls and the empty terminal status are folded; all 60 saved rows remain in the history window.
    await expect(page.locator('[data-row-id]')).toHaveCount(57);
    for (const count of [117, 177, 180]) {
        await page.getByRole('button', { name: '查看更早', exact: true }).click();
        await expect(page.locator('[data-row-id]')).toHaveCount(count);
        await expect(page.getByRole('navigation', { name: '历史导航' })).toHaveAttribute('aria-busy', 'false');
    }
    const surface = page.getByTestId('timeline');
    await surface.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 })); el.scrollTop = 50; el.dispatchEvent(new Event('scroll')); });
    const live = await Journal.open(entry.directory);
    const updates = (async () => { try {
        for (let i = 0; i < 8; i++) {
            await live.append('context.add', { items: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `持续输出 ${i}` }] }] }, { runId: 'stream-fixture', attemptId: 'stream-fixture' });
            await delay(60);
        }
    }
    finally {
        await live.close();
    } })();
    const started = Date.now();
    await page.getByLabel('任务草稿', { exact: true }).fill('长历史下的输入响应测试');
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent', '长历史下的输入响应测试');
    console.log(`180-row input fill and assertion: ${Date.now() - started}ms`);
    await updates;
    await expect(page.getByText('有新消息', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '返回最新', exact: true })).toBeVisible();
    expect(await surface.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(100);
    await page.getByRole('button', { name: '返回最新', exact: true }).click();
    await expect(page.getByText('持续输出 7', { exact: true })).toBeInViewport();
    await expect(page.locator('[data-row-id]')).toHaveCount(57);
    await expect(page.getByRole('button', { name: '返回最新', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent', '长历史下的输入响应测试');
    await page.getByRole('button',{name:/^上下文/}).click();
    const details = page.getByRole('dialog', { name: '上下文详情', exact: true }), selection = details.getByLabel('请求选择清单');
    await expect(selection.locator('details')).toHaveCount(40);
    const first = await selection.textContent();
    await details.getByRole('button', { name: '下一页选择', exact: true }).click();
    await expect(selection.locator('details')).toHaveCount(40);
    await expect(details).toContainText('选择清单偏移 40');
    expect(await selection.textContent()).not.toBe(first);
    await selection.locator('summary').first().click();
    await expect(selection.locator('pre').first()).toContainText('eventId');
    await details.getByRole('button', { name: '读取完整请求快照', exact: true }).click();
    await expect(details.getByRole('button', { name: '继续读取附件', exact: true })).toBeEnabled();
    await details.getByRole('button', { name: '继续读取附件', exact: true }).click();
    await expect(details).toContainText('偏移 12000');
    expect(calls).toBe(2);
});
test('compact layout preserves controls and inspector focus at all target sizes', async ({ page }) => {
    await openSession(page);
    await page.getByLabel('任务草稿', { exact: true }).fill('整理项目结构');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
    for (const [width, height] of [[1440, 900], [1920, 1080], [1280, 720], [390, 844]]) {
        await page.setViewportSize({ width: width!, height: height! });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByLabel('任务草稿', { exact: true })).toBeInViewport();
        const trigger = page.getByRole('button', { name: '会话操作', exact: true });
        await openEvidence(page);
        await expect(page.getByRole('button', { name: '关闭调用证据', exact: true })).toBeFocused();
        await expect(page.getByRole('dialog', { name: '调用证据', exact: true })).toBeInViewport();
        if (process.env.NEKOMIMI_VISUAL_DIR)
            await page.screenshot({ path: join(process.env.NEKOMIMI_VISUAL_DIR, `inspector-${width}.png`) });
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
    }
});
test('shows and downloads diagnostics even when durable cursor and status do not change', async ({ page }) => {
    const session = await openSession(page, '诊断测试');
    await expect(page.getByText('从一个清晰的任务开始', { exact: true })).toBeVisible();
    const entry = await app.sessions.entry(session.id), before = entry.reader.cursor.seq;
    entry.diagnostics.push({ version: 1, id: 'diagnostic-test', timestamp: new Date().toISOString(), sessionId: session.id, operation: 'watermark.rename', code: 'EPERM', category: 'storage', platform: 'win32', nodeVersion: 'v22.19.0', seq: before + 1, durableSeq: before });
    const notice = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'watermark.rename' }) });
    await expect(notice.locator('summary')).toContainText('watermark.rename');
    await notice.locator('summary').click();
    const downloading = page.waitForEvent('download');
    await notice.getByRole('button', { name: '下载诊断', exact: true }).click();
    const data = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
    expect(data.authoritative).toBe(false);
    expect(data.diagnostics[0].code).toBe('EPERM');
    expect(entry.reader.cursor.seq).toBe(before);
});
