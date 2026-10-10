import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { Candidates } from '../../src/customization/candidates.js';
import { temporary } from '../helpers.js';
async function fixture() {
  const development = await temporary(), store = new Candidates(development), draft = await store.scaffold('managed', 'command');
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve('dist/web-dist') });
  const session = await app.sessions.create('候选管理', { commandId: 'candidate-manager', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
  return { development, store, draft, app, session, path: `/create/session/${session.id}/candidate/${draft.id}` };
}
test('10.4 candidate activation requires review and validation, reports actual loading and never installs in the work project', async ({ page }) => {
  const f = await fixture(), actions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) actions.push(request.postDataJSON().action); });
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token); await page.getByRole('tab', { name: '启用与导出', exact: true }).click();
    await expect(page.getByRole('button', { name: '授权并启用候选', exact: true })).toBeDisabled(); expect(actions).toEqual([]);
    await page.getByRole('tab', { name: '验证记录', exact: true }).click(); await page.getByRole('button', { name: '运行静态校验', exact: true }).click();
    await expect(page.getByText('静态校验：通过', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole('tab', { name: '启用与导出', exact: true }).click(); await page.getByRole('button', { name: '授权并启用候选', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('请求权限 commands'); await expect(page.getByRole('dialog')).toContainText(f.development);
    await page.getByRole('button', { name: '取消操作', exact: true }).click(); expect(await f.store.active()).toHaveLength(0);
    await page.getByRole('button', { name: '授权并启用候选', exact: true }).click(); await page.getByRole('button', { name: '确认授权并启用候选', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('region', { name: '候选加载收据', exact: true }).getByText(/ · 加载完成$/)).toBeVisible({ timeout: 15000 });
    expect(await f.store.active()).toHaveLength(1); expect((await f.app.sessions.describeCustomization()).managed).toHaveLength(0);
    expect(actions.filter(action => action === 'candidate-activate')).toHaveLength(1);
    await page.reload(); await page.getByRole('tab', { name: '启用与导出', exact: true }).click(); expect(actions.filter(action => action === 'candidate-activate')).toHaveLength(1);
  } finally { await f.app.close(); }
});
test('10.4 export review is explicit, preserves the nonsecret path and refuses existing files', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token); await page.getByRole('tab', { name: '启用与导出', exact: true }).click();
    await page.getByLabel('候选导出文件路径', { exact: true }).fill('reviewed.tgz'); await page.getByRole('button', { name: '导出候选归档', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('reviewed.tgz'); await page.getByRole('button', { name: '确认导出候选归档', exact: true }).click();
    await expect(page.getByText('已导出：', { exact: false })).toBeVisible(); const before = await readFile(join(f.development, 'reviewed.tgz')); expect(before.length).toBeGreaterThan(100);
    await page.getByRole('button', { name: '导出候选归档', exact: true }).click(); await page.getByRole('button', { name: '确认导出候选归档', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('操作未确认'); await expect(page.getByRole('button', { name: '确认导出候选归档', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消操作', exact: true }).click(); await expect(page.getByLabel('候选导出文件路径', { exact: true })).toHaveValue('reviewed.tgz');
    expect(await readFile(join(f.development, 'reviewed.tgz'))).toEqual(before); expect(await f.store.active()).toHaveLength(0);
  } finally { await f.app.close(); }
});
test('10.4 rollback reviews the immutable prior version and changed candidates cannot use old consent', async ({ page }) => {
  const f = await fixture();
  const activate = async () => {
    const view = await f.app.sessions.candidateView(f.draft.id, f.session.id), data = await f.app.sessions.describeCustomization(f.session.id);
    await f.app.sessions.customizationAction({ action: 'candidate-activate', id: f.draft.id, contentHash: view.contentHash, authorize: true, revision: data.settingsRevision, activeRevision: view.activeRevision, sessionId: f.session.id });
    await expect.poll(async () => (await f.app.sessions.describeCustomization(f.session.id)).receipts.at(-1)?.status).toBe('activated');
    return view.contentHash;
  };
  try {
    const prior = await activate(); await writeFile(join(f.draft.path, 'index.ts'), 'export default () => {};'); const second = await activate();
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token); await page.getByRole('tab', { name: '启用与导出', exact: true }).click();
    await page.getByRole('button', { name: '回退候选版本', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText(prior); await expect(page.getByRole('dialog')).toContainText('请求权限 commands');
    const settings = await f.app.sessions.describeCustomization(f.session.id);
    await f.app.sessions.customizationAction({ action: 'user-writes', enabled: true, revision: settings.settingsRevision, sessionId: f.session.id });
    await page.getByRole('button', { name: '确认回退候选版本', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('授权修订已变化'); expect((await f.store.active())[0]?.revision).toBe(second);
    await page.getByRole('button', { name: '取消操作', exact: true }).click();
    await page.getByRole('button', { name: '回退候选版本', exact: true }).click();
    await page.getByRole('button', { name: '确认回退候选版本', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await f.store.active())[0]?.revision).toBe(prior);
    await page.getByRole('tab', { name: '验证记录', exact: true }).click(); await page.getByRole('button', { name: '运行静态校验', exact: true }).click(); await expect(page.getByText('静态校验：通过', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole('tab', { name: '启用与导出', exact: true }).click(); await page.getByRole('button', { name: '刷新候选状态', exact: true }).click();
    await page.getByRole('button', { name: '授权并启用候选', exact: true }).click(); await writeFile(join(f.draft.path, 'index.ts'), 'export default () => { /* changed during review */ };');
    await page.getByRole('button', { name: '确认授权并启用候选', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('候选或已选择版本已变化');
    await expect(page.getByRole('button', { name: '确认授权并启用候选', exact: true })).toBeDisabled();
    await expect.poll(async () => (await f.app.sessions.describeCustomization(f.session.id)).receipts.length).toBe(3);
    expect((await f.store.active())[0]?.revision).toBe(prior);
  } finally { await f.app.close(); }
});
