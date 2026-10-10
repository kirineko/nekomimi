import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { startWeb } from '../src/server/app.js';
import { CoreBuilds } from '../src/core/builds.js';
import { CoreValidations } from '../src/core/validations.js';
import { coreTreeManifest } from '../src/core/manifest.js';
import { coreViewFixture, coreViewHistory } from './fixtures/core-view.js';

it('reads persisted baseline text, candidate diff and output artifacts without invoking builds or validation', async () => {
  const f = await coreViewFixture();
  await writeFile(join(f.candidate.directory, 'src/cli.ts'), 'export const current = "edited candidate";');
  await writeFile(join(f.source, 'src/cli.ts'), 'source no longer matches baseline');
  await coreViewHistory(f);
  const app = await startWeb({ workspace: f.workspace, home: f.home, naming: false });
  const build = vi.spyOn(CoreBuilds.prototype, 'build'), validate = vi.spyOn(CoreValidations.prototype, 'validate'), plan = vi.spyOn(CoreBuilds.prototype, 'plan');
  try {
    await app.sessions.waitInitialization();
    const session = await app.sessions.create('core', { commandId: 'create-core', mode: 'create', target: { kind: 'core', root: f.candidate.directory } });
    const before = (await coreTreeManifest(f.home)).revision;
    const response = await fetch(`${app.origin}/api/v1/sessions/${session.id}/core-candidate`, { headers: { authorization: `Bearer ${app.token}` } });
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.files).toEqual([expect.objectContaining({ path: 'src/cli.ts', change: 'modified', before: 'export const baseline = "saved baseline";', after: 'export const current = "edited candidate";' })]);
    expect(view.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fixture-build', status: 'failed', logs: [expect.objectContaining({ text: 'fixture compiler diagnostic: build deliberately failed' })] }), expect.objectContaining({ id: 'unfinished-build', status: 'unconfirmed' })]));
    expect((await coreTreeManifest(f.home)).revision).toBe(before);
    expect(build).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled(); expect(plan).not.toHaveBeenCalled();
    const work = await app.sessions.create('work', { commandId: 'work', mode: 'work' });
    await expect(app.sessions.coreCandidateView(work.id)).rejects.toMatchObject({ status: 403 });
  } finally { build.mockRestore(); validate.mockRestore(); plan.mockRestore(); await app.close(); }
});
it('reports missing build history attachments locally without hiding source differences', async () => {
  const f = await coreViewFixture(); await coreViewHistory(f);
  await rm(join(f.home, 'core-builds', 'journal', 'artifacts'), { recursive: true });
  const app = await startWeb({ workspace: f.workspace, home: f.home, naming: false });
  try {
    const session = await app.sessions.create('core', { commandId: 'create-core', mode: 'create', target: { kind: 'core', root: f.candidate.directory } });
    const view = await app.sessions.coreCandidateView(session.id);
    expect(view.id).toBe(f.candidate.id); expect(view.historyErrors).toHaveLength(1); expect(view.historyErrors[0]).toContain('记录不可读');
  } finally { await app.close(); }
});
