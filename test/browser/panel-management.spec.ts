import { test, expect } from '@playwright/test';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { temporary } from '../helpers.js';
test('10.4 bound panel actions, frame and cleanup stay in the create target; refresh never remounts', async ({ page }) => {
    const workspace = await temporary(), home = await temporary(), development = await temporary(), root = join(development, '.nekomimi/extensions/panels');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'panels', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['panels', 'commands', 'ui', 'workflows'] }));
    const source = (await readFile(resolve('extension-docs/panel-extension.ts'), 'utf8')).replace('}) satisfies ExtensionFactory3;', `api.registerWorkflow({id:'panel-review',schemaVersion:1,inputSchema:{type:'object'},entry:'wait',steps:{wait:{transitions:['done'],async execute(input){return {kind:'wait',step:'done',input,form:{kind:'form',title:'Panel approval',fields:[{name:'decision',label:'Decision',required:true,options:['approve','reject']}]}};}},done:{transitions:[],async execute(input){return {kind:'complete',output:input};}}}});}) satisfies ExtensionFactory3;`);
    await writeFile(join(root, 'index.ts'), source);
    await copyFile(resolve('extension-docs/review-panel.ts'), join(root, 'review-panel.ts'));
    const app = await startWeb({ workspace, home, naming: false, staticDir: resolve('dist/web-dist') });
    const actions: Record<string, unknown>[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization'))
        actions.push(request.postDataJSON()); });
    try {
        const session = await app.sessions.create('面板目标', { commandId: 'panel-target', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
        const data = await app.sessions.describeCustomization(session.id), resource = data.resources.find(item => item.name === 'panels')!;
        await app.sessions.customizationAction({ action: 'authorize-version', sessionId: session.id, id: resource.id, contentHash: resource.hash, revision: data.settingsRevision });
        await expect.poll(async () => (await app.sessions.describeCustomization(session.id)).panels.length).toBe(1);
        await app.sessions.customizationAction({ action: 'workflow-start', sessionId: session.id, resourceId: resource.id, definitionId: 'panel-review', input: {}, commandId: crypto.randomUUID() });
        await expect.poll(async () => (await app.sessions.describeCustomization(session.id)).workflows[0]?.status).toBe('waiting');
        await page.goto(app.origin + `/create/session/${session.id}/panels#token=` + app.token);
        await page.getByLabel('面板定义', { exact: true }).selectOption({ index: 1 });
        expect(actions).toEqual([]);
        await page.getByLabel('面板数据 JSON', { exact: true }).fill('{bad');
        await page.getByRole('button', { name: '打开面板', exact: true }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        expect(actions).toEqual([]);
        await page.getByLabel('面板数据 JSON', { exact: true }).fill('{"items":["Scoped review"]}');
        await page.getByLabel('关联工作流', { exact: true }).selectOption({ index: 1 });
        await page.getByRole('button', { name: '打开面板', exact: true }).click();
        await expect(page.frameLocator('iframe').getByText('Scoped review', { exact: true })).toBeVisible();
        const frameUrl = await page.locator('iframe').getAttribute('src');
        expect(frameUrl).toContain(`session=${session.id}`);
        await page.locator('iframe').evaluate(el => el.setAttribute('data-original-frame', 'yes'));
        await page.setViewportSize({ width: 360, height: 900 });
        await expect(page.locator('iframe')).toHaveAttribute('data-original-frame', 'yes');
        await expect(page.getByLabel('面板数据 JSON', { exact: true })).toHaveValue('{"items":["Scoped review"]}');
        await page.setViewportSize({ width: 1440, height: 1000 });
        await expect(page.locator('iframe')).toHaveAttribute('data-original-frame', 'yes');
        expect(actions.filter(item => item.action === 'panel-mount')).toHaveLength(1);
        expect(actions.filter(item => item.action === 'panel-unmount')).toHaveLength(0);
        await page.frameLocator('iframe').getByRole('button', { name: '确认审查' }).click();
        await expect(page.frameLocator('iframe').locator('p')).toContainText('ready');
        expect((await app.sessions.describeCustomization(session.id)).workflows[0]?.status).toBe('ready');
        expect(await app.sessions.customization.workflows.list()).toHaveLength(0);
        await page.getByRole('button', { name: '关闭面板实例', exact: true }).click();
        await expect.poll(() => actions.filter(item => item.action === 'panel-unmount').length).toBe(1);
        const instanceId = /panels\/([^/]+)\/frame/.exec(frameUrl!)![1]!;
        await expect.poll(async () => { try {
            await app.sessions.panelDocument(instanceId, session.id);
            return 'alive';
        }
        catch {
            return 'closed';
        } }).toBe('closed');
        expect(actions.filter(item => String(item.action).startsWith('panel-')).every(item => item.sessionId === session.id)).toBe(true);
        await page.getByRole('button', { name: '预览面板', exact: true }).click();
        await expect(page.frameLocator('iframe').getByText('Scoped review', { exact: true })).toBeVisible();
        await page.frameLocator('iframe').getByRole('button', { name: '确认审查' }).click();
        await expect(page.frameLocator('iframe').locator('p')).toContainText('Panel action/queue limit');
        expect(actions.filter(item => item.action === 'panel-action')).toHaveLength(1);
        expect((await app.sessions.describeCustomization(session.id)).workflows[0]?.status).toBe('ready');
        await page.getByRole('button', { name: '刷新面板目录', exact: true }).click();
        await expect(page.getByLabel('面板数据 JSON', { exact: true })).toHaveValue('{"items":["Scoped review"]}');
        expect(actions.filter(item => item.action === 'panel-mount')).toHaveLength(2);
        await page.getByRole('button', { name: '关闭面板实例', exact: true }).click();
        await expect.poll(() => actions.filter(item => item.action === 'panel-unmount').length).toBe(2);
        await page.setViewportSize({ width: 360, height: 760 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.reload();
        await expect(page.getByRole('heading', { name: '面板管理', exact: true })).toBeVisible();
        await expect(page.locator('iframe')).toHaveCount(0);
        expect(actions.filter(item => item.action === 'panel-mount')).toHaveLength(2);
    }
    finally {
        await app.close();
    }
});
test('10.9 work panel management keeps the originating session and drafts isolated', async ({ page }) => {
    const workspace = await temporary(), root = join(workspace, '.nekomimi/extensions/work-panel');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'work-panel', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['panels', 'ui-draft'] }));
    await writeFile(join(root, 'index.ts'), `import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{api.registerPanel({id:'work-panel',title:'工作面板',uiVersion:1,contractVersion:3,modes:['work'],targetScope:'current',entry:'panel.ts',slot:'tool-result',propsSchema:{type:'object'},actions:['draft.set'],fallback:'工作面板内容'});}) satisfies ExtensionFactory3;`);
    await writeFile(join(root, 'panel.ts'), `import type {PanelModule} from 'nekomimi/extensions';export default {mount(root,ctx){const button=document.createElement('button'),status=document.createElement('p');button.textContent='写回工作草稿';button.onclick=()=>void ctx.request('draft.set',{text:'来自工作面板'}).then(()=>{status.textContent='草稿已写入'});root.append(button,status);}} satisfies PanelModule;`);
    const app = await startWeb({ workspace, home: await temporary(), naming: false, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { throw Error('No model call expected'); } } });
    const actions: Record<string, unknown>[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization'))
        actions.push(request.postDataJSON()); });
    try {
        await app.sessions.waitInitialization();
        const host = app.sessions.customization, resource = (await host.catalog.discover()).find(item => item.name === 'work-panel')!;
        await host.catalog.decide(resource.id, true, true, 0);
        await host.initialize();
        const first = await app.sessions.create('面板所属工作', { mode: 'work', commandId: 'panel-work-first' }), second = await app.sessions.create('另一工作', { mode: 'work', commandId: 'panel-work-second' });
        await page.goto(app.origin + '/work/panels#token=' + app.token);
        await expect(page.getByText('请从工作会话进入面板管理。', { exact: true })).toBeVisible();
        await page.getByLabel('面板定义', { exact: true }).selectOption({ index: 1 });
        await expect(page.getByRole('button', { name: '打开面板', exact: true })).toBeDisabled();
        await page.goto(app.origin + `/work/session/${first.id}/panels`);
        await expect(page).toHaveURL(app.origin + `/work/session/${first.id}/panels`);
        await page.getByLabel('面板定义', { exact: true }).selectOption({ index: 1 });
        await page.getByRole('button', { name: '打开面板', exact: true }).click();
        const frame = page.frameLocator('iframe');
        await frame.getByRole('button', { name: '写回工作草稿', exact: true }).click();
        await expect(frame.getByText('草稿已写入', { exact: true })).toBeVisible();
        await page.getByRole('link', { name: '面板所属工作', exact: true }).click();
        await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent', '来自工作面板');
        await expect(page.locator('iframe')).toHaveCount(0);
        await page.goto(app.origin + `/work/session/${second.id}`);
        await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent', '');
        await expect.poll(() => actions.filter(item => item.action === 'panel-unmount').length).toBe(1);
        expect(actions.filter(item => String(item.action).startsWith('panel-')).every(item => item.sessionId === first.id)).toBe(true);
    }
    finally {
        await app.close();
    }
});
