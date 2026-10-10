import { test, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { temporary } from '../helpers.js';
async function fixture() {
  const development = await temporary(), root = join(development, '.nekomimi/extensions/reviewed'), marker = join(development, 'factory-count');
  await mkdir(root, { recursive: true });
  const manifest = { name: 'reviewed', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['commands'] };
  await writeFile(join(root, 'extension.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'index.ts'), `import { appendFileSync } from 'node:fs'; export default () => { appendFileSync(${JSON.stringify(marker)}, 'loaded\n'); };`.replace("'loaded\n'", "'loaded\\n'"));
  let models = 0;
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { models++; throw new Error('No model call expected'); } } });
  const session = await app.sessions.create('资源开发', { commandId: 'resource-ui', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
  return { app, session, root, manifest, count: async () => (await readFile(marker, 'utf8').catch(() => '')).split('\n').filter(Boolean).length, models: () => models, path: `/create/session/${session.id}/resources` };
}
test('10.4 resource navigation and cancelled consent are read-only, explicit enable and revoke target only the bound project', async ({ page }) => {
  const f = await fixture(), actions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) actions.push(request.postDataJSON().action); });
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    const card = page.getByRole('article', { name: '资源 reviewed', exact: true });
    await expect(card).toBeVisible(); await card.getByText('来源、版本与权限', { exact: true }).click(); await expect(card.getByText('请求权限 commands', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: '授权并启用资源', exact: true }).click(); await page.getByRole('button', { name: '取消操作', exact: true }).click();
    await expect(card.getByRole('button', { name: '授权并启用资源', exact: true })).toBeFocused();
    expect(actions).toEqual([]); expect(await f.count()).toBe(0);
    await card.getByRole('button', { name: '授权并启用资源', exact: true }).click(); await page.getByRole('button', { name: '确认授权并启用资源', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect.poll(f.count).toBe(1);
    await card.getByRole('button', { name: '停用并撤销授权', exact: true }).click(); await page.getByRole('button', { name: '确认停用并撤销授权', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(card.getByText('已停用', { exact: true })).toBeVisible();
    expect(actions).toEqual(['authorize-version', 'set']); expect(f.models()).toBe(0);
    expect((await f.app.sessions.describeCustomization()).resources.some(resource => resource.name === 'reviewed')).toBe(false);
    await page.reload(); expect(await f.count()).toBe(1); await expect(card).toBeVisible();
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/nekomimi-resource-management.png', fullPage: true });
  } finally { await f.app.close(); }
});
test('10.4 changed resource content cannot inherit consent from an open review', async ({ page }) => {
  const f = await fixture(); let posts = 0;
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    await page.getByRole('button', { name: '授权并启用资源', exact: true }).click();
    await writeFile(join(f.root, 'extension.json'), JSON.stringify({ ...f.manifest, requiredCapabilities: ['commands','tools'] }));
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) posts++; });
    await page.getByRole('button', { name: '确认授权并启用资源', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('资源已变化'); await expect(page.getByRole('button', { name: '确认授权并启用资源', exact: true })).toBeDisabled();
    expect(posts).toBe(1); expect(await f.count()).toBe(0);
    await page.getByRole('button', { name: '取消操作', exact: true }).click(); await page.getByRole('button', { name: '授权并启用资源', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('commands、tools');
    await page.keyboard.press('Escape'); expect(posts).toBe(1);
  } finally { await f.app.close(); }
});
test('10.4 stale settings revision blocks a permission update without automatic retry', async ({ page }) => {
  const f = await fixture(); let posts = 0;
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    await page.getByRole('button', { name: '允许用户目录写入', exact: true }).click();
    const data = await f.app.sessions.describeCustomization(f.session.id);
    await f.app.sessions.customizationAction({ action: 'user-writes', enabled: true, revision: data.settingsRevision, sessionId: f.session.id });
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) posts++; });
    await page.getByRole('button', { name: '确认允许用户目录写入', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('授权修订已变化'); expect(posts).toBe(1); expect(await f.count()).toBe(0);
    await page.getByRole('button', { name: '取消操作', exact: true }).click(); await expect(page.getByRole('button', { name: '撤销用户目录写入', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '撤销用户目录写入', exact: true }).click(); await page.getByRole('button', { name: '确认撤销用户目录写入', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); expect((await f.app.sessions.describeCustomization(f.session.id)).userWrites).toBe(false);
  } finally { await f.app.close(); }
});
test('10.4 filters and invalid targets do not redirect writes to the current project', async ({ page }) => {
  const f = await fixture(); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) posts++; });
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    await page.getByLabel('资源范围', { exact: true }).selectOption('user'); await expect(page.getByRole('heading', { name: '此范围暂无资源' })).toBeVisible();
    await page.getByRole('button', { name: '刷新能力目录', exact: true }).click(); await expect(page.getByLabel('资源范围', { exact: true })).toHaveValue('user');
    await page.goto(f.app.origin + '/create/resources'); await expect(page.getByRole('button', { name: '重新加载资源', exact: true })).toBeDisabled();
    await page.goto(f.app.origin + '/create/session/missing/resources'); await expect(page.getByRole('heading', { name: '能力目录不可读', exact: true })).toBeVisible();
    expect(posts).toBe(0); expect(await f.count()).toBe(0);
  } finally { await f.app.close(); }
});
