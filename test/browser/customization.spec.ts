import { waitForPanelLayout } from './panel-layout.js';
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { temporary, key } from "../helpers.js";
import { Candidates } from "../../src/customization/candidates.js";
import { Packages } from "../../src/customization/packages.js";
// These scenarios include extension startup/cleanup, compilation, and management polling.
// Keep a finite integration budget without retrying any side effects.
const noModels = { fetch: async () => { throw Error("Unexpected model request"); } };
const expect = baseExpect.configure({ timeout: 20000 });
test.describe.configure({ timeout: 90000 });
async function activateFixture(app: Awaited<ReturnType<typeof startWeb>>, name: string) {
    await app.sessions.waitInitialization();
    const host = app.sessions.customization, resource = (await host.catalog.discover()).find(item => item.name === name)!;
    await host.catalog.decide(resource.id, true, true, (await host.catalog.decisions()).revision);
    await host.initialize();
}
async function confirm(page: Page, label: string) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/customization'));
    await page.getByRole('button', { name: `确认${label}`, exact: true }).click();
    const accepted = await response;
    expect(accepted.ok()).toBe(true);
    const result = await accepted.json() as {
        id?: string;
        status?: string;
    };
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return result;
}
test('previews an unactivated candidate panel and preserves its recorded result and sidebar declaration', async ({ page }) => {
    const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), draft = await store.scaffold('sidebar-panel');
    const { readFile } = await import('node:fs/promises');
    await writeFile(join(draft.path, 'extension.json'), JSON.stringify({ name: 'sidebar-panel', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['panels', 'commands', 'ui'] }));
    await writeFile(join(draft.path, 'index.ts'), (await readFile(resolve('extension-docs/panel-extension.ts'), 'utf8')).replace("slot:'tool-result'", "slot:'sidebar-widget'"));
    await copyFile(resolve('extension-docs/review-panel.ts'), join(draft.path, 'review-panel.ts'));
    const app = await startWeb({ workspace: await temporary(), home, apiKey: key, naming: false, staticDir: resolve('dist/web-dist'), runtime: noModels });
    try {
        const session = await app.sessions.create('候选面板', { mode: 'create', commandId: 'preview-panel', target: { kind: 'extension', root: workspace, scope: 'project' } });
        const path = `/create/session/${session.id}`, actions: string[] = [];
        page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization'))
            actions.push(request.postDataJSON().action); });
        await page.goto(app.origin + path + `/candidate/${draft.id}#token=` + app.token);
        await page.getByRole('tab', { name: '运行预览', exact: true }).click();
        await page.getByLabel('预览数据 JSON', { exact: true }).fill('{"items":["Unactivated candidate"]}');
        await page.getByLabel('我授权执行当前候选的预览代码', { exact: true }).check();
        await page.getByRole('button', { name: '运行候选预览', exact: true }).click();
        await expect(page.frameLocator('iframe').getByText('Unactivated candidate', { exact: true })).toBeVisible();
        expect(await store.active()).toHaveLength(0);
        await page.getByRole('tab', { name: '内容差异', exact: true }).click();
        await page.getByRole('tab', { name: '运行预览', exact: true }).click();
        await expect(page.locator('iframe')).toHaveCount(0);
        await page.getByLabel('我授权执行当前候选的预览代码', { exact: true }).check();
        await page.getByRole('button', { name: '打开已完成预览', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('预览实例已过期');
        await expect(page.locator('iframe')).toHaveCount(0);
        expect(actions.filter(action => action === 'candidate-execution-start')).toHaveLength(1);
        await page.getByRole('tab', { name: '验证记录', exact: true }).click();
        await page.getByRole('button', { name: '运行静态校验', exact: true }).click();
        await expect(page.getByText('静态校验：通过', { exact: true })).toBeVisible();
        await page.getByRole('tab', { name: '启用与导出', exact: true }).click();
        const activated = await confirm(page, '授权并启用候选');
        await expect(page.getByRole('region', { name: '候选加载收据', exact: true }).getByText(`${activated.id} · 加载完成`, { exact: true })).toBeVisible();
        await page.goto(app.origin + path);
        await page.getByLabel('任务草稿', { exact: true }).fill('/review-panel');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await expect(page.locator('[data-conversation-content]')).toContainText('审查结果');
        await page.getByRole('button', { name: '变更', exact: true }).click();
        await expect(page.getByRole('region', { name: '扩展区域 sidebar-widget', exact: true })).toContainText('审查面板');
        await expect(page.frameLocator('iframe').getByText('检查变更', { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.locator('[data-conversation-content]')).toContainText('审查结果');
        await expect(page.locator('iframe')).toHaveCount(0);
    }
    finally {
        await app.close();
    }
});
test('reconciles an unknown workflow result in the browser without repeating its external effect', async ({ page }) => {
    const workspace = await temporary(), home = await temporary(), root = join(workspace, '.nekomimi/extensions/unknown');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'unknown', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['workflows', 'tools'] }));
    await writeFile(join(root, 'index.ts'), `import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{api.registerWorkflow({id:'unknown-review',schemaVersion:1,inputSchema:{type:'object'},entry:'effect',steps:{effect:{transitions:[],async execute(_input,ctx){await ctx.callTool('write',{path:'external.txt',content:'one recorded effect'});throw Error('Injected failure after external effect');}}}})}) satisfies ExtensionFactory3;`);
    const options = { workspace, home, naming: false, staticDir: resolve('dist/web-dist'), runtime: noModels };
    let app = await startWeb(options);
    try {
        await activateFixture(app, 'unknown');
        await page.goto(app.origin + '/work/workflows#token=' + app.token);
        await page.getByText('启动新工作流', { exact: true }).click();
        await page.getByLabel('工作流定义', { exact: true }).selectOption({ index: 1 });
        await page.getByRole('button', { name: '启动工作流', exact: true }).click();
        await expect(page.getByRole('region', { name: '核对未知结果' })).toBeVisible({ timeout: 20000 });
        await app.close();
        app = await startWeb(options);
        await page.goto(app.origin + '/work/workflows#token=' + app.token);
        await expect(page.getByRole('region', { name: '核对未知结果' })).toBeVisible({ timeout: 20000 });
        await page.getByLabel('核对记录').fill('外部文件已核验，只执行过一次');
        await page.getByLabel('核对后的结果 JSON').fill('{"kind":"complete","output":{"verified":true}}');
        await page.getByRole('button', { name: '提交已核对结果' }).click();
        await expect(page.getByRole('article', { name: '工作流 unknown-review' })).toContainText('已完成');
        await page.getByRole('button', { name: '查看工作流证据' }).click();
        await expect(page.getByRole('region', { name: '工作流证据' })).toContainText('workflow.unknown.resolved');
        const { readdir, readFile } = await import('node:fs/promises'), { readSession } = await import('../../src/journal.js');
        const [flow] = await readdir(join(workspace, '.nekomimi/workflows'));
        const journal = await readSession(join(workspace, '.nekomimi/workflows', flow!));
        expect(journal.events.filter(e => e.type === 'tool.intent' && (e.payload as any).name === 'write')).toHaveLength(1);
        expect(await readFile(join(workspace, 'external.txt'), 'utf8')).toBe('one recorded effect');
    }
    finally {
        await app.close();
    }
});
test("restores a durable workflow form after service restart and continues only after an explicit answer", async ({ page, context }) => {
    const workspace = await temporary(), home = await temporary(), root = join(workspace, ".nekomimi/extensions/durable");
    await mkdir(root, { recursive: true });
    await writeFile(join(workspace, "review.txt"), "Review this fixture");
    await writeFile(join(root, "extension.json"), JSON.stringify({ name: "durable", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["workflows", "tools", "workspace-state"] }));
    await copyFile(resolve("extension-docs/durable-review.ts"), join(root, "index.ts"));
    const options = { workspace, home, naming: false, staticDir: resolve("dist/web-dist"), runtime: noModels };
    let app = await startWeb(options);
    try {
        await activateFixture(app, 'durable');
        await page.goto(app.origin + '/work/workflows#token=' + app.token);
        await page.getByText("启动新工作流", { exact: true }).click();
        await page.getByLabel("工作流定义", { exact: true }).selectOption({ index: 1 });
        await page.getByLabel("工作流输入 JSON").fill('{"target":"review.txt"}');
        await page.getByRole("button", { name: "启动工作流", exact: true }).click();
        await expect(page.getByRole("form", { name: "审查确认" })).toBeVisible();
        await app.close();
        app = await startWeb(options);
        await page.goto(app.origin + '/work/workflows#token=' + app.token);
        await expect(page.getByRole("form", { name: "审查确认" })).toBeVisible();
        await page.getByLabel("审查决定").selectOption("通过");
        const other = await context.newPage();
        await other.goto(app.origin + '/work/workflows');
        await expect(other.getByLabel("审查决定", { exact: true })).toHaveValue('');
        await other.close();
        expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('通过');
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await page.getByRole("menuitem", { name: /^全部设置/ }).click();
        await page.getByRole("link", { name: /^模型用途与配置/ }).first().click();
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await page.getByRole("menuitem", { name: /^全部设置/ }).click();
        await page.getByRole("link", { name: /^持久工作流/ }).first().click();
        await page.keyboard.press("Escape");
        await expect(page.getByLabel("审查决定")).toHaveValue("通过");
        await page.getByRole("button", { name: "提交并继续工作流" }).click();
        await expect(page.getByRole("article", { name: "工作流 durable-review" })).toContainText("已完成");
        await expect(page.getByRole("form", { name: "审查确认" })).toHaveCount(0);
        await page.getByRole("button", { name: "查看工作流证据" }).click();
        await expect(page.getByRole("region", { name: "工作流证据" })).toContainText("workflow.step.started");
        await page.reload();
        await expect(page.getByRole("article", { name: "工作流 durable-review" })).toContainText("已完成");
    }
    finally {
        await app.close();
    }
});
test("configures a custom Provider without a default key, selects it and executes a recorded tool round", async ({ page }) => {
    const workspace = await temporary(), home = await temporary(), root = join(workspace, ".nekomimi/extensions/providers");
    await mkdir(root, { recursive: true });
    await writeFile(join(workspace, "sample.txt"), "Browser provider input");
    await writeFile(join(root, "extension.json"), JSON.stringify({ name: "providers", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["providers"] }));
    await copyFile(resolve("extension-docs/http-providers.ts"), join(root, "index.ts"));
    let requests = 0;
    const app = await startWeb({ workspace, home, naming: false, staticDir: resolve("dist/web-dist"), runtime: { fetch: async (_url, init) => {
                const body = JSON.parse(String(init!.body));
                expect(body.model).toBe("fixture-model");
                return Response.json({ choices: [{ message: ++requests === 1 ? { role: "assistant", content: null, tool_calls: [{ id: "browser-read", type: "function", function: { name: "read", arguments: '{"path":"sample.txt"}' } }] } : { role: "assistant", content: "Custom Provider completed" }, finish_reason: requests === 1 ? "tool_calls" : "stop" }] });
            } } });
    try {
        await activateFixture(app, 'providers');
        const session = await app.sessions.create('自定义 Provider', { mode: 'work', commandId: 'provider-roundtrip' });
        const path = `/work/session/${session.id}`;
        await page.goto(app.origin + path + '/models#token=' + app.token);
        await page.getByRole("button", { name: "新增模型配置", exact: true }).click();
        await page.getByLabel("模型配置名称").fill("browser-profile");
        await page.getByLabel("模型 Provider", { exact: true }).selectOption("example-chat");
        await page.getByLabel("模型与操作", { exact: true }).selectOption(JSON.stringify(["example-chat", "chat", "fixture-model"]));
        await page.getByLabel("Provider 服务地址").fill("https://fixture.invalid/v1");
        await page.getByRole("button", { name: "授权并保存模型配置" }).click();
        await expect(page.getByRole('region', { name: '新增模型配置', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '选择工作对话模型', exact: true }).click();
        await page.getByLabel('工作对话模型配置', { exact: true }).selectOption('browser-profile');
        await page.getByRole('button', { name: '确认用途选择', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.goto(app.origin + path);
        await page.getByLabel("任务草稿", { exact: true }).fill("Read sample.txt using the custom Provider");
        await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await expect(page.locator("[data-conversation-content]")).toContainText("Custom Provider completed");
        await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible();
        expect(requests).toBe(2);
        await page.goto(app.origin + path + '/models');
        await page.getByRole("button", { name: "创建跨 Provider 历史分支" }).click();
        await page.getByRole("button", { name: "确认创建历史分支", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.getByRole("link", { name: "打开历史分支", exact: true }).click();
        await expect(page.locator("[data-conversation-content]")).toContainText("Custom Provider completed");
        expect(requests).toBe(2);
    }
    finally {
        await app.close();
    }
});
test("reviews a package, installs its command and uninstalls without erasing history", async ({ page }) => {
    const workspace = await temporary(), home = await temporary(), source = join(workspace, "bundle");
    await mkdir(source);
    await writeFile(join(source, "nekomimi.json"), JSON.stringify({ manifestVersion: 1, name: "browser-package", version: "1.0.0", sdkVersion: 3, requiredCapabilities: ["commands"], dependencies: {}, resources: [{ kind: "extension", name: "browser-package", entry: "index.ts" }] }));
    await writeFile(join(source, "index.ts"), `import type {ExtensionFactory} from 'nekomimi/extensions'; export default ((api)=>{api.registerCommand('package-browser',{description:'package',async handler(){return 'Browser package evidence'}})}) satisfies ExtensionFactory;`);
    const packages = new Packages(workspace, home);
    await packages.prepare({ kind: "local", path: source }, "project");
    const app = await startWeb({ workspace: await temporary(), home, apiKey: key, naming: false, staticDir: resolve("dist/web-dist"), runtime: noModels });
    try {
        const session = await app.sessions.create('能力包生命周期', { commandId: 'package-lifecycle', mode: 'create', target: { kind: 'extension', root: workspace, scope: 'project' } });
        const path = `/create/session/${session.id}`;
        await page.goto(app.origin + path + '/packages#token=' + app.token);
        await page.getByRole('button', { name: '检查能力包候选', exact: true }).click();
        await expect(page.getByText('静态检查通过；当前开发项目', { exact: true })).toBeVisible();
        const receipt = await confirm(page, '授权并安装能力包');
        await expect.poll(async () => (await app.sessions.describeCustomization(session.id)).receipts.find(item => item.id === receipt.id)?.status).toBe('activated');
        const installed = page.getByRole('article', { name: '已安装能力包 browser-package', exact: true });
        await expect(installed).toBeVisible();
        await page.goto(app.origin + path);
        await page.getByLabel('任务草稿', { exact: true }).fill('/package-browser');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await expect(page.locator('[data-conversation-content]')).toContainText('Browser package evidence');
        await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
        await page.goto(app.origin + path + '/packages');
        await installed.getByText('导出与卸载', { exact: true }).click();
        await confirm(page, '导出能力包');
        await expect(installed.getByText('已导出：', { exact: false })).toBeVisible();
        const removed = await confirm(page, '卸载能力包');
        await expect.poll(async () => (await app.sessions.describeCustomization(session.id)).receipts.find(item => item.id === removed.id)?.status).toBe('activated');
        expect(await packages.list()).toHaveLength(0);
        await page.goto(app.origin + path);
        await page.reload();
        await expect(page.locator('[data-conversation-content]')).toContainText('Browser package evidence');
        expect((await app.sessions.describeCustomization()).packages).toHaveLength(0);
    }
    finally {
        await app.close();
    }
});
test("checks candidate diagnostics, activates an approved hash and rolls back without losing history", async ({ page }) => {
    const development = await temporary(), store = new Candidates(development), candidate = await store.scaffold('candidate-review');
    const originalHash = (await store.inspect(candidate.id)).candidate.contentHash;
    const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, apiKey: key, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { throw Error('Unexpected model request'); } } });
    try {
        const session = await app.sessions.create('候选回退', { mode: 'create', commandId: 'candidate-roundtrip', target: { kind: 'extension', root: development, scope: 'project' } });
        const path = `/create/session/${session.id}`;
        const inspect = async (passed: boolean) => {
            // 先离开文档，确保是完整导航；同 URL 仅 hash 变化会触发“重新授权后自动刷新”
            await page.goto('about:blank');
            await page.goto(app.origin + path + `/candidate/${candidate.id}#token=` + app.token);
            await page.getByRole('navigation', { name: '模式' }).waitFor();
            await page.reload();
            await page.getByRole('tab', { name: '验证记录', exact: true }).click();
            await page.getByRole('button', { name: '运行静态校验', exact: true }).click();
            await expect(page.getByText(`静态校验：${passed ? '通过' : '失败'}`, { exact: true })).toBeVisible();
        };
        const activate = async (label: string) => {
            await page.getByRole('tab', { name: '启用与导出', exact: true }).click();
            const receipt = await confirm(page, label);
            await expect(page.getByRole('region', { name: '候选加载收据', exact: true }).getByText(`${receipt.id} · 加载完成`, { exact: true })).toBeVisible();
        };
        let runs = 0;
        const command = async (expected: string) => {
            await page.goto(app.origin + path);
            await page.getByLabel('任务草稿', { exact: true }).fill('/candidate-review');
            const accepted = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/submit'));
            await page.getByRole('button', { name: '发送', exact: true }).click();
            expect((await accepted).status()).toBe(202);
            await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
            const { readSession } = await import('../../src/journal.js');
            runs++;
            await expect.poll(async () => (await readSession(join(app.sessions.root, session.id))).events.filter(e => e.type === 'run.finished').length).toBe(runs);
            await expect(page.locator('[data-conversation-content]')).toContainText(expected);
        };
        await inspect(true);
        await activate('授权并启用候选');
        await command('Ready');
        await writeFile(join(candidate.path, 'index.ts'), "const wrong: number = 'string'; export default () => {}; ");
        await inspect(false);
        await expect(page.getByText('index.ts:1', { exact: false }).first()).toBeVisible();
        await page.getByRole('tab', { name: '启用与导出', exact: true }).click();
        await expect(page.getByRole('button', { name: '授权并启用候选', exact: true })).toBeDisabled();
        await writeFile(join(candidate.path, 'index.ts'), `import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{api.registerCommand('candidate-review',{description:'review',async handler(){return 'Candidate second version'}})}) satisfies ExtensionFactory3;`);
        await inspect(true);
        await activate('授权并启用候选');
        await command('Candidate second version');
        await page.goto(app.origin + path + `/candidate/${candidate.id}`);
        await activate('回退候选版本');
        await expect.poll(async () => (await store.active())[0]?.revision).toBe(originalHash);
        await command('Ready');
        await expect(page.locator('[data-conversation-content]')).toContainText('Candidate second version');
        expect((await app.sessions.describeCustomization()).managed).toHaveLength(0);
    }
    finally {
        await app.close();
    }
});
test("enable extension, use form, reload a changed command and retain history", async ({ page, }) => {
    const workspace = await temporary();
    const home = await temporary();
    const root = join(workspace, ".nekomimi/extensions/review");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "extension.json"), JSON.stringify({ name: "review", sdkVersion: 3, requiredCapabilities: ['commands', 'tools', 'ui'], entry: "index.ts" }));
    await writeFile(join(root, "index.ts"), `export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('inspect',{description:'Inspect',async handler(args,ctx){const a=await ctx.ui({kind:'form',title:'审查选项',fields:[{name:'scope',label:'检查范围',required:true,options:['全部','当前文件']}]});if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Invalid answer');await ctx.ui({kind:'card',title:'审查完成',text:'已检查 '+a.scope+' <script>window.extensionExecuted=true</script>'});return '审查完成';}});}`);
    const app = await startWeb({
        workspace: await temporary(),
        home,
        apiKey: key,
        naming: false,
        staticDir: resolve("dist/web-dist"), runtime: noModels,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
        const session = await app.sessions.create('扩展重载', { commandId: 'extension-reload', mode: 'create', target: { kind: 'extension', root: workspace, scope: 'project' } });
        const path = `/create/session/${session.id}`;
        await page.goto(app.origin + path + '/resources#token=' + app.token);
        await expect(page.getByRole('article', { name: '资源 review', exact: true })).toContainText('待授权');
        const activation = await confirm(page, '授权并启用资源');
        await expect.poll(async () => { const receipt = (await app.sessions.describeCustomization(session.id)).receipts.find(item => item.id === activation.id); return receipt?.status === 'failed' ? receipt.error : receipt?.status; }).toBe('activated');
        await page.getByRole('link', { name: /返回任务$/ }).click();
        await page.getByLabel("任务草稿", { exact: true }).fill("/inspect");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.getByLabel("检查范围").waitFor();
        await page.reload();
        await page.getByLabel("检查范围").selectOption("全部");
        await page.getByRole("button", { name: "提交回答" }).click();
        await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible();
        await expect(page.locator("[data-conversation-content]")).toContainText("已检查 全部");
        await writeFile(join(root, "index.ts"), `export default (api: import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('inspect',{description:'Inspect',async handler(){return '第二版审查';}});}`);
        await page.goto(app.origin + path + '/resources');
        await expect.poll(async () => (await app.sessions.describeCustomization(session.id)).busy).toBe(false);
        await expect(page.getByRole('button', { name: '重新加载资源', exact: true })).toBeEnabled();
        const loaded = await confirm(page, '重新加载资源');
        await page.getByText('加载记录与诊断', { exact: true }).click();
        await expect(page.getByText(`${loaded.id} · activated`, { exact: true })).toBeVisible();
        await page.getByRole('link', { name: /返回任务$/ }).click();
        await page.getByLabel("任务草稿", { exact: true }).fill("/inspect");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await expect(page.locator("[data-conversation-content]")).toContainText("第二版审查");
        await page.reload();
        await expect(page.locator("[data-conversation-content]")).toContainText("已检查 全部");
        await writeFile(join(root, "index.ts"), "export default !!!");
        await page.goto(app.origin + path + '/resources');
        const failed = await confirm(page, '重新加载资源');
        await page.getByText('加载记录与诊断', { exact: true }).click();
        await expect(page.getByText(`${failed.id} · failed ·`, { exact: false })).toContainText('index.ts');
        await confirm(page, '停用并撤销授权');
        await expect(page.getByRole('article', { name: '资源 review', exact: true })).toContainText('已停用');
        expect(await page.evaluate(() => (window as any).extensionExecuted)).toBeUndefined();
        expect(errors).toEqual([]);
    }
    finally {
        await app.close();
    }
});
test('isolates custom panels, preserves host controls, and rejects conflicting workflow answers across windows', async ({ page, context }) => {
    await context.addInitScript(() => {
        if (window === top)
            return;
        parent.postMessage({ kind: 'ready', version: 1, instanceId: location.pathname.split('/').at(-2), nonce: 'forged-nonce' }, '*');
        window.addEventListener('message', event => { if (event.source === parent && event.data?.kind === 'connect' && event.ports[0]) {
            (window as any).fixturePort = event.ports[0];
            (window as any).fixtureInstance = event.data.instanceId;
        } });
    });
    const workspace = await temporary(), home = await temporary(), root = join(workspace, '.nekomimi/extensions/panels');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'panels', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['panels', 'commands', 'ui', 'workflows'] }));
    const { readFile } = await import('node:fs/promises');
    const extension = (await readFile(resolve('extension-docs/panel-extension.ts'), 'utf8')).replace('}) satisfies ExtensionFactory3;', `api.registerWorkflow({id:'panel-review',schemaVersion:1,inputSchema:{type:'object'},entry:'wait',steps:{wait:{transitions:['done'],async execute(input){return {kind:'wait',step:'done',input,form:{kind:'form',title:'Panel approval',fields:[{name:'decision',label:'Decision',required:true,options:['approve','reject']}]}};}},done:{transitions:[],async execute(input){return {kind:'complete',output:input};}}}});}) satisfies ExtensionFactory3;`);
    await writeFile(join(root, 'index.ts'), extension);
    await copyFile(resolve('extension-docs/review-panel.ts'), join(root, 'review-panel.ts'));
    const app = await startWeb({ workspace: await temporary(), home, naming: false, staticDir: resolve('dist/web-dist'), runtime: noModels });
    try {
        const session = await app.sessions.create('隔离面板', { commandId: 'panel-isolation', mode: 'create', target: { kind: 'extension', root: workspace, scope: 'project' } });
        const data = await app.sessions.describeCustomization(session.id), resource = data.resources.find(item => item.name === 'panels')!;
        await app.sessions.customizationAction({ action: 'authorize-version', sessionId: session.id, id: resource.id, contentHash: resource.hash, revision: data.settingsRevision });
        await expect.poll(async () => (await app.sessions.describeCustomization(session.id)).panels.length).toBe(1);
        const path = `/create/session/${session.id}`;
        await page.goto(app.origin + path + '/workflows#token=' + app.token);
        await page.getByText('启动新工作流', { exact: true }).click();
        await page.getByLabel('工作流定义', { exact: true }).selectOption({ index: 1 });
        await page.getByRole('button', { name: '启动工作流', exact: true }).click();
        await expect(page.getByRole('form', { name: 'Panel approval', exact: true })).toBeVisible();
        const manager = await context.newPage();
        await manager.goto(app.origin + path + '/workflows');
        await page.goto(app.origin + path + '/panels');
        const other = await context.newPage();
        await other.goto(app.origin + path + '/panels');
        for (const tab of [page, other]) {
            await expect(tab.getByLabel('面板定义').locator('option')).toHaveCount(2);
            await tab.getByLabel('面板定义', { exact: true }).selectOption({ index: 1 });
            await tab.getByLabel('面板数据 JSON', { exact: true }).fill('{"items":["Alpha","Beta"]}');
            await tab.getByLabel('关联工作流', { exact: true }).selectOption({ index: 1 });
            await tab.getByRole('button', { name: '打开面板', exact: true }).click();
            await expect(tab.frameLocator('iframe').getByText('Alpha', { exact: true })).toBeVisible();
        }
        await page.bringToFront();
        await page.getByRole('group', { name: '面板主题' }).getByRole('button', { name: 'dark', exact: true }).click();
        await expect(page.frameLocator('iframe').getByText('Alpha', { exact: true })).toBeVisible();
        await expect.poll(async () => page.frames().find(f => f.parentFrame())?.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 17, 17)');
        const frame = page.frames().find(f => f.parentFrame())!;
        expect(await frame.evaluate(() => { try {
            return parent.document.body.innerHTML;
        }
        catch {
            return 'blocked';
        } })).toBe('blocked');
        expect(await frame.evaluate(() => { try {
            return document.cookie;
        }
        catch {
            return 'blocked';
        } })).toBe('blocked');
        expect(await frame.evaluate(async () => { try {
            await fetch('/api/v1/config');
            return 'allowed';
        }
        catch {
            return 'blocked';
        } })).toBe('blocked');
        await page.frameLocator('iframe').getByLabel('筛选审查项').fill('Beta');
        await expect(page.frameLocator('iframe').getByText('Alpha', { exact: true })).toHaveCount(0);
        await waitForPanelLayout(page.locator('iframe'));
        const answered = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/customization') && r.request().postDataJSON()?.method === 'workflow.answer');
        await page.frameLocator('iframe').getByRole('button', { name: '确认审查' }).click();
        expect((await answered).ok()).toBe(true);
        await expect(page.frameLocator('iframe').locator('p')).toContainText('ready');
        await other.bringToFront();
        await other.frameLocator('iframe').getByLabel('审查决定').selectOption('reject');
        await other.frameLocator('iframe').getByRole('button', { name: '确认审查' }).click();
        await expect(other.frameLocator('iframe').locator('p')).toContainText('冲突');
        await other.frameLocator('iframe').getByLabel('审查决定').selectOption('approve');
        // Same answer from the stale second window is idempotent and does not advance the step.
        await other.frameLocator('iframe').getByRole('button', { name: '确认审查' }).click();
        await expect(other.frameLocator('iframe').locator('p')).toContainText('ready');
        await manager.getByRole('button', { name: '刷新工作流状态', exact: true }).click();
        await expect(manager.getByRole('article', { name: '工作流 panel-review' })).toContainText('可继续');
        await page.bringToFront();
        await frame.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'fixture crash' })));
        await expect(page.getByRole('region', { name: '自定义面板 审查面板' })).toContainText('暂时无法显示互动内容，已保留结果。');
        await expect(page.locator('iframe')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '刷新面板目录', exact: true })).toBeVisible();
        await expect(page.getByLabel('面板数据 JSON', { exact: true })).toBeEnabled();
        await expect(manager.getByRole('button', { name: '取消工作流' })).toBeVisible();
        await page.getByRole('button', { name: '预览面板', exact: true }).click();
        await expect(page.frameLocator('iframe').getByText('Alpha', { exact: true })).toBeVisible();
        const previewFrame = page.frames().find(f => f.parentFrame())!;
        expect(await previewFrame.evaluate(() => { try {
            top!.location.href = 'https://example.invalid/';
            return 'allowed';
        }
        catch {
            return 'blocked';
        } })).toBe('blocked');
        let configResponses = 0;
        page.on('response', response => { if (response.url().endsWith('/api/v1/config'))
            configResponses++; });
        await previewFrame.evaluate(url => { location.href = url; }, app.origin + '/api/v1/config');
        await expect(page.locator('iframe')).toHaveCount(0);
        expect(configResponses).toBe(0);
        expect(page.url()).toBe(app.origin + path + '/panels');
        await manager.getByRole('button', { name: '取消工作流' }).click();
        await expect(manager.getByRole('article', { name: '工作流 panel-review' })).toContainText('已取消');
        await other.bringToFront();
        await other.frameLocator('iframe').getByRole('button', { name: '确认审查' }).evaluate(button => (button as HTMLButtonElement).disabled = false);
        await other.frameLocator('iframe').getByRole('button', { name: '确认审查' }).click();
        await expect(manager.getByRole('article', { name: '工作流 panel-review' })).toContainText('已取消');
        const stale = other.frames().find(f => f.parentFrame())!;
        await stale.evaluate(() => { (window as any).fixturePort.postMessage({ kind: 'request', version: 1, instanceId: (window as any).fixtureInstance, id: 999, action: 'workflow.state', value: 'x'.repeat(40000) }); });
        await expect(other.getByRole('region', { name: '自定义面板 审查面板' })).toContainText('暂时无法显示互动内容，已保留结果。');
        await expect(other.locator('iframe')).toHaveCount(0);
        await other.close();
        await manager.close();
    }
    finally {
        await app.close();
    }
});
test('authorizes MCP through a browser callback, refreshes after service restart and disconnects without exposing tokens', async ({ page, context }) => {
    const { oauthFixture } = await import('../fixtures/oauth-server.js'), fixture = await oauthFixture(), workspace = await temporary(), home = await temporary();
    await mkdir(join(workspace, '.nekomimi'), { recursive: true });
    await writeFile(join(workspace, '.nekomimi/mcp.json'), JSON.stringify({ version: 1, servers: { oauth: { ...fixture.resource.config, oauth: { issuer: fixture.resource.config!.oauth!.issuer, dynamicRegistration: true } } } }));
    const options = { workspace: await temporary(), home, naming: false, staticDir: resolve('dist/web-dist'), runtime: noModels };
    let app = await startWeb(options);
    try {
        const session = await app.sessions.create('OAuth 开发', { commandId: 'oauth-restart', mode: 'create', target: { kind: 'extension', root: workspace, scope: 'project' } });
        const path = `/create/session/${session.id}`;
        await page.goto(app.origin + path + '/mcp#token=' + app.token);
        await confirm(page, '开始 MCP 授权');
        const popupPromise = context.waitForEvent('page');
        await page.getByRole('link', { name: '打开 MCP 授权页面' }).click();
        const popup = await popupPromise;
        await expect(popup.locator('body')).toContainText('授权完成');
        await popup.close();
        await expect(page.getByRole('region', { name: '授权 oauth', exact: true })).toContainText('已授权');
        expect(fixture.counts().registrations).toBe(1);
        await app.close();
        app = await startWeb(options);
        await page.goto(app.origin + path + '/mcp#token=' + app.token);
        await expect(page.getByRole('region', { name: '授权 oauth', exact: true })).toContainText('已授权');
        await page.goto(app.origin + path + '/resources');
        await confirm(page, '授权并启用资源');
        await expect.poll(() => fixture.counts().refreshes).toBe(1);
        const management = await page.evaluate(async (id) => JSON.stringify(await (await fetch('/api/v1/customization?session=' + id)).json()), session.id);
        expect(management).not.toContain('initial-secret');
        expect(management).not.toContain('refreshed-secret');
        expect(management).not.toContain('refresh-secret');
        await page.goto(app.origin + path + '/mcp');
        await confirm(page, '断开 MCP 授权');
        await expect(page.getByRole('region', { name: '授权 oauth', exact: true })).toContainText('已断开授权');
    }
    finally {
        await app.close();
        await fixture.close();
    }
});
