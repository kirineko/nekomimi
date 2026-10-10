import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { Journal } from '../../src/journal.js';
import { startWeb } from '../../src/server/app.js';
import { temporary } from '../helpers.js';
import { createTask } from './fixtures/workbench.js';

let app: Awaited<ReturnType<typeof startWeb>>;
let sessionId: string;
test.beforeEach(async ({ page }) => {
  app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false,
    staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { throw Error('History must be read-only'); } } });
  const session = await app.sessions.create('虚拟历史'); sessionId = session.id;
  const entry = await app.sessions.entry(session.id), journal = await Journal.open(entry.directory);
  for (let i = 0; i < 450; i++) await journal.append('context.add', {
    source: 'user', item: { role: 'user', content: [{ type: 'input_text', text: `历史记录 ${i}\n` + '可选择的历史文本。'.repeat(20) }] },
  }, {}, false);
  await journal.flush(); await journal.close();
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByText(/^历史记录 449/)).toBeInViewport();
});
test.afterEach(async () => { await app.close(); });
const surface = (page: Page) => page.getByTestId('timeline');
async function settled(page: Page) {
  await surface(page).evaluate(el => new Promise<void>(resolve => {
    let previous = el.scrollTop, stable = 0;
    const sample = () => {
      if (Math.abs(previous - el.scrollTop) < 0.1) stable++; else stable = 0;
      previous = el.scrollTop;
      if (stable >= 8) resolve(); else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}
async function anchor(page: Page) {
  return surface(page).evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll<HTMLElement>('[data-row-id]')].find(row => row.getBoundingClientRect().bottom > top + 40)!;
    return { id: row.dataset.rowId!, offset: row.getBoundingClientRect().top - top };
  });
}
async function expectAnchor(page: Page, saved: Awaited<ReturnType<typeof anchor>>) {
  await expect.poll(() => surface(page).evaluate((el, saved) => {
    const row = [...el.querySelectorAll<HTMLElement>('[data-row-id]')].find(row => row.dataset.rowId === saved.id);
    return row ? Math.abs(row.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset) : Infinity;
  }, saved)).toBeLessThan(3);
}

test('10.7 bounded virtual history preserves prepend, failure and latest navigation', async ({ page }) => {
  expect(await surface(page).locator('article').count()).toBeLessThan(40);
  await surface(page).evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); el.scrollTop -= 400; });
  await expect(page.getByRole('button', { name: '返回最新', exact: true })).toBeVisible();
  const saved = await anchor(page);
  await page.getByRole('button', { name: '查看更早', exact: true }).click();
  await expect(surface(page).locator('[data-row-id]')).toHaveCount(120);
  await expectAnchor(page, saved);
  await page.route('**/snapshot?before=*', route => route.fulfill({ status: 503, json: { error: { message: 'unavailable' } } }), { times: 1 });
  const beforeFailure = await anchor(page);
  await page.getByRole('button', { name: '查看更早', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试查看更早', exact: true })).toBeEnabled();
  await expectAnchor(page, beforeFailure);
  await page.getByRole('button', { name: '重试查看更早', exact: true }).click();
  await expect(surface(page).locator('[data-row-id]')).toHaveCount(180);
  for (let i = 0; i < 5; i++) {
    const button = page.getByRole('button', { name: '查看更早', exact: true });
    await expect(button).toBeEnabled(); await button.click();
    await expect(page.getByRole('navigation', { name: '历史导航' })).toHaveAttribute('aria-busy', 'false');
  }
  await expect(page.getByRole('button', { name: '查看更早', exact: true })).toHaveCount(0);
  expect(await surface(page).locator('[data-row-id]').count()).toBeLessThanOrEqual(180);
  await page.getByRole('button', { name: '返回最新', exact: true }).click();
  await expect(page.getByText(/^历史记录 449/)).toBeInViewport();
  await expect(page.getByRole('button', { name: '返回最新', exact: true })).toHaveCount(0);
});

