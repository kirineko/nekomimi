import { test, expect } from '@playwright/test';
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { startWeb } from '../../src/server/app.js';
import { coreViewFixture, coreViewHistory } from '../fixtures/core-view.js';
import { CoreBuilds } from '../../src/core/builds.js';
import type { CoreBuildResult } from '../../src/core/builds.js';
import { Journal } from '../../src/journal.js';

test('10.2 core candidate deep links show immutable baseline differences and recorded validation without writes', async ({ page }) => {
  const f = await coreViewFixture(); await coreViewHistory(f);
  await writeFile(join(f.candidate.directory, 'src/cli.ts'), 'export const current = "edited candidate";');
  await writeFile(join(f.source, 'src/cli.ts'), 'source changed after preparation');
  const app = await startWeb({ workspace: f.workspace, home: f.home, naming: false, staticDir: resolve('dist/web-dist') });
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  try {
    const session = await app.sessions.create('核心开发', { commandId: 'create-core', mode: 'create', target: { kind: 'core', root: f.candidate.directory } });
    await page.goto(`${app.origin}/create/session/${session.id}#token=${app.token}`);
    await page.getByRole('link', { name: '查看核心源码差异与验证记录' }).click();
    await expect(page.getByRole('heading', { name: '核心源码候选' })).toBeVisible();
    await page.getByText('修改 · src/cli.ts', { exact: true }).click();
    await expect(page.getByText('export const baseline = "saved baseline";', { exact: true })).toBeVisible();
    await expect(page.getByText('export const current = "edited candidate";', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '构建与验证记录' }).click();
    await expect(page.getByRole('heading', { name: '可信构建 · 失败', exact: true })).toBeVisible();
    await expect(page.getByText('fixture compiler diagnostic: build deliberately failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '可信构建 · 尚无可靠终态', exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole('heading', { name: '核心源码候选' })).toBeVisible();
    await page.getByRole('tab', { name: '构建与验证记录' }).click();
    await page.screenshot({ path: '/tmp/nekomimi-core-candidate-view.png', fullPage: true });
    await page.setViewportSize({ width: 360, height: 760 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes.map(url => new URL(url).pathname)).toEqual(['/api/v1/connect']);
  } finally { await app.close(); }
});

test('10.2 reviewed core build continues across navigation and stops only after explicit cancellation', async ({ page }) => {
  const f = await coreViewFixture();
  await writeFile(join(f.candidate.directory, 'forbidden-build.cjs'), 'console.log("browser build running"); setInterval(() => {}, 100);');
  const app = await startWeb({ workspace: f.workspace, home: f.home, naming: false, staticDir: resolve('dist/web-dist') });
  try {
    const session = await app.sessions.create('后台核心开发', { commandId: 'core-session', mode: 'create', target: { kind: 'core', root: f.candidate.directory } });
    const path = `${app.origin}/create/session/${session.id}/core`;
    await page.goto(path + '#token=' + app.token); await page.getByRole('tab', { name: '构建与验证记录' }).click();
    await page.getByRole('button', { name: '审阅当前构建计划' }).click();
    await expect(page.getByRole('button', { name: '启动后台构建' })).toBeDisabled();
    expect(await app.sessions.coreOperationView(session.id)).toEqual([]);
    await page.getByLabel('我授权执行此计划的依赖安装和构建脚本').check(); await page.getByRole('button', { name: '启动后台构建' }).click();
    await expect.poll(async () => (await new CoreBuilds(f.candidates).records()).some(event => event.type === 'core.build.process.started' && (event.payload as { step: number }).step === 1), { timeout: 30000 }).toBe(true);
    const task = (await app.sessions.coreOperationView(session.id))[0]!; expect(task.status).toBe('running');
    await page.goto(app.origin + '/work'); await page.goto(path); await page.getByRole('tab', { name: '构建与验证记录' }).click();
    await expect(page.getByRole('article', { name: `核心操作 ${task.commandId}` })).toBeVisible();
    await page.getByRole('button', { name: '请求停止核心任务' }).click();
    await expect(page.getByRole('heading', { name: '后台构建 · 已取消', exact: true })).toBeVisible({ timeout: 15000 });
    expect(await app.sessions.coreOperationView(session.id)).toEqual([expect.objectContaining({ commandId: task.commandId, status: 'cancelled', cancelRequested: true })]);
    await page.screenshot({ path: '/tmp/nekomimi-core-operations.png', fullPage: true });
  } finally { await app.close(); }
});

test('10.2 explicit isolated validation runs the real compiled probe and reports its own stage', async ({ page }) => {
  const f = await coreViewFixture(), buildId = 'admission-fixture', artifactRevision = 'a'.repeat(64);
  // Only artifact admission is a fixture; the isolated compiled process and its checks are real.
  const result: CoreBuildResult = { version: 1, buildId, commandId: 'fixture-build', candidateId: f.candidate.id, inputHash: 'b'.repeat(64), status: 'passed', processes: [],
    artifact: { directory: resolve('.'), revision: artifactRevision, manifest: { kind: 'artifact', sha256: 'c'.repeat(64), bytes: 0 } }, hostIntegration: 'not_run', applied: false };
  const journal = await Journal.open(join(f.home, 'core-builds', 'journal'));
  // The display fixture contains no fabricated manifest reference; admission returns it separately.
  await journal.append('core.build.intent', { candidateId: f.candidate.id, buildId, commandId: 'fixture-build', plan: { sourceRevision: f.candidate.source.revision } }, { candidateId: f.candidate.id, validationTaskId: buildId });
  await journal.append('core.build.finished', { ...result, artifact: { directory: resolve('.'), revision: artifactRevision } }, { candidateId: f.candidate.id, validationTaskId: buildId });
  await journal.close();
  const inspect = CoreBuilds.prototype.inspect;
  CoreBuilds.prototype.inspect = async function (id: string) {
    if (id !== buildId || this.candidates.home !== f.candidates.home) return inspect.call(this, id);
    return { result, validForCurrent: true, invalidReason: undefined, hostIntegration: 'not_run', applied: false };
  };
  const app = await startWeb({ workspace: f.workspace, home: f.home, naming: false, staticDir: resolve('dist/web-dist') });
  try {
    const session = await app.sessions.create('隔离验证', { commandId: 'validate-session', mode: 'create', target: { kind: 'core', root: f.candidate.directory } });
    await page.goto(`${app.origin}/create/session/${session.id}/core#token=${app.token}`); await page.getByRole('tab', { name: '构建与验证记录' }).click();
    await page.getByLabel('待验证构建').selectOption(buildId);
    await expect(page.getByRole('button', { name: '启动独立验证' })).toBeDisabled();
    await page.getByLabel('我授权在隔离目录启动所选候选进行独立验证').check(); await page.getByRole('button', { name: '启动独立验证' }).click();
    await expect(page.getByRole('heading', { name: '后台独立验证 · 通过', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: '独立启动验证 · 通过（历史记录）', exact: true })).toBeVisible();
    const operation = (await app.sessions.coreOperationView(session.id))[0]!;
    expect(operation.kind).toBe('validation'); expect(operation.resultId).toBeTruthy();
    const view = await app.sessions.coreCandidateView(session.id);
    expect(view.tasks.find(task => task.kind === 'validation')?.checks).toContain('ports-closed');
  } finally { await app.close(); CoreBuilds.prototype.inspect = inspect; }
});
