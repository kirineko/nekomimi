import { test, expect } from '@playwright/test';
import { writeFile, readFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { Candidates } from '../../src/customization/candidates.js';
import { readSession } from '../../src/journal.js';
import { temporary } from '../helpers.js';

async function fixture() {
  const development = await temporary(), candidate = await new Candidates(development).scaffold('preview', 'panel');
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve('dist/web-dist') });
  const session = await app.sessions.create('预览开发', { commandId: 'create-ui', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
  return { development, candidate, app, session, path: `/create/session/${session.id}/candidate/${candidate.id}` };
}
test('10.2 scoped differences and saved validation survive navigation without automatic validation', async ({ page }) => {
  const f = await fixture(), actions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/customization')) actions.push(request.postDataJSON().action); });
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    await expect(page.getByRole('heading', { name: 'preview', exact: true })).toBeVisible();
    await expect(page.getByText('静态校验：未运行', { exact: true })).toBeVisible();
    await page.getByText('新增 · index.ts', { exact: true }).click(); await expect(page.getByText('api.registerPanel', { exact: false })).toBeVisible();
    await page.getByRole('tab', { name: '验证记录' }).click(); await expect(page.getByText('当前内容尚无验证记录', { exact: true })).toBeVisible(); expect(actions).toEqual([]);
    await page.getByRole('button', { name: '运行静态校验' }).click(); await expect(page.getByText('静态校验：通过', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.reload(); await page.getByRole('tab', { name: '验证记录' }).click(); await expect(page.getByText('静态校验：通过', { exact: true })).toBeVisible();
    expect(actions.filter(action => action === 'candidate-validation-start')).toHaveLength(1);
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.app.close(); }
});
test('10.2 panel preview needs explicit authorization and resolves the selected target frame', async ({ page }) => {
  const f = await fixture(), actions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/customization')) actions.push(request.postDataJSON().action); });
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token); await page.getByRole('tab', { name: '运行预览', exact: true }).click();
    const run = page.getByRole('button', { name: '运行候选预览' }); await expect(run).toBeDisabled(); expect(actions).toEqual([]);
    await page.getByLabel('预览数据 JSON').fill(JSON.stringify({ text: '预览已运行' })); await page.getByLabel('我授权执行当前候选的预览代码').check(); await run.click();
    await expect(page.frameLocator('iframe[title="候选预览 preview"]').getByText('预览已运行', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('视图预览：通过', { exact: true })).toBeVisible(); await expect(page.getByText('宿主验收：未运行', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '内容差异' }).click(); await page.getByRole('tab', { name: '运行预览', exact: true }).click();
    await expect(page.locator('iframe[title="候选预览 preview"]')).toHaveCount(0); expect(actions.filter(action => action === 'candidate-execution-start')).toHaveLength(1);
    expect((await readSession(join(f.development, '.nekomimi/panel-history'))).events.filter(event => event.type === 'panel.preview.intent')).toHaveLength(1);
  } finally { await f.app.close(); }
});
test('10.2 target creation and candidate loading failures remain distinct', async ({ page }) => {
  const development = await temporary(), app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve('dist/web-dist') });
  try {
    await page.goto(app.origin + '/create#token=' + app.token); await page.getByLabel('创造会话名称').fill('独立目标'); await page.getByLabel('独立开发目录').fill(development); await page.getByRole('button', { name: '建立创造会话' }).click();
    await expect(page).toHaveURL(/\/create\/session\//); await expect(page.getByRole('heading', { name: '此目标尚无扩展候选' })).toBeVisible();
    await page.goto(app.origin + '/create/candidate/missing'); await expect(page.getByRole('heading', { name: '候选不存在或暂不可读' })).toBeVisible();
  } finally { await app.close(); }
});
test('10.2 delayed reads show loading and a preview response arriving after navigation does not reopen the frame', async ({ page }) => {
  const f = await fixture(); let releaseRead!: () => void, releasePreview!: () => void, previewEntered!: () => void;
  const reading = new Promise<void>(resolve => { releaseRead = resolve; }), previewing = new Promise<void>(resolve => { releasePreview = resolve; }), entered = new Promise<void>(resolve => { previewEntered = resolve; });
  let accepted = 0;
  await page.route('**/api/v1/customization/candidates/**', async route => { await reading; await route.continue(); });
  await page.route('**/api/v1/customization', async route => {
    if (route.request().method() === 'POST') {
      const action = route.request().postDataJSON().action;
      if (action === 'candidate-execution-start') { previewEntered(); await previewing; accepted++; }
    }
    await route.continue();
  });
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token); await expect(page.getByRole('heading', { name: '正在读取候选…' })).toBeVisible(); releaseRead();
    await page.getByRole('tab', { name: '运行预览', exact: true }).click(); await page.getByLabel('我授权执行当前候选的预览代码').check(); await page.getByRole('button', { name: '运行候选预览' }).click(); await entered;
    await page.getByRole('tab', { name: '内容差异' }).click(); releasePreview(); await expect.poll(() => accepted).toBe(1);
    await expect.poll(async () => (await f.app.sessions.validationTaskView(f.session.id))[0]?.status, { timeout: 20000 }).toBe('passed');
    await page.getByRole('tab', { name: '运行预览', exact: true }).click(); await expect(page.locator('iframe[title="候选预览 preview"]')).toHaveCount(0);
  } finally { releaseRead(); releasePreview(); await f.app.close(); }
});

