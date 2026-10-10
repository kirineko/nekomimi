import { test, expect } from '@playwright/test';
import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { startWeb } from '../../src/server/app.js';
import { Journal, readSession } from '../../src/journal.js';
import { Candidates } from '../../src/customization/candidates.js';
import { temporary } from '../helpers.js';
async function fixture() {
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve('dist/web-dist') });
  const root = await temporary(), work = await app.sessions.create('工作阅读位置', { mode: 'work', commandId: 'work' });
  const source = await app.sessions.create('候选来源', { mode: 'create', commandId: 'source', target: { kind: 'extension', root } });
  const store = new Candidates(root), candidate = await store.scaffold('versioned', 'command'), resource = await store.read(candidate.id);
  const draft = { version: 1, goal: '带版本交付', target: { sessionId: work.id }, delivery: [{ candidateId: candidate.id, resourceId: resource.id, revision: resource.hash, usage: '核对这个确切版本' }] };
  const preview = await app.sessions.handoffPreview(source.id, draft);
  const receipt = await app.sessions.confirmHandoff(source.id, { version: 1, confirmed: true, commandId: 'handoff', payloadHash: preview.payloadHash, draft });
  const journal = await Journal.open(join(app.sessions.root, work.id));
  for (let i = 0; i < 35; i++) await journal.append('context.add', { source: 'user', item: { role: 'user', content: `阅读记录 ${i}\n${'这段已保存历史不应推动阅读位置。'.repeat(12)}` } });
  await journal.close();
  return { app, work, source, candidate, resource, receipt };
}
test('10.3 exact delivery deep link and explicit/native return preserve the card offset', async ({ page }) => {
  const f = await fixture(), posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && !request.url().endsWith('/connect')) posts.push(request.url()); });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.work.id}#token=${f.app.token}`);
    const card = page.getByRole('article', { name: `交付 ${f.receipt.handoffId}`, exact: true });
    await card.getByText('交付时的验证证据（0）', { exact: true }).click();
    const link = card.getByRole('link', { name: '查看交付版本候选', exact: true }); await link.scrollIntoViewIfNeeded();
    const offset = async () => (await card.boundingBox())!.y - (await page.getByTestId('timeline').boundingBox())!.y;
    const before = await offset(); await link.click();
    await expect(page).toHaveURL(new RegExp(`revision=${f.resource.hash}`));
    await expect(page.getByText('开发内容与交付版本一致。下方显示该内容的当前检查记录，交付时证据保留于上方。', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '返回工作交付位置', exact: true }).click();
    await expect.poll(async () => Math.abs(await offset() - before)).toBeLessThan(3);
    await expect(card.getByText('没有匹配该版本的验证证据。', { exact: true })).toBeVisible();
    await link.click(); await expect(page.getByRole('heading', { name: '正在检查交付时的版本', exact: true })).toBeVisible();
    await page.goBack(); await expect.poll(async () => Math.abs(await offset() - before)).toBeLessThan(3);
    await page.getByRole('button', { name: '返回最新', exact: true }).click();
    await expect(page.getByText(/^阅读记录 34/)).toBeInViewport();
    await expect(page.getByRole('button', { name: '返回最新', exact: true })).toHaveCount(0);
    expect(posts).toEqual([]);
    expect((await readSession(join(f.app.sessions.root, f.source.id))).events.some(event => event.type === 'run.started')).toBe(false);
  } finally { await f.app.close(); }
});
test('10.3 changed or unavailable candidate never masquerades as the delivered version', async ({ page }) => {
  const f = await fixture();
  try {
    const path = `/create/session/${f.source.id}/candidate/${f.candidate.id}?deliverySession=${f.work.id}&handoff=${f.receipt.handoffId}&revision=${f.resource.hash}`;
    await writeFile(join(f.candidate.path, 'index.ts'), 'export default()=>{};');
    await page.goto(f.app.origin + path + '#token=' + f.app.token);
    await expect(page.getByRole('alert')).toContainText('开发候选已变化');
    await expect(page.getByText(`交付版本 ${f.resource.hash}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: '内容差异', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '另行查看当前候选', exact: true })).toBeVisible();
    await f.app.sessions.remove(f.source.id); await page.reload();
    await expect(page.getByRole('alert').filter({ hasText: '开发候选不可读' })).toBeVisible();
    await expect(page.getByText(`交付版本 ${f.resource.hash}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '返回工作交付位置', exact: true })).toBeVisible();
    await page.goto(f.app.origin + path.replace(f.resource.hash, '0'.repeat(64)));
    await expect(page.getByRole('heading', { name: '此链接没有匹配的交付快照', exact: true })).toBeVisible();
  } finally { await f.app.close(); }
});