test('10.7 selection, keyboard and responsive layout keep the same reading surface and draft', async ({ page }, info) => {
  const timeline = surface(page);
  await page.getByLabel('任务草稿').fill('跨断点草稿');
  await timeline.focus(); await page.keyboard.press('PageUp'); await settled(page);
  await expect(page.getByRole('button', { name: '返回最新', exact: true })).toBeVisible();
  await timeline.evaluate(el => { el.setAttribute('data-original-node', 'yes'); });
  const saved = await anchor(page);
  // A delayed image/panel-sized expansion above the current row.
  await timeline.evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-row-id]')];
    const row = rows.filter(row => row.querySelector('article') && row.getBoundingClientRect().bottom < top).at(-1);
    if (!row) throw Error('Missing measured row above anchor');
    const block = document.createElement('div'); block.style.height = '240px'; row.querySelector('article')!.prepend(block);
  });
  await expectAnchor(page, saved);
  await timeline.evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const text = [...el.querySelectorAll('article p')].find(row => row.getBoundingClientRect().top > top)!.firstChild!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 5);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('历史记录 ');
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(timeline).toHaveAttribute('data-original-node', 'yes');
  await expect(page.getByLabel('任务草稿')).toHaveJSProperty('textContent','跨断点草稿');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('历史记录 ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('history-narrow.png')});
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(timeline).toHaveAttribute('data-original-node', 'yes');
  await expect(page.getByLabel('任务草稿')).toHaveJSProperty('textContent','跨断点草稿');
});

test('10.7 late history response cannot override latest or another session', async ({ page }) => {
  let release!: () => void, done!: () => void, requests = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const finished = new Promise<void>(resolve => { done = resolve; });
  await page.route('**/snapshot?before=*', async route => {
    requests++; const response = await route.fetch(); await gate; await route.fulfill({ response }); done();
  });
  await page.getByRole('button', { name: '查看更早', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole('button', { name: '查看更早', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '返回最新', exact: true }).click();
  await expect(page.getByText(/^历史记录 449/)).toBeInViewport();
  release(); await finished;
  await expect(surface(page).locator('[data-row-id]')).toHaveCount(60);
  await expect(page.getByText(/^历史记录 449/)).toBeInViewport();
  await page.unroute('**/snapshot?before=*');
  let releaseNext!: () => void, nextDone!: () => void;
  const nextGate = new Promise<void>(resolve => { releaseNext = resolve; });
  const nextFinished = new Promise<void>(resolve => { nextDone = resolve; });
  await page.route('**/snapshot?before=*', async route => {
    await nextGate; await route.fulfill({ status: 503, json: { error: { message: '旧会话错误' } } }); nextDone();
  });
  await page.getByRole('button', { name: '查看更早', exact: true }).click();
  // Client-side navigation retains the controller lifetime rather than cancelling via a document reload.
  await page.getByRole('link', { name: '工作', exact: true }).click();
  await createTask(page, '新的空会话');
  await expect(page.getByRole('heading', { name: '新的空会话', exact: true })).toBeVisible();
  releaseNext(); await nextFinished;
  await expect(surface(page).locator('[data-row-id]')).toHaveCount(0);
  await expect(page.getByText('暂时无法加载，请重试。', { exact: true })).toHaveCount(0);
});

test('10.7 streamed and terminal updates respect browsing; downward paging resumes latest', async ({ page }) => {
  const timeline = surface(page);
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await timeline.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true })); el.scrollTop -= 80; });
  await expect(page.getByRole('button', { name: '返回最新', exact: true })).toBeVisible();
  const saved = await anchor(page);
  const entry = await app.sessions.entry(sessionId), journal = await Journal.open(entry.directory);
  await journal.append('context.add', { source: 'user', item: { role: 'user', content: [{ type: 'input_text', text: '新到记录 450' }] } });
  await journal.append('run.started', {}, {runId:'terminal-fixture'});
  await journal.append('run.finished', {status:'completed'}, {runId:'terminal-fixture'});
  await journal.close();
  await expect(timeline.locator('[data-row-id]')).toHaveCount(62);
  await expectAnchor(page, saved);
  await page.getByRole('button', { name: '查看更早', exact: true }).click();
  await expect(timeline.locator('[data-row-id]')).toHaveCount(122);
  await page.getByRole('button', { name: '查看更早', exact: true }).click();
  await expect(timeline.locator('[data-row-id]')).toHaveCount(180);
  await expect(page.getByRole('button', { name: '查看较新', exact: true })).toBeVisible();
  await timeline.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', {deltaY:100,bubbles:true})); el.scrollTop = el.scrollHeight; });
  await expect(page.getByText('新到记录 450', {exact:true})).toBeAttached();
  await timeline.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', {deltaY:100,bubbles:true})); el.scrollTop = el.scrollHeight; });
  await expect(page.getByText('新到记录 450', {exact:true})).toBeInViewport();
  await expect(page.getByRole('button', { name: '返回最新', exact: true })).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('10.7 delayed image and font metrics preserve the current manual anchor', async ({ page }) => {
  const timeline = surface(page);
  await timeline.focus(); await page.keyboard.press('PageUp'); await settled(page);
  await expect(page.getByRole('button', { name: '返回最新', exact: true })).toBeVisible();
  // Wait for native smooth keyboard scrolling to settle before the delayed media arrives.
  await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(200);
  await timeline.evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const article = [...el.querySelectorAll<HTMLElement>('article')].filter(row => row.getBoundingClientRect().bottom < top).at(-1)!;
    const image = document.createElement('img'); image.id = 'late-image'; image.style.cssText = 'display:block;width:280px'; article.prepend(image);
  });
  const before = await anchor(page);
  await timeline.evaluate(async el => {
    const image = el.querySelector<HTMLImageElement>('#late-image')!;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(Error('fixture image failed'));
      image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
    });
  });
  await expectAnchor(page, before);
  const beforeFont = await anchor(page);
  await timeline.evaluate(el => {
    for (const row of el.querySelectorAll<HTMLElement>('article p')) row.style.cssText = 'font-family:monospace;font-size:20px;line-height:1.8';
  });
  await expectAnchor(page, beforeFont);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button', {name:'深色',exact:true}).click();await page.getByRole('button',{name:'关闭外观',exact:true}).click();
  await expectAnchor(page, beforeFont);
});

