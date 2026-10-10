import { test, expect } from '@playwright/test';
import { mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { ProviderProfiles } from '../../src/customization/provider-profiles.js';
import { temporary } from '../helpers.js';
async function fixture(custom = false) {
  const workspace = await temporary(), home = await temporary(); let calls = 0;
  const app = await startWeb({ workspace, home, naming: false, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { calls++; throw Error('No model call expected'); } } });
  await app.sessions.waitInitialization();
  if (custom) {
    const root = join(workspace, '.nekomimi/extensions/providers'); await mkdir(root, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'providers', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['providers'] }));
    await copyFile(resolve('extension-docs/http-providers.ts'), join(root, 'index.ts'));
    const resource = (await app.sessions.customization.catalog.discover()).find(item => item.name === 'providers')!;
    await app.sessions.customization.catalog.decide(resource.id, true, true, 0); await app.sessions.customization.initialize();
  }
  return { app, profiles: new ProviderProfiles(home), calls: () => calls };
}
const builtin = (id: string) => ({ id, providerId: 'deepseek', resourceId: 'builtin:deepseek', model: 'deepseek-flash', baseUrl: 'https://fixture.invalid', paths: ['/responses'], credentialRef: id });
test('10.4 purpose confirmation changes only create and distinguishes missing profile credentials', async ({ page }) => {
  const f = await fixture(); const actions: string[] = [];
  try {
    await f.profiles.save(builtin('work-choice'), 0); await f.profiles.save(builtin('create-choice'), 1);
    await f.profiles.saveCredential('work-choice', 'fixture-private-key'); await f.profiles.select('work','work-choice',2);
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) actions.push(request.postDataJSON().action); });
    await page.goto(f.app.origin + '/work/models#token=' + f.app.token);
    await page.getByRole('button', { name: '选择创造对话模型', exact: true }).click();
    await page.getByLabel('创造对话模型配置', { exact: true }).selectOption('create-choice');
    await expect(page.getByLabel('创造对话模型配置').locator('option:checked')).toContainText('未配置凭证');
    await page.getByRole('button', { name: '取消选择', exact: true }).click(); expect(actions).toEqual([]);
    await page.getByRole('button', { name: '选择创造对话模型', exact: true }).click();
    await page.getByLabel('创造对话模型配置', { exact: true }).selectOption('create-choice');
    await page.getByRole('button', { name: '确认用途选择', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await f.profiles.list()).selection).toEqual({ work: 'work-choice', create: 'create-choice' }); expect(actions).toEqual(['provider-select']); expect(f.calls()).toBe(0);
    await page.reload(); await expect(page.getByText('deepseek / deepseek-flash · create-choice · 未配置凭证', { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain('fixture-private-key');
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.app.close(); }
});
test('10.4 stale purpose revision fails without automatic retry or changing another purpose', async ({ page }) => {
  const f = await fixture(); let posts = 0;
  try {
    await f.profiles.save(builtin('chosen'),0);
    await page.goto(f.app.origin + '/work/models#token=' + f.app.token);
    await page.getByRole('button', { name: '选择创造对话模型', exact: true }).click(); await page.getByLabel('创造对话模型配置').selectOption('chosen');
    await f.profiles.select('work','chosen',1);
    page.on('request', request => { if (request.url().endsWith('/customization') && request.method() === 'POST') posts++; });
    await page.getByRole('button', { name: '确认用途选择', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('保存失败'); await expect(page.getByRole('button', { name: '确认用途选择', exact: true })).toBeDisabled();
    expect(posts).toBe(1); expect((await f.profiles.list()).selection).toEqual({ work: 'chosen' });
    await page.getByRole('button', { name: '取消选择', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择创造对话模型', exact: true })).toBeFocused();
  } finally { await f.app.close(); }
});
test('10.4 profile conflict clears the secret and preserves nonsecret fields until explicit revision review', async ({ page }) => {
  const f = await fixture(true); let saves = 0;
  try {
    await page.goto(f.app.origin + '/work/models#token=' + f.app.token); await page.getByRole('button', { name: '新增模型配置', exact: true }).click();
    await page.getByLabel('模型配置名称', { exact: true }).fill('new-profile'); await page.getByLabel('模型 Provider', { exact: true }).selectOption('example-responses');
    await page.getByLabel('模型与操作', { exact: true }).selectOption(JSON.stringify(['example-responses','chat','fixture-model']));
    await page.getByLabel('Provider 服务地址', { exact: true }).fill('https://fixture.invalid/v1'); await page.getByLabel('Provider API key', { exact: true }).fill('editor-private-key');
    await f.profiles.save(builtin('concurrent'),0);
    page.on('request', request => { if (request.url().endsWith('/customization') && request.method() === 'POST' && request.postDataJSON().action === 'provider-save') saves++; });
    await page.getByRole('button', { name: '授权并保存模型配置', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('配置未确认保存'); await expect(page.getByLabel('Provider API key', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('模型配置名称', { exact: true })).toHaveValue('new-profile'); await expect(page.getByLabel('Provider 服务地址', { exact: true })).toHaveValue('https://fixture.invalid/v1');
    expect(saves).toBe(1); expect(await page.content()).not.toContain('editor-private-key');
    await page.getByRole('button', { name: '采用当前修订继续编辑', exact: true }).click(); await page.getByRole('button', { name: '授权并保存模型配置', exact: true }).click();
    await expect(page.getByRole('region', { name: '新增模型配置', exact: true })).toHaveCount(0);
    expect((await f.profiles.list()).entries['new-profile']).toMatchObject({ providerId: 'example-responses', credentialRef: expect.stringMatching(/^profile-/), operation: 'chat' });
    expect(saves).toBe(2); expect(f.calls()).toBe(0);
  } finally { await f.app.close(); }
});
test('10.4 no custom provider and no builtin credentials stay explicit', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(f.app.origin + '/create/models#token=' + f.app.token);
    await expect(page.getByText('默认 DeepSeek / deepseek-flash · 未配置凭证 · Responses', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '新增模型配置', exact: true }).click();
    await expect(page.getByText('没有已启用的自定义 Provider。先在能力目录检查资源及授权。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '授权并保存模型配置', exact: true })).toHaveCount(0);
    expect(f.calls()).toBe(0);
  } finally { await f.app.close(); }
});

test('10.4 uncertain credential write is redacted and cannot be retried with an empty secret', async ({ page }) => {
  const f = await fixture(true); let credentials = 0, profiles = 0;
  await page.route('**/api/v1/customization', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const input = route.request().postDataJSON();
    if (input.action === 'provider-credential') { credentials++; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'fixture', message: `unconfirmed: ${input.secret}` } }) }); return; }
    if (input.action === 'provider-save') profiles++;
    await route.continue();
  });
  try {
    await page.goto(f.app.origin + '/work/models#token=' + f.app.token); await page.getByRole('button', { name: '新增模型配置', exact: true }).click();
    await page.getByLabel('模型配置名称', { exact: true }).fill('uncertain'); await page.getByLabel('模型 Provider', { exact: true }).selectOption('example-responses');
    await page.getByLabel('模型与操作', { exact: true }).selectOption(JSON.stringify(['example-responses','chat','fixture-model']));
    await page.getByLabel('Provider 服务地址', { exact: true }).fill('https://fixture.invalid'); await page.getByLabel('Provider API key', { exact: true }).fill('credential-failure-private');
    await page.getByRole('button', { name: '授权并保存模型配置', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('[已隐藏]'); await expect(page.getByLabel('Provider API key', { exact: true })).toHaveValue('');
    expect(await page.content()).not.toContain('credential-failure-private'); expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('credential-failure-private');
    await page.getByRole('button', { name: '授权并保存模型配置', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('重新输入密钥'); expect(credentials).toBe(1); expect(profiles).toBe(0);
    await expect(page.getByLabel('Provider 服务地址', { exact: true })).toHaveValue('https://fixture.invalid');
    await page.getByRole('button', { name: '取消编辑', exact: true }).click(); await page.getByRole('button', { name: '新增模型配置', exact: true }).click();
    await expect(page.getByLabel('模型配置名称', { exact: true })).toHaveValue(''); await expect(page.getByLabel('Provider API key', { exact: true })).toHaveValue('');
  } finally { await f.app.close(); }
});
