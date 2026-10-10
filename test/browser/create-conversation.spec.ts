import { test, expect } from '@playwright/test';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { readSession } from '../../src/journal.js';
import { Candidates } from '../../src/customization/candidates.js';
import { temporary, key, response, textItem, callItem } from '../helpers.js';
import { openSessionMenu } from './fixtures/workbench.js';

test('10.3 create input preserves independent drafts and explicitly runs against its own target', async ({ page }) => {
  const workspace = await temporary(), development = await temporary(); let calls = 0;
  const app = await startWeb({ workspace, home: await temporary(), naming: false, apiKey: key, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => response(++calls === 1 ? [callItem('customization_candidate', { action: 'create', name: 'from-browser' }, 'create-candidate')] : [textItem('创造任务完成，尚未应用')]) } });
  try {
    const work = await app.sessions.create('原工作', { mode: 'work', commandId: 'work' });
    const create = await app.sessions.create('创造目标', { mode: 'create', commandId: 'create', target: { kind: 'extension', root: development } });
    await page.goto(`${app.origin}/work/session/${work.id}#token=${app.token}`);
    await page.getByLabel('任务草稿', { exact: true }).fill('工作草稿保持原样');
    await page.goto(`${app.origin}/create/session/${create.id}`);
    await page.getByLabel('任务草稿', { exact: true }).fill('创造草稿保持独立');
    await openSessionMenu(page, '交接到工作会话');
    await page.getByLabel('交接目的', { exact: true }).fill('只预览');
    await page.getByLabel('交接目标会话', { exact: true }).selectOption(work.id);
    await page.getByRole('button', { name: '预览交接', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认选定快照', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消交接', exact: true }).click();
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','创造草稿保持独立'); expect(calls).toBe(0);
    await page.goto(`${app.origin}/work/session/${work.id}`);
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','工作草稿保持原样');
    await page.goto(`${app.origin}/create/session/${create.id}`);
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','创造草稿保持独立');
    await page.getByLabel('任务草稿', { exact: true }).fill('创建一个候选');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('创造任务完成，尚未应用', { exact: true })).toBeVisible({ timeout: 20000 });
    expect(await new Candidates(development).list()).toHaveLength(1); expect(await new Candidates(workspace).list()).toHaveLength(0); expect(calls).toBe(2);
    const events = (await readSession(join(app.sessions.root, create.id))).events;
    expect(events.filter(event => event.type === 'tool.intent')).toEqual([expect.objectContaining({ mode: 'create', targetId: create.binding!.target.id })]);
    await page.reload(); await expect(page.getByText('创造任务完成，尚未应用', { exact: true })).toBeVisible(); expect(calls).toBe(2);
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await app.close(); }
});
test('10.3 create task stop is explicit and cancels only its active request', async ({ page }) => {
  let calls = 0, aborted = false;
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, apiKey: key, staticDir: resolve('dist/web-dist'), runtime: { fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => { calls++; init?.signal?.addEventListener('abort', () => { aborted = true; reject(init.signal?.reason); }, { once: true }); }) } });
  try {
    const create = await app.sessions.create('可停止创造任务', { mode: 'create', commandId: 'create', target: { kind: 'extension', root: await temporary() } });
    await page.goto(`${app.origin}/create/session/${create.id}#token=${app.token}`);
    await page.getByLabel('任务草稿', { exact: true }).fill('等待我的停止'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await page.getByLabel('任务草稿', { exact: true }).fill('下一轮草稿'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '停止创造任务', exact: true }).click(); await expect.poll(() => aborted).toBe(true);
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','下一轮草稿');
    expect((await readSession(join(app.sessions.root, create.id))).events.findLast(event => event.type === 'run.finished')?.payload).toMatchObject({ status: 'cancelled' });
  } finally { await app.close(); }
});
