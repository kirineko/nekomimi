import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const metrics: Record<string, number> = {};
test.afterAll(async () => { await writeFile('metrics.json', JSON.stringify({ environment: 'single local Chrome run; not comparison or SLO', ...metrics }, null, 2)); });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" rx="14" fill="#e9e3fc"/><text x="30" y="96" fill="#5a3ec8" font-size="24">Candidate preview</text></svg>';
test.beforeEach(async ({ page }) => { await page.route('**/delayed.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: svg })); });
test('Radix keyboard dialog, theme preview, focus restoration and shadcn control', async ({ page }) => {
  await page.goto('/work'); const trigger = page.getByRole('button', { name: '主题预览' }); await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: '深色', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await expect(page.locator('[data-slot="button"]').first()).toBeVisible();
});
test('Router navigation preserves isolated work/create drafts; Query keys bind mode', async ({ page }) => {
  await page.goto('/work'); await page.getByRole('textbox', { name: '任务草稿' }).fill('work draft'); await page.getByRole('link', { name: '创造', exact: true }).click();
  await expect(page.getByRole('heading', { name: '为工作交付新能力' })).toBeVisible(); await expect(page.getByRole('textbox', { name: '任务草稿' })).toHaveValue('');
  await page.getByRole('textbox', { name: '任务草稿' }).fill('create draft'); await page.getByRole('link', { name: '工作', exact: true }).click(); await expect(page.getByRole('textbox', { name: '任务草稿' })).toHaveValue('work draft');
  await expect(page.getByText('用户项目 / example-app · 仅当前工作区')).toBeVisible(); await page.reload(); await expect(page.getByRole('heading', { name: '专注当前项目' })).toBeVisible();
});
test('resizable panel separator supports keyboard', async ({ page }) => {
  await page.goto('/work'); expect((await page.locator('.workspace').boundingBox())!.height).toBeGreaterThan(850); const separator = page.getByRole('separator', { name: '调整导航宽度' }); const before = await separator.getAttribute('aria-valuenow');
  await separator.focus(); await page.keyboard.press('ArrowRight'); await expect(separator).not.toHaveAttribute('aria-valuenow', before!);
});
test('virtual list bounds DOM, measures delayed image, streams without stealing draft focus', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/delayed.svg', async route => { await gate; await route.fulfill({ contentType: 'image/svg+xml', body: svg }); });
  await page.goto('/work', { waitUntil: 'domcontentloaded' }); await expect(page.locator('.message').first()).toBeVisible();
  expect(await page.locator('.message').count()).toBeLessThan(40); const before = await page.locator('[data-index="3"]').boundingBox(); release();
  await expect.poll(async () => (await page.locator('[data-index="3"]').boundingBox())!.y).toBeGreaterThan(before!.y + 30);
  await page.getByRole('button', { name: '模拟流', exact: true }).click(); const input = page.getByRole('textbox', { name: '任务草稿' });
  const start = performance.now(); await input.fill('x'.repeat(1000)); await expect(input).toHaveValue('x'.repeat(1000)); metrics.inputFillAndAssertionMs = performance.now() - start;
  await expect.poll(() => page.getByTestId('chunks').textContent()).not.toBe('0 chunks'); await expect(input).toBeFocused();
  const scrolling = performance.now(); await page.getByTestId('timeline').evaluate(el => { el.scrollTop = 18000; }); await expect(page.locator('[data-index="0"]')).toHaveCount(0); metrics.scrollAndAssertionMs = performance.now() - scrolling;
  expect(await page.locator('.message').count()).toBeLessThan(40); await page.getByRole('button', { name: '停止', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('已取消');
});
for (const zoom of [1, 2]) test(`narrow viewport and CSS zoom ${zoom * 100}% keep essential controls reachable`, async ({ page }) => {
  await page.setViewportSize({ width: 360 * zoom, height: 1000 }); await page.goto('/create'); if (zoom === 2) await page.evaluate(() => { document.body.style.zoom = '2'; });
  await expect(page.getByRole('heading', { name: '为工作交付新能力' })).toBeVisible(); await page.getByRole('textbox', { name: '任务草稿' }).fill('narrow draft');
  await page.getByRole('button', { name: '停止', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('已取消');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
test('visual samples: both workbenches, all states, narrow and dark', async ({ page }) => {
  await mkdir('screenshots', { recursive: true });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const start = performance.now();
  for (const mode of ['work', 'create']) {
    await page.goto('/' + mode); await expect(page.getByRole('textbox', { name: '任务草稿' })).toBeVisible();
    for (const state of ['正常', '加载', '空', '错误', '已取消', '待授权']) {
      await page.getByRole('combobox', { name: '样稿状态' }).selectOption(state); if (state === '正常') { await page.locator('img').evaluate(el => (el as HTMLImageElement).decode()); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); } await page.screenshot({ path: `screenshots/${mode}-${state}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 360, height: 960 }); await page.getByRole('combobox', { name: '样稿状态' }).selectOption('正常'); await page.locator('img').evaluate(el => (el as HTMLImageElement).decode()); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await expect(page.locator('.topbar')).toHaveCount(1); expect((await page.getByRole('button', { name: '停止', exact: true }).boundingBox())!.y).toBeLessThan(920); await page.screenshot({ path: `screenshots/${mode}-360.png`, fullPage: true }); await page.setViewportSize({ width: 1440, height: 960 });
  }
  await page.getByRole('button', { name: '主题预览' }).click(); await page.getByRole('button', { name: '深色', exact: true }).click(); await page.keyboard.press('Escape'); await page.screenshot({ path: 'screenshots/create-dark.png', fullPage: true });
  metrics.visualScenarioSweepMs = performance.now() - start; expect(errors).toEqual([]);
});
