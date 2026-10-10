import { test, expect } from '@playwright/test';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { readSession } from '../../src/journal.js';
import { temporary } from '../helpers.js';
import { openSessionMenu } from './fixtures/workbench.js';

async function fixture() {
  let interrupted = false;
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false, staticDir: resolve('dist/web-dist'),
    handoffFault: async stage => { if (stage === 'intent' && !interrupted) { interrupted = true; throw Error('fixture: intent accepted, response interrupted'); } } });
  const source = await app.sessions.create('需要恢复的工作', { mode: 'work', commandId: 'work' });
  return { app, source, root: await temporary() };
}
test('10.3 refresh observes a partial handoff and explicit recovery completes only its saved metadata', async ({ page }) => {
  const f = await fixture(); const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.source.id}#token=${f.app.token}`);
    await page.getByLabel('任务草稿', { exact: true }).fill('恢复也不能清空此草稿');
    await openSessionMenu(page, '交接到创造会话');
    await page.getByLabel('交接目的', { exact: true }).fill('保存后恢复');
    await page.getByLabel('交接目标会话', { exact: true }).selectOption('new');
    await page.getByLabel('交接新会话名称', { exact: true }).fill('恢复出的唯一目标');
    await page.getByLabel('交接开发目录', { exact: true }).fill(f.root);
    await page.getByRole('button', { name: '预览交接', exact: true }).click();
    await page.getByLabel('我确认将以上快照交接到此目标', { exact: true }).check();
    await page.getByRole('button', { name: '确认交接', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '确认未完成' })).toBeVisible();
    const accepted = (await f.app.sessions.handoffStates(f.source.id)).items[0]!;
    expect(accepted.status).toBe('pending'); expect((await f.app.sessions.list(0, 100)).sessions).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: '交接已接受，尚未完整记录', exact: true })).toBeVisible();
    expect(posts.filter(url => url.endsWith('/handoff-recover'))).toHaveLength(0);
    await expect(page.getByRole('button', { name: '恢复交接记录', exact: true })).toBeDisabled();
    await page.getByLabel('我确认恢复这份已接受的交接', { exact: true }).check();
    await page.getByRole('button', { name: '恢复交接记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '交接已完整记录', exact: true })).toBeVisible();
    const state = (await f.app.sessions.handoffStates(f.source.id)).items;
    expect(state).toHaveLength(1); expect(state[0]).toMatchObject({ handoffId: accepted.handoffId, payloadHash: accepted.payloadHash, status: 'committed' });
    expect((await f.app.sessions.list(0, 100)).sessions).toHaveLength(2);
    await expect(page.getByLabel('任务草稿', { exact: true })).toHaveJSProperty('textContent','恢复也不能清空此草稿');
    const target = await readSession(join(f.app.sessions.root, accepted.targetSessionId));
    expect(target.events.filter(event => event.type === 'handoff.received')).toHaveLength(1);
    expect(target.events.some(event => ['run.started', 'model.request', 'tool.intent'].includes(event.type))).toBe(false);
    await page.reload(); await expect(page.getByRole('heading', { name: '交接已完整记录', exact: true })).toBeVisible();
    expect(posts.filter(url => url.endsWith('/handoff-recover'))).toHaveLength(1);
  } finally { await f.app.close(); }
});
test('10.3 deleted destination blocks explicit recovery and is never recreated', async ({ page }) => {
  const f = await fixture();
  try {
    const target = await f.app.sessions.create('即将删除的目标', { mode: 'create', commandId: 'create', target: { kind: 'extension', root: f.root } });
    const draft = { version: 1, goal: '保留已接受快照', target: { sessionId: target.id } };
    const preview = await f.app.sessions.handoffPreview(f.source.id, draft);
    await expect(f.app.sessions.confirmHandoff(f.source.id, { version: 1, confirmed: true, commandId: 'handoff', payloadHash: preview.payloadHash, draft })).rejects.toThrow('intent accepted');
    await f.app.sessions.remove(target.id);
    await page.goto(`${f.app.origin}/work/session/${f.source.id}#token=${f.app.token}`);
    await expect(page.getByRole('heading', { name: '交接待恢复，存在阻碍', exact: true })).toBeVisible();
    await page.getByLabel('我确认恢复这份已接受的交接', { exact: true }).check();
    await page.getByRole('button', { name: '恢复交接记录', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '恢复未完成' })).toBeVisible();
    expect((await f.app.sessions.list(0, 100)).sessions.map(session => session.id)).toEqual([f.source.id]);
    expect((await f.app.sessions.handoffStates(f.source.id)).items[0]?.status).toBe('blocked');
  } finally { await f.app.close(); }
});
