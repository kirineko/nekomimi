import { waitForPanelLayout } from './panel-layout.js';
import { test, expect } from '@playwright/test';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { temporary, key } from '../helpers.js';
import { createTask } from './fixtures/workbench.js';
async function activate(app: Awaited<ReturnType<typeof startWeb>>, names: string[]) {
    const host = app.sessions.customization;
    await app.sessions.waitInitialization();
    for (const name of names) {
        const resource = (await host.catalog.discover()).find(item => item.name === name)!;
        await host.catalog.decide(resource.id, true, true, (await host.catalog.decisions()).revision);
    }
    const receipt = host.requestReload();
    await host.reload(receipt);
    expect(receipt.status, receipt.error).toBe('activated');
}
async function appearance(page: import('@playwright/test').Page) { await page.getByRole('button', { name:'设置',exact:true }).click(); await page.getByRole('menuitem', { name: '外观', exact: true }).click(); }
test('applies a complete theme and shows user content with stable panel interaction and readable history', async ({ page }, info) => {
    const workspace = await temporary(), home = await temporary();
    await mkdir(join(workspace, '.nekomimi/extensions'), { recursive: true });
    await cp(resolve('extension-docs/examples/sakura'), join(workspace, '.nekomimi/extensions/sakura'), { recursive: true });
    const app = await startWeb({ workspace, home, apiKey: key, naming: false, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { throw Error('No model calls in runtime UI fixture'); } } });
    let mounts = 0;
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization') && request.postDataJSON()?.action === 'panel-mount')
        mounts++; });
    try {
        await activate(app, ['sakura-studio']);
        const session = await app.sessions.create('樱花面板');
        await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
        await appearance(page);
        await page.getByRole('button', { name: '预览 樱花手记', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-workbench-theme', 'sakura');
        expect(await page.locator('html').evaluate(e => getComputedStyle(e).fontFamily)).toContain('NekomimiWorkbenchTheme');
        await page.getByRole('button', { name: '应用已审阅风格', exact: true }).click();
        await page.getByRole('button', { name: '确认应用已审阅风格', exact: true }).click();
        await page.getByRole('button', { name: '关闭外观', exact: true }).click();
        const input = page.getByLabel('任务草稿', { exact: true });
        await input.fill('/moe 小猫咪');
        await expect(page.getByRole('button', { name: '发送', exact: true })).toHaveCSS('background-color', 'rgb(160, 79, 144)');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await expect(page.frameLocator('iframe[title="面板 今日元气"]').getByRole('heading')).toContainText('小猫咪');
        expect(mounts).toBe(1);
        await expect(page.getByText('小猫咪 · 今日份的元气已加载', { exact: true })).toHaveCount(0);
        const row = page.locator('[data-row-kind]').filter({ hasText: '今日元气' });
        await expect(row).not.toContainText('bundleHash');
        await expect(row).not.toContainText('moe-panel');
        // Explicit latest reload remains read-only and does not open historical code.
        await page.locator('[data-conversation-content]').evaluate(el => { (el as HTMLElement).style.paddingTop = '1600px'; });
        await page.getByTestId('timeline').evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 })); el.scrollTop = 100; });
        await page.getByRole('button', { name: '返回最新', exact: true }).click();
        await expect(page.getByRole('button', { name: '打开互动内容', exact: true })).toBeVisible();
        await expect(page.locator('iframe')).toHaveCount(0);
        expect(mounts).toBe(1);
        await page.locator('[data-conversation-content]').evaluate(el => { (el as HTMLElement).style.paddingTop = ''; });
        await page.getByRole('button', { name: '打开互动内容', exact: true }).click();
        const frame = page.frameLocator('iframe[title="面板 今日元气"]');
        await expect(frame.getByRole('heading')).toContainText('小猫咪');
        expect(mounts).toBe(2);
        await expect(frame.locator('body')).toHaveCSS('font-size', '15px');
        expect(await frame.locator('body').evaluate(async () => { await document.fonts.load('15px NekomimiTheme'); return document.fonts.check('15px NekomimiTheme') && Array.from(document.fonts).some(f => f.family === 'NekomimiTheme' && f.status === 'loaded'); })).toBe(true);
        await frame.getByLabel('面板便签').fill('保持输入');
        await appearance(page);
        await page.getByRole('button', { name: '预览默认风格', exact: true }).click();
        await page.getByRole('button', { name: '取消主题预览', exact: true }).click();
        await page.getByRole('button', { name: '关闭外观', exact: true }).click();
        await expect(frame.getByLabel('面板便签')).toHaveValue('保持输入');
        await expect(frame.locator('body')).toHaveCSS('font-size', '15px');
        await waitForPanelLayout(page.locator('iframe[title="面板 今日元气"]'));
        await frame.getByRole('button', { name: '写入草稿', exact: true }).click();
        await expect(input).toHaveJSProperty('textContent', '保持输入');
        await frame.getByLabel('面板便签').fill('第二条');
        await frame.getByRole('button', { name: '已提供草稿', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '如何处理面板草稿？', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '保留原草稿', exact: true }).click();
        await expect(page.locator('iframe[title="面板 今日元气"]')).toBeFocused();
        await expect(input).toHaveJSProperty('textContent', '保持输入');
        await writeFile(join(workspace, 'draft-reference.txt'), 'fixture');
        await input.fill('@draft-reference');
        await expect(page.getByRole('option', { name: /draft-reference.txt/ })).toBeVisible();
        await input.press('Enter');
        await expect(input.locator('[data-reference-id]')).toHaveCount(1);
        await frame.getByLabel('面板便签').fill('追加内容');
        await frame.getByRole('button', { name: '已提供草稿', exact: true }).click();
        await page.getByRole('button', { name: '追加到草稿', exact: true }).click();
        await expect(input.locator('[data-reference-id]')).toHaveCount(1);
        await expect(input).toContainText('追加内容');
        const panel = page.getByRole('region', { name: '自定义面板 今日元气', exact: true });
        await panel.getByRole('button', { name: '收起', exact: true }).click();
        await expect(page.locator('iframe[title="面板 今日元气"]')).toHaveCount(0);
        await panel.getByRole('button', { name: '重新打开', exact: true }).click();
        await expect(frame.getByRole('heading')).toContainText('小猫咪');
        await page.getByRole('button', { name: '打开灵感便签', exact: true }).click();
        await expect(page.frameLocator('iframe[title="面板 灵感便签"]').getByRole('heading')).toContainText('灵感便签');
        await page.getByRole('button', { name: '关闭灵感便签', exact: true }).click();
        await expect(page.locator('iframe[title="面板 灵感便签"]')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('runtime-ui-sakura.png') });
        await appearance(page);
        const toggle = page.getByRole('switch', { name: '显示扩展内容', exact: true });
        await expect(toggle).toHaveCSS('border-radius', '12px');
        await expect(toggle.locator('span').first()).toHaveCSS('background-color', 'rgb(160, 79, 144)');
        await page.screenshot({ path: info.outputPath('header-theme-menu.png') });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name:'设置',exact:true }).click();
        await page.getByRole('menuitem', { name:'导出当前会话',exact:true }).click();
        await expect(page.getByRole('dialog', { name: '导出对话', exact: true })).toHaveCSS('background-color', 'rgb(250, 243, 250)');
        await page.screenshot({ path: info.outputPath('header-theme-export.png') });
        await page.getByRole('button', { name: '关闭导出', exact: true }).click();
        const beforeSwitch = mounts;
        await createTask(page);
        await expect(page.locator('iframe[title="面板 今日元气"]')).toHaveCount(0);
        await page.locator(`[data-session-title][href="/work/session/${session.id}"]`).click();
        await expect(page.getByRole('button', { name: '打开互动内容', exact: true })).toBeVisible();
        await expect(page.locator('iframe')).toHaveCount(0);
        expect(mounts).toBe(beforeSwitch);
        await page.reload();
        await expect(page.getByText('小猫咪 · 今日份的元气已加载', { exact: true })).toBeVisible();
        await expect(page.locator('iframe')).toHaveCount(0);
        await page.getByRole('button', { name: '打开互动内容', exact: true }).click();
        await expect(frame.getByRole('heading')).toContainText('小猫咪');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(row).toHaveCSS('animation-name', 'none');
        await page.setViewportSize({ width: 620, height: 900 });
        await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
        await appearance(page);
        const recover = page.getByRole('button', { name: '恢复默认界面', exact: true });
        await expect(recover).toBeInViewport();
        await recover.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
        await expect(page.locator('iframe')).toHaveCount(0);
        const catalog = await app.sessions.runtimeUi(session.id);
        await info.attach('runtime-ui-verification', { body: JSON.stringify({ stage: 'host-integration', resources: catalog.runtimeUi.themes.map(t => ({ id: t.id, resourceId: t.resourceId, revision: t.revision })), checks: ['theme', 'command', 'draft-conflict', 'reference-preserved', 'stable-input', 'reopen', 'readonly-history', 'reduced-motion', 'css-zoom-200', 'keyboard-recovery'] }), contentType: 'application/json' });
    }
    finally {
        await app.close();
    }
});
test('combines ordered views, explicit renderers and pages, and releases subscriptions on close', async ({ page }) => {
    const { writeFile } = await import('node:fs/promises');
    const workspace = await temporary(), home = await temporary();
    for (const name of ['first', 'second']) {
        const root = join(workspace, '.nekomimi/extensions', name);
        await mkdir(root, { recursive: true });
        await writeFile(join(root, 'extension.json'), JSON.stringify({ name, sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['views', 'commands', 'ui', 'ui-state', 'ui-navigation', 'ui-command'] }));
        await writeFile(join(root, 'index.ts'), `import type {ExtensionFactory} from 'nekomimi/extensions';export default ((api)=>{
   for(const [id,slot] of [['header','session-header'],['side','sidebar-widget'],['message','message-content'],['page','page']] as const) api.registerView({id,title:'${name}-'+id,order:${name === 'first' ? 2 : 1},uiVersion:1,contractVersion:3,modes:['work','create'],targetScope:'current',entry:'view.ts',slot,match:slot==='message-content'?{role:'user'}:undefined,propsSchema:{type:'object'},actions:['state.subscribe','view.open','command.run'],fallback:'${name} fallback'});
   api.registerCommand('hello',{description:'hello',async handler(_a,ctx){await ctx.ui({kind:'card',title:'一次结果',text:'hello from ${name}'});}});
  }) satisfies ExtensionFactory;`);
        await writeFile(join(root, 'view.ts'), `import type {PanelModule} from 'nekomimi/extensions';export default {mount(root,ctx){const p=document.createElement('p');p.textContent='${name} visible';root.append(p);const status=document.createElement('span');status.textContent='等待会话';root.append(status);const stop=ctx.subscribe?.(s=>{status.textContent=String((s as any).status)});const b=document.createElement('button');b.textContent='打开页面';b.onclick=()=>{void ctx.request('view.open',{viewId:'page'})};root.append(b);const run=document.createElement('button');run.textContent='运行命令';const commandId=crypto.randomUUID();run.onclick=()=>{void ctx.request('command.run',{commandId,command:'/${name}:hello'})};root.append(run);return()=>{stop?.();root.replaceChildren()}}} satisfies PanelModule;`);
    }
    const app = await startWeb({ workspace, home, apiKey: key, naming: false, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { throw Error('No model calls in runtime UI fixture'); } } });
    try {
        await activate(app, ['first', 'second']);
        const session = await app.sessions.create('组合扩展视图');
        await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
        await page.getByLabel('任务草稿', { exact: true }).fill('/first:hello');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await expect(page.getByText('hello from first', { exact: true })).toBeVisible();
        const header = page.getByRole('region', { name: '扩展区域 session-header', exact: true });
        await expect(header.locator('iframe')).toHaveCount(0);
        await expect(header.getByRole('button').first()).toHaveText('打开second-header');
        const secondMount = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/customization') && r.request().postDataJSON()?.action === 'panel-mount' && r.request().postDataJSON()?.panelId === 'header');
        await header.getByRole('button', { name: '打开second-header', exact: true }).click();
        const { instanceId: secondInstance } = await (await secondMount).json();
        await header.getByRole('button', { name: '打开first-header', exact: true }).click();
        await expect(header.locator('iframe').first()).toHaveAttribute('title', '面板 second-header');
        const first = page.frameLocator('iframe[title="面板 first-header"]');
        await expect(first.getByText('completed', { exact: true }).first()).toBeVisible();
        await waitForPanelLayout(page.locator('iframe[title="面板 first-header"]'));
        await first.getByRole('button', { name: '运行命令', exact: true }).click();
        await first.getByRole('button', { name: '运行命令', exact: true }).click();
        await expect(page.getByText('hello from first', { exact: true })).toHaveCount(2);
        const renderer = page.getByRole('region', { name: '扩展区域 message-content', exact: true }).first();
        await renderer.getByRole('button', { name: '打开first-message', exact: true }).click();
        await expect(renderer.locator('iframe')).toHaveCount(1);
        await renderer.getByRole('button', { name: '打开second-message', exact: true }).click();
        await expect(renderer.locator('iframe')).toHaveCount(1);
        await expect(renderer.locator('iframe')).toHaveAttribute('title', '面板 second-message');
        const message = page.frameLocator('iframe[title="面板 second-message"]');
        await expect(message.getByText('second visible', { exact: true })).toBeVisible();
        await expect(message.getByText('completed', { exact: true }).first()).toBeVisible();
        await waitForPanelLayout(renderer.locator('iframe'));
        await waitForPanelLayout(page.locator('iframe[title="面板 first-header"]'));
        const opened = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/customization') && r.request().postDataJSON()?.method === 'view.open');
        await first.getByRole('button', { name: '打开页面', exact: true }).click();
        expect((await opened).ok()).toBe(true);
        await expect(page.getByRole('dialog', { name: 'first-page', exact: true })).toBeVisible();
        await expect(page.frameLocator('iframe[title="面板 first-page"]').getByText('first visible', { exact: true })).toBeVisible();
        await waitForPanelLayout(page.locator('iframe[title="面板 first-page"]'));
        await page.getByRole('button', { name: '关闭扩展页面', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'first-page', exact: true })).toHaveCount(0);
        await expect(page.locator('iframe[title="面板 first-header"]')).toBeFocused();
        await waitForPanelLayout(page.locator('iframe[title="面板 second-header"]'));
        const closed = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/customization') && r.request().postDataJSON()?.action === 'panel-unmount' && r.request().postDataJSON()?.instanceId === secondInstance);
        await header.getByRole('button', { name: '关闭second-header', exact: true }).click();
        expect((await closed).ok()).toBe(true);
        await expect(header.locator('iframe')).toHaveCount(1);
        await appearance(page);
        await page.getByRole('button', { name: '恢复默认界面', exact: true }).click();
        await expect(page.locator('iframe')).toHaveCount(0);
    }
    finally {
        await app.close();
    }
});
