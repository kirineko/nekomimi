import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readSession } from '../../src/journal.js';
import { startWeb } from '../../src/server/app.js';
import { Candidates } from '../../src/customization/candidates.js';
import { temporary, key, response, textItem } from '../helpers.js';
import type { HandoffDraft } from '../../src/shared/protocol.js';
import { setDeveloperView, openSessionMenu } from './fixtures/workbench.js';
async function fixture(model = false) {
  const development = await temporary(), workspace = await temporary(), home = await temporary();
  let calls = 0;
  const app = await startWeb({ workspace, home, naming: false, staticDir: resolve('dist/web-dist'), ...(model ? { apiKey: key, runtime: { fetch: async () => { calls++; return response([textItem('已读取交付引用')]); } } } : {}) });
  const work = await app.sessions.create('工作来源', { commandId: 'work', mode: 'work' });
  const create = await app.sessions.create('开发来源', { commandId: 'create', mode: 'create', target: { kind: 'extension', root: development } });
  const store = new Candidates(development), candidate = await store.scaffold('handoff-card', 'command');
  const marker = join(development, 'FACTORY');
  await writeFile(join(candidate.path, 'index.ts'), `import {writeFileSync} from 'node:fs'; export default()=>{writeFileSync(${JSON.stringify(marker)},'loaded');};`);
  const selected = await store.read(candidate.id);
  const draft: HandoffDraft = { version: 1, goal: '交付可检查能力', summary: '请先检查开发版本', constraints: ['保持独立授权'], target: { sessionId: work.id }, delivery: [{ resourceId: selected.id, revision: selected.hash, candidateId: candidate.id, usage: '核对后另行授权和安装' }] };
  const preview = await app.sessions.handoffPreview(create.id, draft);
  const receipt = await app.sessions.confirmHandoff(create.id, { version: 1, confirmed: true, commandId: 'handoff', payloadHash: preview.payloadHash, draft });
  return { app, work, create, candidate, selected, receipt, marker, calls: () => calls };
}
test('10.3 delivery cards distinguish saved facts from changed versions and unavailable sources without execution', async ({ page }) => {
  const f = await fixture(); const actions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && !request.url().endsWith('/connect')) actions.push(request.url()); });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.work.id}#token=${f.app.token}`);
    const card = page.getByRole('article', { name: `交付 ${f.receipt.handoffId}`, exact: true });
    await expect(card.getByRole('heading', { name: '交付卡', exact: true })).toBeVisible();
    await expect(card.getByText('待交付到工作目录', { exact: true })).toBeVisible();
    await expect(card.getByText(`交付版本 ${f.selected.hash}`, { exact: true })).toBeVisible();
    await expect(card.getByText('当前工作状态：待交付到工作目录', { exact: true })).toBeVisible();
    await card.getByText('交付时的验证证据（0）', { exact: true }).click();
    await expect(card.getByText('没有匹配该版本的验证证据。', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '查看来源会话', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/create/session/${f.create.id}$`));
    await page.getByRole('link', { name: '查看目标会话', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/work/session/${f.work.id}$`));
    await writeFile(join(f.candidate.path, 'index.ts'), 'export default()=>{};');
    await setDeveloperView(page, true);
    await page.getByRole('button', { name: '刷新交接记录', exact: true }).click();
    await expect(card.getByText('交付版本已变化或缺失，当前候选不能冒充原交付版本。', { exact: true })).toBeVisible();
    await expect(card.getByText(`交付版本 ${f.selected.hash}`, { exact: true })).toBeVisible();
    await f.app.sessions.remove(f.create.id);
    await setDeveloperView(page, true);
    await page.getByRole('button', { name: '刷新交接记录', exact: true }).click();
    await expect(card.getByText('来源不可回溯；历史交付快照仍保留。', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '查看来源会话', exact: true })).toHaveCount(0);
    await expect(card.getByRole('link', { name: '查看交付版本候选', exact: true })).toHaveCount(0);
    await expect(card.getByText('当前工作状态：待交付到工作目录', { exact: true })).toBeVisible();
    await expect(readFile(f.marker)).rejects.toThrow(); expect(actions).toEqual([]);
    await page.setViewportSize({ width: 360, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.app.close(); }
});
test('10.3 a failed relations read is local and delivery facts remain visible', async ({ page }) => {
  const f = await fixture();
  await page.route('**/handoff-relations', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'fixture', message: '关联暂不可读' } }) }));
  try {
    await page.goto(`${f.app.origin}/work/session/${f.work.id}#token=${f.app.token}`);
    await expect(page.getByRole('alert').filter({ hasText: '交接记录暂时不可读' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '交付卡', exact: true })).toBeVisible();
    await page.unroute('**/handoff-relations'); await setDeveloperView(page, true); await page.getByRole('button', { name: '刷新交接记录', exact: true }).click();
    await expect(page.getByRole('link', { name: '查看来源会话', exact: true })).toBeVisible();
  } finally { await f.app.close(); }
});

