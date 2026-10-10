import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { temporary } from '../helpers.js';
import { oauthFixture } from '../fixtures/oauth-server.js';
import { startWeb } from '../../src/server/app.js';
async function fixture() {
  const oauth = await oauthFixture(), development = await temporary(), home = await temporary();
  const path = join(development, '.nekomimi/mcp.json'); await mkdir(join(development, '.nekomimi'), { recursive: true });
  const config = { version: 1, servers: { oauth: { ...oauth.resource.config, oauth: { issuer: oauth.resource.config!.oauth!.issuer, dynamicRegistration: true } } } };
  await writeFile(path, JSON.stringify(config));
  const app = await startWeb({ workspace: await temporary(), home, naming: false, staticDir: resolve('dist/web-dist') });
  const session = await app.sessions.create('MCP 开发', { commandId: 'mcp-page', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
  return { app, session, oauth, path, config, url: `/create/session/${session.id}/mcp` };
}
test('10.4 MCP browsing does not connect, consent starts OAuth and callback never enables the resource', async ({ page, context }) => {
  const f = await fixture(); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) posts++; });
  try {
    await page.goto(f.app.origin + f.url + '#token=' + f.app.token);
    await expect(page.getByRole('heading', { name: 'MCP 连接与授权', exact: true })).toBeVisible(); expect(f.oauth.requests).toHaveLength(0);
    await page.getByRole('button', { name: '开始 MCP 授权', exact: true }).click(); await page.getByRole('button', { name: '取消操作', exact: true }).click();
    expect(posts).toBe(0); expect(f.oauth.requests).toHaveLength(0);
    await page.getByRole('button', { name: '开始 MCP 授权', exact: true }).click(); await page.getByRole('button', { name: '确认开始 MCP 授权', exact: true }).click();
    const popupPromise = context.waitForEvent('page'); await page.getByRole('link', { name: '打开 MCP 授权页面', exact: true }).click(); const popup = await popupPromise;
    await expect(popup.locator('body')).toContainText('授权完成'); await popup.close();
    await expect(page.getByRole('region', { name: '授权 oauth', exact: true }).getByText('已授权', { exact: true })).toBeVisible();
    expect(f.oauth.counts()).toMatchObject({ grants: 1, registrations: 1 });
    expect((await f.app.sessions.describeCustomization(f.session.id)).activeResources.some(resource => resource.kind === 'mcp')).toBe(false);
    await page.reload(); await expect(page.getByText('已授权', { exact: true })).toBeVisible(); expect(f.oauth.counts().grants).toBe(1);
    expect(await page.content()).not.toContain('initial-secret'); expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('refresh-secret');
    await page.getByRole('button', { name: '断开 MCP 授权', exact: true }).click(); await page.getByRole('button', { name: '确认断开 MCP 授权', exact: true }).click();
    await expect(page.getByText('已断开授权', { exact: true })).toBeVisible(); expect(posts).toBe(2);
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.app.close(); await f.oauth.close(); }
});
test('10.4 changed MCP configuration rejects stale consent without discovery or automatic retry', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(f.app.origin + f.url + '#token=' + f.app.token); await page.getByRole('button', { name: '开始 MCP 授权', exact: true }).click();
    await writeFile(f.path, JSON.stringify({ ...f.config, servers: { oauth: { ...f.config.servers.oauth, oauth: { ...f.config.servers.oauth.oauth, scope: 'changed' } } } }));
    const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/customization'));
    await page.getByRole('button', { name: '确认开始 MCP 授权', exact: true }).click(); expect((await response).status()).toBe(409);
    expect(f.oauth.requests).toHaveLength(0);
    await expect(page.getByRole('alert')).toContainText('MCP 连接配置已变化');
    await expect(page.getByRole('button', { name: '确认开始 MCP 授权', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: '打开 MCP 授权页面', exact: true })).toHaveCount(0);
  } finally { await f.app.close(); await f.oauth.close(); }
});

test('10.4 pending MCP authorization survives refresh without persisting its link or restarting automatically', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(f.app.origin + f.url + '#token=' + f.app.token);
    await page.getByRole('button', { name: '开始 MCP 授权', exact: true }).click(); await page.getByRole('button', { name: '确认开始 MCP 授权', exact: true }).click();
    await expect(page.getByRole('link', { name: '打开 MCP 授权页面', exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole('button', { name: '开始 MCP 授权', exact: true })).toBeDisabled();
    await expect(page.getByText('授权仍在等待。', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: '打开 MCP 授权页面', exact: true })).toHaveCount(0);
    expect(f.oauth.counts()).toMatchObject({ registrations: 1, grants: 0 });
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('code_challenge');
    await page.getByRole('button', { name: '断开 MCP 授权', exact: true }).click(); await page.getByRole('button', { name: '确认断开 MCP 授权', exact: true }).click();
    await expect(page.getByText('已断开授权', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '开始 MCP 授权', exact: true })).toBeEnabled();
    expect(f.oauth.counts()).toMatchObject({ registrations: 1, grants: 0 });
  } finally { await f.app.close(); await f.oauth.close(); }
});