test('10.2 background validation exposes its durable identity and acknowledges cancellation', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    await page.getByRole('tab', { name: '验证记录' }).click();
    await page.getByRole('button', { name: '运行静态校验' }).click();
    await page.getByRole('button', { name: '请求停止验证' }).click();
    await expect(page.getByRole('heading', { name: '静态校验任务 · 已取消', exact: true })).toBeVisible();
    await expect(page.getByText('静态校验：已取消', { exact: true })).toBeVisible();
    const tasks = (await f.app.sessions.candidateView(f.candidate.id, f.session.id)).validationTasks;
    expect(tasks).toHaveLength(1); expect(tasks[0]?.cancelRequested).toBe(true);
    await page.goto(f.app.origin + '/work'); await page.goto(f.app.origin + f.path);
    await page.getByRole('tab', { name: '验证记录' }).click();
    await expect(page.getByRole('article', { name: `验证任务 ${tasks[0]!.id}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: '静态校验任务 · 已取消', exact: true })).toBeVisible();
    expect((await f.app.sessions.candidateView(f.candidate.id, f.session.id)).validationTasks).toHaveLength(1);
    await page.screenshot({ path: '/tmp/nekomimi-create-validation-task.png', fullPage: true });
  } finally { await f.app.close(); }
});


test('10.2 simulation exposes durable results without replay on return', async ({ page }) => {
  const f = await fixture();
  const candidate = await new Candidates(f.development).scaffold('simulate', 'command');
  try {
    const path = `/create/session/${f.session.id}/candidate/${candidate.id}`;
    await page.goto(f.app.origin + path + '#token=' + f.app.token);
    await page.getByRole('tab', { name: '模拟试运行', exact: true }).click();
    await expect(page.getByRole('button', { name: '运行候选模拟' })).toBeDisabled();
    await page.getByLabel('模拟命令', { exact: true }).fill('/simulate 模拟完成');
    await page.getByLabel('我授权执行当前候选的模拟代码').check();
    await page.getByRole('button', { name: '运行候选模拟' }).click();
    await expect(page.getByText('模拟试运行：通过', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('模拟完成', { exact: true })).toBeVisible();
    await page.reload(); await page.getByRole('tab', { name: '验证记录' }).click();
    await expect(page.getByText('模拟完成', { exact: true })).toBeVisible();
    expect(await f.app.sessions.validationTaskView(f.session.id)).toHaveLength(1);
  } finally { await f.app.close(); }
});
test('10.2 unavailable target retains background preview cancellation', async ({ page }) => {
  const f = await fixture(), marker = join(await temporary(), 'pid'); let moved = false;
  await writeFile(join(f.candidate.path, 'index.ts'), `import {writeFileSync} from 'node:fs'; export default()=>{writeFileSync(${JSON.stringify(marker)},String(process.pid));while(true){}};`);
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    await page.getByRole('tab', { name: '运行预览', exact: true }).click();
    await page.getByLabel('我授权执行当前候选的预览代码').check();
    await page.getByRole('button', { name: '运行候选预览' }).click();
    await expect.poll(() => readFile(marker, 'utf8').catch(() => ''), { timeout: 20000 }).not.toBe('');
    await rename(f.development, f.development + '-moved'); moved = true;
    await page.reload();
    await expect(page.getByRole('heading', { name: '候选不存在或暂不可读' })).toBeVisible();
    await page.getByRole('button', { name: '请求停止验证' }).click();
    await expect.poll(async () => (await f.app.sessions.validationTaskView(f.session.id))[0]?.status).toBe('cancelled');
    const pid = Number(await readFile(marker, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
  } finally { if (moved) await rename(f.development + '-moved', f.development); await f.app.close(); }
});


test('10.2 closed preview is reported expired and invalid props never start execution', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(f.app.origin + f.path + '#token=' + f.app.token);
    await page.getByRole('tab', { name: '运行预览', exact: true }).click();
    await page.getByLabel('我授权执行当前候选的预览代码').check();
    await page.getByLabel('预览数据 JSON').fill('{');
    await page.getByRole('button', { name: '运行候选预览' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await f.app.sessions.validationTaskView(f.session.id)).toHaveLength(0);
    await page.getByLabel('预览数据 JSON').fill('{}');
    await page.getByRole('button', { name: '运行候选预览' }).click();
    await expect(page.locator('iframe[title="候选预览 preview"]')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭预览' }).click();
    const tasks = await f.app.sessions.validationTaskView(f.session.id);
    await expect.poll(async () => { try { await f.app.sessions.validationPreview(f.session.id, tasks[0]!.id); return false; } catch { return true; } }).toBe(true);
    await page.getByRole('button', { name: '打开已完成预览' }).click();
    await expect(page.getByRole('alert')).toContainText('不会自动重新执行候选');
    expect(await f.app.sessions.validationTaskView(f.session.id)).toHaveLength(1);
  } finally { await f.app.close(); }
});
