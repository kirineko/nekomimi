import { prepareDataHome } from "../../src/storage/format.js";
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { temporary } from '../helpers.js';
import { startWeb } from '../../src/server/app.js';
test('compact capability catalog, local feedback, permissions and theme preview', async ({ page }, info) => {
    const workspace = await temporary(), development = await temporary(), home = await temporary(), root = join(development, '.nekomimi/extensions/pink');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'pink', entry: 'index.ts', sdkVersion: 3, requiredCapabilities: ['themes'] }));
    await writeFile(join(root, 'index.ts'), `export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerTheme({id:'pink',title:'粉白主题',colors:{accent:'#fbd',surface:'#fff',foreground:'#334'}});}`);
    await prepareDataHome(home);
    await mkdir(join(home, 'skills/shared'), { recursive: true });
    await writeFile(join(home, 'skills/shared/SKILL.md'), '---\nname: shared\ndescription: shared skill\n---\nRead current files.');
    const app = await startWeb({ workspace, home, naming: false, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { throw Error('No model calls in lifecycle fixture'); } } });
    try {
        const session = await app.sessions.create('主题权限验收', { commandId: 'theme-permission-fixture', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
        await page.goto(`${app.origin}/create/session/${session.id}/resources#token=${app.token}`);
        await expect(page.getByRole('heading', { name: '能力与权限', exact: true })).toBeVisible();
        await page.getByRole('combobox', { name: '资源范围', exact: true }).selectOption('user');
        const user = page.getByRole('article', { name: '资源 shared', exact: true });
        await expect(user).toContainText('用户范围');
        await expect(user).toContainText('shared');
        await page.getByRole('combobox', { name: '资源范围', exact: true }).selectOption('project');
        const card = page.getByRole('article', { name: '资源 pink', exact: true });
        await card.getByText('来源、版本与权限', { exact: true }).click();
        await expect(card).toContainText('请求权限 themes');
        await card.getByRole('button', { name: '授权并启用资源', exact: true }).click();
        await expect(page.getByRole('dialog')).toContainText('权限 themes');
        await page.getByRole('button', { name: '取消操作', exact: true }).click();
        await expect(card.getByRole('button', { name: '授权并启用资源', exact: true })).toBeFocused();
        await card.getByRole('button', { name: '静态校验资源', exact: true }).click();
        await page.getByRole('button', { name: '确认静态校验资源', exact: true }).click();
        await expect(card.getByRole('status')).toContainText('静态校验通过');
        await page.goto(`${app.origin}/create/models`);
        await expect(page.getByRole('status').filter({ hasText: '静态校验通过' })).toHaveCount(0);
        await page.goto(`${app.origin}/create/session/${session.id}/resources`);
        await card.getByRole('button', { name: '授权并启用资源', exact: true }).click();
        await page.getByRole('button', { name: '确认授权并启用资源', exact: true }).click();
        await expect(card.getByRole('button', { name: '停用并撤销授权', exact: true })).toBeVisible();
        await page.goto(`${app.origin}/create/session/${session.id}/themes`);
        await page.getByRole('button', { name: '预览 粉白主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-workbench-theme', 'pink');
        await expect(page.getByRole('button', { name: '应用已审阅风格', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '取消主题预览', exact: true }).click();
        await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
        await page.goto(`${app.origin}/create/session/${session.id}/resources`);
        await page.setViewportSize({ width: 360, height: 780 });
        await expect(page.getByRole('link', { name: /返回任务$/ })).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('customization-lifecycle-mobile.png') });
        const writes: string[] = [];
        page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/customization'))
            writes.push(r.postDataJSON().action); });
        // The legacy global open event is replaced by explicit scoped deep links.
        await page.goto(`${app.origin}/create/session/${session.id}/candidate/removed-resource?revision=obsolete`);
        await expect(page.getByRole('heading', { name: '交付版本链接无效', exact: true })).toBeVisible();
        await page.goto(`${app.origin}/create/session/${session.id}/candidate/removed-resource`);
        await expect(page.getByRole('heading', { name: '候选不存在或暂不可读', exact: true })).toBeVisible();
        expect(writes).toEqual([]);
    }
    finally {
        await app.close();
    }
});
