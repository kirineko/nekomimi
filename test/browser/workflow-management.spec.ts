import { test, expect } from '@playwright/test';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { temporary } from '../helpers.js';
import { readSession } from '../../src/journal.js';
async function fixture(unknown: boolean | 'slow' = false) {
  const workspace = await temporary(), home = await temporary(), root = join(workspace, '.nekomimi/extensions/durable');
  await mkdir(root, { recursive: true }); await writeFile(join(workspace, 'review.txt'), 'Fixture review');
  await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'durable', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['workflows','tools','workspace-state'] }));
  if (unknown === 'slow') await writeFile(join(root, 'index.ts'), `import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{api.registerWorkflow({id:'slow-review',schemaVersion:1,inputSchema:{type:'object'},entry:'wait',steps:{wait:{transitions:[],async execute(_input,ctx){await ctx.callTool('bash',{command:'sleep 30'});return {kind:'complete',output:null};}}}})}) satisfies ExtensionFactory3;`);
  else if (unknown) await writeFile(join(root, 'index.ts'), `import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{api.registerWorkflow({id:'unknown-review',schemaVersion:1,inputSchema:{type:'object'},entry:'effect',steps:{effect:{transitions:[],async execute(_input,ctx){await ctx.callTool('write',{path:'external.txt',content:'one recorded effect'});throw Error('Injected failure after external effect');}}}})}) satisfies ExtensionFactory3;`);
  else await copyFile(resolve('extension-docs/durable-review.ts'), join(root, 'index.ts'));
  const options = { workspace, home, naming: false, staticDir: resolve('dist/web-dist') }, app = await startWeb(options);
  await app.sessions.waitInitialization(); const resource = (await app.sessions.customization.catalog.discover()).find(item => item.name === 'durable')!;
  await app.sessions.customization.catalog.decide(resource.id, true, true, 0); await app.sessions.customization.initialize();
  return { app, options, workspace, root };
}
async function start(page: import('@playwright/test').Page) {
  await page.getByText('启动新工作流', { exact: true }).click();
  await page.getByLabel('工作流定义', { exact: true }).selectOption({ index: 1 });
}
test('10.4 durable workflow wait survives restart and only an explicit answer continues it', async ({ page }) => {
  const f = await fixture(); let app = f.app; const actions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization')) actions.push(request.postDataJSON().action); });
  try {
    await page.goto(app.origin + '/work/workflows#token=' + app.token); await start(page); expect(actions).toEqual([]);
    await page.getByLabel('工作流输入 JSON', { exact: true }).fill('{"target":"review.txt"}'); await page.getByRole('button', { name: '启动工作流', exact: true }).click();
    await expect(page.getByRole('form', { name: '审查确认' })).toBeVisible({ timeout: 15000 });
    await app.close(); app = await startWeb(f.options); await page.goto(app.origin + '/work/workflows#token=' + app.token);
    await expect(page.getByRole('form', { name: '审查确认' })).toBeVisible(); expect(actions.filter(action => action === 'workflow-start')).toHaveLength(1);
    await page.getByLabel('审查决定', { exact: true }).selectOption('通过'); await page.getByRole('button', { name: '刷新工作流状态', exact: true }).click(); await expect(page.getByLabel('审查决定', { exact: true })).toHaveValue('通过');
    await page.getByRole('button', { name: '提交并继续工作流', exact: true }).click(); await expect(page.getByRole('article', { name: '工作流 durable-review', exact: true })).toContainText('已完成');
    await page.getByRole('button', { name: '查看工作流证据', exact: true }).click(); await expect(page.getByRole('region', { name: '工作流证据', exact: true })).toContainText('workflow.answered');
    const [flow] = await app.sessions.customization.workflows.list(); const history = await readSession(join(f.workspace, '.nekomimi/workflows', flow!.id));
    expect(history.events.filter(event => event.type === 'workflow.answered')).toHaveLength(1);
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await app.close(); }
});
test('10.4 unknown workflow reconciliation does not repeat external effects or resume on navigation', async ({ page }) => {
  const f = await fixture(true);
  try {
    await page.goto(f.app.origin + '/work/workflows#token=' + f.app.token); await start(page); await page.getByRole('button', { name: '启动工作流', exact: true }).click();
    await expect(page.getByRole('region', { name: '核对未知结果', exact: true })).toBeVisible({ timeout: 15000 });
    await page.reload(); await expect(page.getByRole('region', { name: '核对未知结果', exact: true })).toBeVisible();
    await page.getByLabel('核对记录', { exact: true }).fill('已核对文件，只发生一次写入'); await page.getByLabel('核对后的结果 JSON', { exact: true }).fill('{"kind":"complete","output":{"verified":true}}');
    await page.getByRole('button', { name: '提交已核对结果', exact: true }).click(); await expect(page.getByRole('article', { name: '工作流 unknown-review', exact: true })).toContainText('已完成');
    const [flow] = await f.app.sessions.customization.workflows.list(), history = await readSession(join(f.workspace,'.nekomimi/workflows',flow!.id));
    expect(history.events.filter(event => event.type === 'tool.intent' && (event.payload as { name?: string }).name === 'write')).toHaveLength(1);
    expect(await readFile(join(f.workspace,'external.txt'),'utf8')).toBe('one recorded effect');
  } finally { await f.app.close(); }
});
test('10.4 definition version change is rejected and invalid input stays editable without automatic retry', async ({ page }) => {
  const f = await fixture(); let starts = 0;
  try {
    await page.goto(f.app.origin + '/work/workflows#token=' + f.app.token); await start(page);
    await page.getByLabel('工作流输入 JSON', { exact: true }).fill('{bad'); await page.getByRole('button', { name: '启动工作流', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    expect(await f.app.sessions.customization.workflows.list()).toHaveLength(0);
    await page.getByLabel('工作流输入 JSON', { exact: true }).fill('{"target":"review.txt"}');
    await writeFile(join(f.root,'index.ts'), (await readFile(join(f.root,'index.ts'),'utf8')) + '\n// changed revision\n');
    const resource = (await f.app.sessions.customization.catalog.discover()).find(item => item.name === 'durable')!;
    await f.app.sessions.customization.catalog.decide(resource.id,true,true,(await f.app.sessions.customization.catalog.decisions()).revision); await f.app.sessions.customization.initialize();
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/customization') && request.postDataJSON().action === 'workflow-start') starts++; });
    await page.getByRole('button', { name: '启动工作流', exact: true }).click(); await expect(page.getByText('工作流定义已变化', { exact: false })).toBeVisible(); expect(starts).toBe(1); expect(await f.app.sessions.customization.workflows.list()).toHaveLength(0);
    await expect(page.getByLabel('工作流输入 JSON', { exact: true })).toHaveValue('{"target":"review.txt"}');
  } finally { await f.app.close(); }
});

test('10.4 create-target workflow migration invalidates the old wait and requires explicit continuation', async ({ page }) => {
  const f = await fixture(), development = await temporary(), root = join(development, '.nekomimi/extensions/scoped');
  await mkdir(root, { recursive: true }); await writeFile(join(development,'review.txt'),'Scoped fixture');
  await writeFile(join(root,'extension.json'), JSON.stringify({ name:'scoped',sdkVersion:3,entry:'index.ts',requiredCapabilities:['workflows','tools','workspace-state'] }));
  await copyFile(resolve('extension-docs/durable-review.ts'),join(root,'index.ts'));
  try {
    const session = await f.app.sessions.create('独立工作流目标',{commandId:'scoped-workflow',mode:'create',target:{kind:'extension',root:development,scope:'project'}});
    const data = await f.app.sessions.describeCustomization(session.id), resource = data.resources.find(resource => resource.name === 'scoped')!;
    await f.app.sessions.customizationAction({action:'authorize-version',sessionId:session.id,id:resource.id,contentHash:resource.hash,revision:data.settingsRevision});
    await expect.poll(async () => (await f.app.sessions.describeCustomization(session.id)).workflowDefinitions.length).toBe(1);
    await page.goto(f.app.origin + `/create/session/${session.id}/workflows#token=` + f.app.token); await start(page);
    await page.getByLabel('工作流输入 JSON',{exact:true}).fill('{"target":"review.txt"}'); await page.getByRole('button',{name:'启动工作流',exact:true}).click();
    await expect(page.getByRole('form',{name:'审查确认'})).toBeVisible({timeout:15000}); expect(await f.app.sessions.customization.workflows.list()).toHaveLength(0);
    await page.getByText('显式迁移工作流定义',{exact:true}).click(); await page.getByLabel('迁移目标',{exact:true}).selectOption({index:1}); await page.getByLabel('目标步骤',{exact:true}).fill('finish');
    await page.getByLabel('迁移输入',{exact:true}).fill('{"target":"review.txt"}'); await page.getByLabel('迁移说明',{exact:true}).fill('已核对，迁移到结束步骤'); await page.getByRole('button',{name:'检查并迁移',exact:true}).click();
    await expect(page.getByRole('form',{name:'审查确认'})).toHaveCount(0); await expect(page.getByRole('article',{name:'工作流 durable-review',exact:true})).toContainText('可继续');
    const [flow] = (await f.app.sessions.describeCustomization(session.id)).workflows; expect(flow?.mode).toBe('create'); expect(flow?.status).toBe('ready');
    await page.reload(); await expect(page.getByRole('button',{name:'继续工作流',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'继续工作流',exact:true}).click(); await expect(page.getByRole('article',{name:'工作流 durable-review',exact:true})).toContainText('已完成');
    await page.getByRole('button',{name:'查看工作流证据',exact:true}).click(); await expect(page.getByRole('region',{name:'工作流证据',exact:true})).toContainText('workflow.migrated');
  } finally { await f.app.close(); }
});

test('10.4 running workflow keeps cancellation reachable while continuation actions are locked', async ({ page }) => {
  const f = await fixture('slow');
  try {
    await page.goto(f.app.origin + '/work/workflows#token=' + f.app.token); await start(page); await page.getByRole('button',{name:'启动工作流',exact:true}).click();
    await expect(page.getByRole('article',{name:'工作流 slow-review',exact:true})).toContainText('执行中',{timeout:15000});
    await expect(page.getByRole('button',{name:'启动工作流',exact:true})).toBeDisabled();
    const [flow] = await f.app.sessions.customization.workflows.list();
    await expect.poll(async () => (await readSession(join(f.workspace,'.nekomimi/workflows',flow!.id))).events.filter(event => event.type === 'tool.intent' && (event.payload as {name?:string}).name === 'bash').length).toBe(1);
    await expect(page.getByRole('button',{name:'取消工作流',exact:true})).toBeEnabled(); await page.getByRole('button',{name:'取消工作流',exact:true}).click();
    await expect(page.getByRole('article',{name:'工作流 slow-review',exact:true})).toContainText('已取消',{timeout:15000});
    const history = await readSession(join(f.workspace,'.nekomimi/workflows',flow!.id));
    const terminal = history.events.find(event => ['tool.completed','tool.execution_error'].includes(event.type) && (event.payload as {name?:string}).name === 'bash');
    const cancelled = history.events.find(event => event.type === 'workflow.cancelled');
    expect(terminal).toBeDefined(); expect(cancelled).toBeDefined(); expect(terminal!.seq).toBeLessThan(cancelled!.seq);
    await page.reload(); await expect(page.getByRole('article',{name:'工作流 slow-review',exact:true})).toContainText('已取消');
  } finally { await f.app.close(); }
});
