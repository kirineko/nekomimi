import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { temporary } from '../helpers.js';
import { openDrawerTab, openEvidence } from './fixtures/workbench.js';

async function fixture() {
  const workspace = await temporary(), home = await temporary();
  const app = await startWeb({ workspace, home, naming: false, staticDir: resolve('dist/web-dist'), runtime: { fetch: async () => { throw new Error('No model calls'); } } });
  const session = await app.sessions.create('Optional features');
  return { app, session };
}
async function chunk(entry: string) {
  const manifest = JSON.parse(await readFile('dist/web-dist/assets/asset-manifest.json', 'utf8'));
  return manifest[entry].file as string;
}

test('10.9 optional chunks load on demand, failed import retries without losing draft', async ({ page }) => {
  const f = await fixture(), requests: string[] = [];
  const entries = ['v2/routes/themes.tsx', 'v2/routes/models.tsx', 'v2/routes/inspection.tsx', 'v2/routes/session-export.tsx', 'components/FileBrowser.tsx', 'components/Changes.tsx'];
  const chunks = await Promise.all(entries.map(chunk));
  page.on('request', request => requests.push(request.url()));
  let failed = false;
  await page.route(`**/${chunks[2]}*`, async route => {
    if (!failed) { failed = true; await route.abort(); } else await route.continue();
  });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    const draft = page.getByLabel('任务草稿', { exact: true });
    await draft.fill('Retain draft through import failures');
    for (const file of chunks) expect(requests.some(url => url.includes(file)), file).toBe(false);
    await openEvidence(page);
    await expect(page.getByRole('alert')).toContainText('调用证据加载失败');
    await page.getByRole('button', { name: '重试加载' }).click();
    await expect(page.getByRole('button', { name: '刷新只读证据' })).toBeVisible();
    expect(requests.some(url => url.includes(chunks[2]!) && url.includes('retry='))).toBe(true);
    await page.getByRole('button', { name: '关闭调用证据' }).click();
    await expect(page.getByRole('button',{name:'会话操作',exact:true})).toBeFocused();
    await expect(draft).toHaveJSProperty('textContent', 'Retain draft through import failures');
    const loaded = requests.filter(url => url.includes(chunks[2]!)).length;
    await openEvidence(page);
    await expect(page.getByRole('button', { name: '刷新只读证据' })).toBeVisible();
    expect(requests.filter(url => url.includes(chunks[2]!))).toHaveLength(loaded);
  } finally { await f.app.close(); }
});

