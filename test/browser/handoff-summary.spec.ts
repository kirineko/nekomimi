import { test, expect } from '@playwright/test';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { Journal, hash, readSession } from '../../src/journal.js';
import { temporary, key, response, textItem } from '../helpers.js';
import type { Page } from '@playwright/test';
import { openSessionMenu } from './fixtures/workbench.js';
async function fixture(transport?: typeof fetch, configured = true) {
  let calls = 0;
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve('dist/web-dist'), ...(configured ? { apiKey: key } : {}), runtime: { fetch: async (...args) => { calls++; return transport ? transport(...args) : response([textItem('模型准备的最小摘要')]); } } });
  const source = await app.sessions.create('摘要来源', { mode: 'work', commandId: 'source' });
  const target = await app.sessions.create('独立目标', { mode: 'create', commandId: 'target', target: { kind: 'extension', root: await temporary() } });
  return { app, source, target, calls: () => calls };
}
async function preview(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  await page.goto(`${f.app.origin}/work/session/${f.source.id}#token=${f.app.token}`);
  await openSessionMenu(page, '交接到创造会话');
  await page.getByLabel('交接目的', { exact: true }).fill('为开发任务准备摘要');
  await page.getByLabel('交接目标会话', { exact: true }).selectOption(f.target.id);
  await page.getByRole('button', { name: '预览交接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认选定快照', exact: true })).toBeVisible();
}
test('10.3 explicit summary is separately reviewed and never confirms the handoff', async ({ page }) => {
  const f = await fixture();
  try {
    await preview(page, f); expect(f.calls()).toBe(0);
    await expect(page.getByRole('button', { name: '生成交接摘要', exact: true })).toBeDisabled();
    await page.getByLabel('我授权调用模型为此预览生成摘要', { exact: true }).check();
    await page.getByRole('button', { name: '生成交接摘要', exact: true }).click();
    await expect(page.getByText('模型准备的最小摘要', { exact: true })).toBeVisible(); expect(f.calls()).toBe(1);
    expect((await f.app.sessions.handoffStates(f.source.id)).items).toHaveLength(0);
    await page.getByRole('button', { name: '采用摘要并重新审阅', exact: true }).click();
    await expect(page.getByLabel('交接摘要', { exact: true })).toHaveValue('模型准备的最小摘要');
    await expect(page.getByRole('button', { name: '确认交接', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '预览交接', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认交接', exact: true })).toBeDisabled();
    expect(f.calls()).toBe(1); expect((await f.app.sessions.handoffStates(f.source.id)).items).toHaveLength(0);
    await page.getByLabel('我确认将以上快照交接到此目标', { exact: true }).check();
    await page.getByRole('button', { name: '确认交接', exact: true }).click();
    await expect(page.getByRole('link', { name: '查看接收会话', exact: true })).toBeVisible();
    expect((await f.app.sessions.handoffRelations(f.target.id)).items[0]?.snapshot.summary).toBe('模型准备的最小摘要');
  } finally { await f.app.close(); }
});
test('10.3 explicit summary cancellation records its terminal and retry does not call the model again', async ({ page }) => {
  let aborted = false;
  const f = await fixture(async (_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { aborted = true; reject(init.signal?.reason); }, { once: true }); }));
  let commandId = '';
  page.on('request', request => { if (request.url().endsWith('/handoff-summary')) commandId = request.postDataJSON().commandId; });
  try {
    await preview(page, f); await page.getByLabel('我授权调用模型为此预览生成摘要', { exact: true }).check();
    await page.getByRole('button', { name: '生成交接摘要', exact: true }).click();
    await expect.poll(() => f.calls()).toBe(1);
    await page.getByRole('button', { name: '停止摘要准备', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '摘要未采用' })).toBeVisible(); expect(aborted).toBe(true);
    const directory = join(f.app.sessions.paths.root, 'handoff-preparations', hash(JSON.stringify([f.source.id, commandId])));
    expect((await readSession(directory)).events.some(event => event.type === 'handoff.summary.cancelled')).toBe(true);
    await page.getByRole('button', { name: '重取原摘要准备结果', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '不能自动重跑' })).toBeVisible(); expect(f.calls()).toBe(1);
    expect((await f.app.sessions.handoffStates(f.source.id)).items).toHaveLength(0);
  } finally { await f.app.close(); }
});
test('10.3 changing preview input aborts summary and preserves the new draft', async ({ page }) => {
  let aborted = false;
  const f = await fixture(async (_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { aborted = true; reject(init.signal?.reason); }, { once: true }); }));
  try {
    await preview(page, f); await page.getByLabel('我授权调用模型为此预览生成摘要', { exact: true }).check();
    await page.getByRole('button', { name: '生成交接摘要', exact: true }).click(); await expect.poll(() => f.calls()).toBe(1);
    await page.getByLabel('交接目的', { exact: true }).fill('新的目的');
    await expect.poll(() => aborted).toBe(true);
    await expect(page.getByRole('button', { name: '采用摘要并重新审阅', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('交接目的', { exact: true })).toHaveValue('新的目的');
    expect((await f.app.sessions.handoffStates(f.source.id)).items).toHaveLength(0);
  } finally { await f.app.close(); }
});
test('10.3 a changed source revision rejects the completed summary', async ({ page }) => {
  let release!: (response: Response) => void;
  const responseReady = new Promise<Response>(resolve => { release = resolve; });
  const f = await fixture(async () => responseReady);
  try {
    await preview(page, f); await page.getByLabel('我授权调用模型为此预览生成摘要', { exact: true }).check();
    await page.getByRole('button', { name: '生成交接摘要', exact: true }).click(); await expect.poll(() => f.calls()).toBe(1);
    const journal = await Journal.open(join(f.app.sessions.root, f.source.id)); await journal.append('session.title', { title: '新的源版本', source: 'user' }); await journal.close();
    release(response([textItem('不应采用的迟到摘要')]));
    await expect(page.getByRole('alert').filter({ hasText: '摘要未采用' })).toContainText('源记录');
    await expect(page.getByRole('button', { name: '采用摘要并重新审阅', exact: true })).toHaveCount(0);
    expect((await f.app.sessions.handoffStates(f.source.id)).items).toHaveLength(0);
  } finally { release(response([textItem('结束')])); await f.app.close(); }
});
test('10.3 missing summary credentials show a local error without a model call', async ({ page }) => {
  const f = await fixture(undefined, false);
  try {
    await preview(page, f); await page.getByLabel('我授权调用模型为此预览生成摘要', { exact: true }).check();
    await page.getByRole('button', { name: '生成交接摘要', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '摘要未采用' })).toContainText('未配置凭证');
    expect(f.calls()).toBe(0); expect((await f.app.sessions.handoffStates(f.source.id)).items).toHaveLength(0);
  } finally { await f.app.close(); }
});