test('10.7 historical panel data stays read-only through virtual unmount and remount', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && !request.url().endsWith('/connect')) posts.push(request.url()); });
  await page.route('**/snapshot*', async route => {
    const response = await route.fetch(); const snapshot = await response.json();
    snapshot.rows = snapshot.rows.map((row: Record<string, unknown>) => ({ ...row,
      details: { kind:'panel', resourceId:'history-panel', resourceRevision:'saved', panelId:'read-only', bundleHash:'saved', props:{}, fallback:'已保存的面板结果' } }));
    await route.fulfill({ response, json:snapshot });
  });
  await page.reload();
  await expect(page.getByText(/^历史记录 449/)).toBeInViewport();
  const row = page.getByText(/^历史记录 449/);
  await surface(page).evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', {deltaY:-100,bubbles:true})); el.scrollTop = 0; });
  await expect(row).toHaveCount(0);
  await surface(page).evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', {deltaY:100,bubbles:true})); el.scrollTop = el.scrollHeight; });
  await expect(row).toBeInViewport();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('10.7 create conversations share bounded pagination and keyboard reading', async ({ page }) => {
  const session = await app.sessions.create('创造长历史', { mode:'create', commandId:'create-history', target:{kind:'extension',root:await temporary(),scope:'project'} });
  const entry = await app.sessions.entry(session.id), journal = await Journal.open(entry.directory);
  for (let i = 0; i < 210; i++) await journal.append('context.add', {source:'user', item:{role:'user',content:[{type:'input_text',text:`创造历史 ${i}\n${'保存的开发证据。'.repeat(20)}` }]}}, {}, false);
  await journal.flush(); await journal.close();
  await page.goto(`${app.origin}/create/session/${session.id}`);
  const timeline = page.getByTestId('create-timeline');
  await expect(page.getByText(/^创造历史 209/)).toBeInViewport();
  expect(await timeline.locator('article').count()).toBeLessThan(40);
  await timeline.focus(); await page.keyboard.press('PageUp');
  await expect(page.getByRole('button', {name:'返回最新',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'查看更早',exact:true}).click();
  await expect(timeline.locator('[data-row-id]')).toHaveCount(120);
  await page.getByRole('button', {name:'返回最新',exact:true}).click();
  await expect(page.getByText(/^创造历史 209/)).toBeInViewport();
});

test('10.7 panel proportions restore after reload without changing the session', async ({ page }) => {
  const separator = page.getByRole('separator', {name:'调整导航宽度',exact:true});
  await separator.focus(); await page.keyboard.press('ArrowRight');
  const value = await separator.getAttribute('aria-valuenow');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('v2-layout:shell-work'))).not.toBeNull();
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', value!);
  await expect(page).toHaveURL(new RegExp(sessionId));
  await expect(page.getByText(/^历史记录 449/)).toBeInViewport();
});