test('10.9 closing pending export prevents late reopen and focus theft', async ({ page }) => {
  const f = await fixture(), file = await chunk('v2/routes/session-export.tsx');
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/${file}*`, async route => { await wait; await route.continue(); });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    const draft = page.getByLabel('任务草稿', { exact: true });
    await draft.fill('Keep editing');
    await page.getByRole('button', { name:'设置',exact:true }).click();await page.getByRole('menuitem', { name:'导出当前会话',exact:true }).click();
    await expect(page.getByRole('region', { name: '会话导出加载', exact: true }).getByRole('status')).toContainText('正在加载会话导出');
    await page.getByRole('button', { name: '关闭加载' }).click();
    await expect(page.getByRole('button', { name:'设置',exact:true })).toBeFocused();
    await draft.focus();
    const finished = page.waitForResponse(response => response.url().includes(file));
    release(); await finished;
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(draft).toBeFocused();
    await expect(draft).toHaveJSProperty('textContent', 'Keep editing');
    await page.getByRole('button', { name:'设置',exact:true }).click();await page.getByRole('menuitem', { name:'导出当前会话',exact:true }).click();
    await expect(page.getByRole('button', { name: '下载 HTML' })).toBeVisible();
  } finally { release(); await f.app.close(); }
});

test('10.9 files and management failures stay local and can close or retry', async ({ page }) => {
  const f = await fixture(), files = await chunk('components/FileBrowser.tsx'), models = await chunk('v2/routes/models.tsx');
  await page.route(`**/${files}*`, route => route.abort(), { times: 1 });
  await page.route(`**/${models}*`, route => route.abort(), { times: 1 });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    const draft = page.getByLabel('任务草稿', { exact: true });
    await draft.fill('Draft survives management navigation');
    await openDrawerTab(page,'文件');
    await expect(page.getByRole('alert')).toContainText('文件加载失败');
    await page.getByRole('button', { name: '关闭加载' }).click();
    await expect(page.getByRole('tab', { name: '证据', exact: true })).toBeFocused();
    await openDrawerTab(page,'文件');
    await expect(page.getByRole('tree')).toBeVisible();
    await page.goto(`${f.app.origin}/work/session/${f.session.id}/models`);
    await expect(page.getByRole('alert')).toContainText('模型管理加载失败');
    await page.getByRole('button', { name: '重试加载' }).click();
    await expect(page.getByRole('heading', { name: '模型用途与配置' })).toBeVisible();
    await page.goBack();
    await expect(draft).toHaveJSProperty('textContent', 'Draft survives management navigation');
  } finally { await f.app.close(); }
});

test('10.9 a broken optional component is contained and explicit retry replaces it', async ({ page }) => {
  const f = await fixture(), file = await chunk('components/Changes.tsx');
  await page.route(`**/${file}*`, route => route.fulfill({ contentType: 'text/javascript', body: 'export function Changes(){throw new Error("broken optional view")}' }), { times: 1 });
  try {
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    const draft = page.getByLabel('任务草稿', { exact: true });
    await draft.fill('Still editable');
    await openDrawerTab(page,'变更');
    await expect(page.getByRole('alert')).toContainText('变更加载失败');
    await draft.fill('Still editable after render failure');
    await page.getByRole('button', { name: '重试加载' }).click();
    await expect(page.getByRole('region', { name: '会话文件修改' })).toBeVisible();
    await expect(draft).toHaveJSProperty('textContent', 'Still editable after render failure');
  } finally { await f.app.close(); }
});

test('10.9 host recovery stays available when appearance code cannot load',async({page})=>{
  const f=await fixture(),file=await chunk('v2/routes/themes.tsx');
  await page.route(`**/${file}*`,route=>route.abort());
  try {
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    await page.getByLabel('任务草稿',{exact:true}).fill('Recovery without theme code');
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('主题管理加载失败');
    await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Recovery without theme code');
    await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>sessionStorage.getItem('v2-extension-display'))).toBe('hidden');
  }finally{await f.app.close();}
});


test('11.6 closing the delayed dialog shell preserves the draft and focus after its response',async({page})=>{
  const f=await fixture(),file=await chunk('v2/more-dialog.tsx');
  let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/${file}*`,async route=>{await waiting;await route.continue();});
  try{
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    const draft=page.getByLabel('任务草稿',{exact:true});await draft.fill('Keep editing during dialog load');
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'导出当前会话',exact:true}).click();
    const loading=page.getByRole('region',{name:'对话框加载',exact:true});await expect(loading).toBeVisible();
    await loading.getByRole('button',{name:'关闭加载'}).click();await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();await draft.focus();
    const finished=page.waitForResponse(response=>response.url().includes(file));release();await finished;
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(draft).toBeFocused();await expect(draft).toHaveJSProperty('textContent','Keep editing during dialog load');
  }finally{release();await f.app.close();}
});

test('11.6 context details loads on demand; recovery is statically available without optional chunks',async({page})=>{
  const f=await fixture(),contextFile=await chunk('v2/routes/context-details.tsx');
  const requested:string[]=[];page.on('request',request=>requested.push(request.url()));
  try{
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    const draft=page.getByLabel('任务草稿',{exact:true});await draft.fill('Retain recovery draft');
    expect(requested.some(url=>url.includes(contextFile))).toBe(false);
    await page.getByRole('button',{name:/^上下文/}).click();await expect(page.getByRole('button',{name:'刷新只读详情'})).toBeVisible();
    await page.getByRole('button',{name:'关闭详情'}).click();
    // 恢复路径静态可用：不请求 core-recovery chunk，也不依赖其加载成功
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'版本与恢复',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'核心版本与恢复记录'})).toBeVisible();
    expect(requested.some(url=>url.includes('core-recovery'))).toBe(false);
    await page.getByRole('button',{name:'关闭恢复信息'}).click();await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();
    await expect(draft).toHaveJSProperty('textContent','Retain recovery draft');
  }finally{await f.app.close();}
});
