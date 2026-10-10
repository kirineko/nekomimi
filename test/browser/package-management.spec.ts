import { test, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { temporary } from '../helpers.js';
import { Packages } from '../../src/customization/packages.js';
import { startWeb } from '../../src/server/app.js';
async function fixture() {
  const development = await temporary(), home = await temporary(), source = await temporary();
  await mkdir(join(source, 'skills'));
  await writeFile(join(source, 'nekomimi.json'), JSON.stringify({ manifestVersion: 1, name: 'ui-package', version: '1.0.0', sdkVersion: 3, requiredCapabilities: [], dependencies: {}, resources: [{ kind: 'skill', name: 'ui-skill', entry: 'skills/SKILL.md' }] }));
  await writeFile(join(source, 'skills/SKILL.md'), '---\nname: ui-skill\ndescription: Test skill\n---\nRead only skill.\n');
  const app = await startWeb({ workspace: await temporary(), home, naming: false, staticDir: resolve('dist/web-dist') });
  const session = await app.sessions.create('能力包开发', { commandId: 'package-ui', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
  const store = new Packages(development, home), candidate = await store.prepare({ kind: 'local', path: source }, 'project');
  return { app, session, store, candidate, development, source, url: `/create/session/${session.id}/packages` };
}
test('10.4 package browse and cancelled install are read-only; reviewed install, export and uninstall stay target-scoped', async ({ page }) => {
  const f = await fixture(), actions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) actions.push(request.postDataJSON().action); });
  try {
    await page.goto(f.app.origin + f.url + '#token=' + f.app.token); await expect(page.getByRole('heading', { name: '能力包管理', exact: true })).toBeVisible(); expect(actions).toEqual([]);
    await page.getByRole('button', { name: '检查能力包候选', exact: true }).click(); await expect(page.getByText('静态检查通过；当前开发项目', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '授权并安装能力包', exact: true }).click(); await page.getByRole('button', { name: '取消操作', exact: true }).click(); expect(await f.store.list()).toHaveLength(0);
    await page.getByRole('button', { name: '授权并安装能力包', exact: true }).click(); await page.getByRole('button', { name: '确认授权并安装能力包', exact: true }).click();
    const installed = page.getByRole('article', { name: '已安装能力包 ui-package', exact: true }); await expect(installed).toBeVisible();
    expect((await f.app.sessions.describeCustomization()).packages).toHaveLength(0);
    await installed.getByText('导出与卸载', { exact: true }).click(); await installed.getByRole('button', { name: '导出能力包', exact: true }).click(); await page.getByRole('button', { name: '确认导出能力包', exact: true }).click();
    await expect(installed.getByText('已导出：', { exact: false })).toBeVisible(); const exported = join(f.development, `ui-package-${f.candidate.revision.slice(0,12)}.tgz`); expect((await readFile(exported)).length).toBeGreaterThan(100);
    await installed.getByRole('button', { name: '卸载能力包', exact: true }).click(); await page.getByRole('button', { name: '确认卸载能力包', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await f.app.sessions.describeCustomization(f.session.id)).receipts.at(-1)?.status).toBe('activated');
    await expect(installed).toHaveCount(0);
    expect(actions.filter(action => action === 'package-activate')).toHaveLength(1); expect(await f.store.list()).toHaveLength(0);
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.app.close(); }
});
test('10.4 stale package review fails once without replacing the installed revision', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(f.app.origin + f.url + '#token=' + f.app.token); await page.getByRole('button', { name: '检查能力包候选', exact: true }).click();
    await page.getByRole('button', { name: '授权并安装能力包', exact: true }).click();
    await f.app.sessions.customizationAction({ action: 'package-activate', id: f.candidate.id, scope: 'project', authorize: true, sessionId: f.session.id });
    await expect.poll(async () => (await f.app.sessions.describeCustomization(f.session.id)).receipts.at(-1)?.status).toBe('activated');
    await page.getByRole('button', { name: '确认授权并安装能力包', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('版本已变化');
    await expect(page.getByRole('button', { name: '确认授权并安装能力包', exact: true })).toBeDisabled();
    expect((await f.app.sessions.describeCustomization(f.session.id)).receipts).toHaveLength(1);
  } finally { await f.app.close(); }
});
test('10.4 package rollback requires inspecting the prior version and cache collection preserves referenced content', async ({ page }) => {
  const f = await fixture();
  const activate = async (id: string) => { await f.app.sessions.customizationAction({ action: 'package-activate', id, scope: 'project', authorize: true, sessionId: f.session.id }); await expect.poll(async () => (await f.app.sessions.describeCustomization(f.session.id)).receipts.at(-1)?.status).toBe('activated'); };
  try {
    await activate(f.candidate.id); await writeFile(join(f.source, 'skills/SKILL.md'), '---\nname: ui-skill\ndescription: Test skill\n---\nUpdated skill.\n');
    const update = await f.store.prepare({ kind: 'local', path: f.source }, 'project'); await activate(update.id);
    await page.goto(f.app.origin + f.url + '#token=' + f.app.token); const installed = page.getByRole('article', { name: '已安装能力包 ui-package', exact: true });
    await installed.getByRole('button', { name: '检查回退版本', exact: true }).click(); await installed.getByRole('button', { name: '授权并回退能力包', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText(f.candidate.revision);
    await page.getByRole('button', { name: '确认授权并回退能力包', exact: true }).click(); await expect.poll(async () => (await f.store.list())[0]?.revision).toBe(f.candidate.revision);
    await page.getByText('清理未引用能力包缓存', { exact: true }).click(); await page.getByRole('button', { name: '清理能力包缓存', exact: true }).click(); await page.getByRole('button', { name: '确认清理能力包缓存', exact: true }).click();
    await expect(page.getByText('清理完成：', { exact: false })).toBeVisible(); expect((await f.store.list())[0]?.revision).toBe(f.candidate.revision); expect((await f.store.previous(f.candidate.packageId)).revision).toBe(update.revision);
  } finally { await f.app.close(); }
});