test('10.3 preview and cancellation preserve drafts and new target is created only after confirmation', async ({ page }) => {
  const f = await fixture(), root = await temporary();
  try {
    await page.goto(`${f.app.origin}/work/session/${f.work.id}#token=${f.app.token}`);
    await page.getByLabel('任务草稿', { exact: true }).fill('工作中未提交的草稿');
    await openSessionMenu(page, '交接到创造会话');
    await page.getByLabel('交接目的', { exact: true }).fill('新增独立审查');
    await page.getByLabel('交接目标会话', { exact: true }).selectOption('new');
    await page.getByLabel('交接新会话名称', { exact: true }).fill('确认后才建立');
    await page.getByLabel('交接开发目录', { exact: true }).fill(root);
    await page.getByText('选定记录引用（0）', { exact: true }).click();
    await page.getByRole('checkbox', { name: /^handoff.received/ }).check();
    const before = (await f.app.sessions.list(0, 100)).sessions.length;
    await page.getByRole('button', { name: '预览交接', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认选定快照', exact: true })).toBeVisible();
    expect((await f.app.sessions.list(0, 100)).sessions).toHaveLength(before);
    await expect(page.getByText('选定引用 1 项；交付版本 0 项', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '确认交接', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消交接', exact: true }).click();
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','工作中未提交的草稿');
    await openSessionMenu(page, '交接到创造会话');
    await expect(page.getByLabel('交接目的', { exact: true })).toHaveValue('新增独立审查');
    await page.getByRole('button', { name: '预览交接', exact: true }).click();
    await page.getByLabel('我确认将以上快照交接到此目标', { exact: true }).check();
    await page.getByRole('button', { name: '确认交接', exact: true }).click();
    await expect(page.getByRole('link', { name: '查看接收会话', exact: true })).toBeVisible();
    expect((await f.app.sessions.list(0, 100)).sessions).toHaveLength(before + 1);
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','工作中未提交的草稿');
    await page.getByRole('link', { name: '查看接收会话', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认后才建立', exact: true })).toBeVisible();
    await expect(page.getByText('收到交接：新增独立审查', { exact: true })).toBeVisible();
    expect((await f.app.sessions.list(0, 100)).sessions.every(session => !session.runId)).toBe(true);
  } finally { await f.app.close(); }
});
test('10.3 stale candidate cannot be confirmed as the previewed delivery', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(`${f.app.origin}/create/session/${f.create.id}/candidate/${f.candidate.id}#token=${f.app.token}`);
    await page.getByRole('button', { name: '交付此候选', exact: true }).click();
    await page.getByLabel('交接目的', { exact: true }).fill('交付当前版本');
    await page.getByLabel('交接目标会话', { exact: true }).selectOption(f.work.id);
    await page.getByLabel('附上此候选的确切版本和使用说明', { exact: true }).check();
    await page.getByLabel('交付使用说明', { exact: true }).fill('仅检查');
    await page.getByRole('button', { name: '预览交接', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认选定快照', exact: true })).toBeVisible();
    await writeFile(join(f.candidate.path, 'index.ts'), 'export default()=>{};');
    await page.getByLabel('我确认将以上快照交接到此目标', { exact: true }).check();
    await page.getByRole('button', { name: '确认交接', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '确认未完成' })).toBeVisible();
    expect((await f.app.sessions.deliveries(f.work.id)).items).toHaveLength(1);
  } finally { await f.app.close(); }
});

test('10.3 lost confirmation response retries the same command without a duplicate handoff', async ({ page }) => {
  const f = await fixture(), commands: string[] = [];
  await page.route('**/handoff-confirm', async route => {
    commands.push(route.request().postDataJSON().commandId);
    if (commands.length === 1) { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.work.id}#token=${f.app.token}`);
    await openSessionMenu(page, '交接到创造会话');
    await page.getByLabel('交接目的', { exact: true }).fill('稳定收据');
    await page.getByLabel('交接目标会话', { exact: true }).selectOption(f.create.id);
    await page.getByRole('button', { name: '预览交接', exact: true }).click();
    await page.getByLabel('我确认将以上快照交接到此目标', { exact: true }).check();
    await page.getByRole('button', { name: '确认交接', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '确认未完成' })).toBeVisible();
    await page.getByRole('button', { name: '确认交接', exact: true }).click();
    await expect(page.getByRole('link', { name: '查看接收会话', exact: true })).toBeVisible();
    expect(commands).toHaveLength(2); expect(commands[0]).toBe(commands[1]);
    expect((await f.app.sessions.handoffStates(f.work.id)).items).toHaveLength(1);
  } finally { await f.app.close(); }
});
test('10.3 cancelled late preview does not restore the confirmation control', async ({ page }) => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/handoff-preview', async route => { entered(); await hold; await route.continue(); });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.work.id}#token=${f.app.token}`);
    await openSessionMenu(page, '交接到创造会话');
    await page.getByLabel('交接目的', { exact: true }).fill('不要接收迟到预览');
    await page.getByLabel('交接目标会话', { exact: true }).selectOption(f.create.id);
    await page.getByRole('button', { name: '预览交接', exact: true }).click(); await started;
    await page.getByRole('button', { name: '取消交接', exact: true }).click();
    const response = page.waitForResponse('**/handoff-preview'); release(); await response;
    await openSessionMenu(page, '交接到创造会话');
    await expect(page.getByLabel('交接目的', { exact: true })).toHaveValue('不要接收迟到预览');
    await expect(page.getByRole('button', { name: '确认交接', exact: true })).toHaveCount(0);
    expect((await f.app.sessions.handoffStates(f.work.id)).items).toHaveLength(0);
  } finally { release(); await f.app.close(); }
});


test('10.3 selected delivery references reach the actual work request only after explicit submit', async ({ page }) => {
  const f = await fixture(true);
  try {
    await page.goto(`${f.app.origin}/work/session/${f.work.id}#token=${f.app.token}`);
    await page.getByText('引用交付（已选 0）', { exact: true }).click();
    await page.getByRole('checkbox', { name: `引用 handoff-card · ${f.receipt.handoffId}`, exact: true }).check();
    await page.getByLabel('任务草稿', { exact: true }).fill('只阅读交付内容');
    expect(f.calls()).toBe(0);
    await page.reload();
    await expect(page.getByText('引用交付（已选 1）', { exact: true })).toBeVisible();
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','只阅读交付内容');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await readSession(join(f.app.sessions.root, f.work.id))).events.filter(event => event.type === 'delivery.referenced').length).toBe(1);
    await expect.poll(() => f.calls()).toBe(1);
    const event = (await readSession(join(f.app.sessions.root, f.work.id))).events.find(event => event.type === 'delivery.referenced');
    expect(event).toMatchObject({ handoffId: f.receipt.handoffId, runId: expect.any(String) });
    await expect(page.getByText('引用交付（已选 0）', { exact: true })).toBeVisible();
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','');
    await expect(readFile(f.marker)).rejects.toThrow();
  } finally { await f.app.close(); }
});


test('10.3 a late work receipt preserves a newer draft after navigating away and back', async ({ page }) => {
  const f = await fixture(true); let release!: () => void, entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/submit', async route => { const response = await route.fetch(); entered(); await hold; await route.fulfill({ response }); });
  try {
    const path = `/work/session/${f.work.id}`;
    await page.goto(f.app.origin + path + '#token=' + f.app.token);
    await page.getByLabel('任务草稿', { exact: true }).fill('先提交的草稿');
    await page.getByRole('button', { name: '发送', exact: true }).click(); await accepted;
    await page.getByRole('link', { name: '查看来源会话', exact: true }).click();
    await page.getByRole('link', { name: '查看目标会话', exact: true }).click();
    await page.getByLabel('任务草稿', { exact: true }).fill('后来写下的草稿');
    await page.getByText('引用交付（已选 0）', { exact: true }).click();
    await page.getByRole('checkbox', { name: `引用 handoff-card · ${f.receipt.handoffId}`, exact: true }).check();
    const received = page.waitForResponse('**/submit'); release(); await received;
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','后来写下的草稿');
    await expect(page.getByText('引用交付（已选 1）', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','后来写下的草稿');
    await expect(page.getByText('引用交付（已选 1）', { exact: true })).toBeVisible();
  } finally { release(); await f.app.close(); }
});
