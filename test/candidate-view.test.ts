import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { startWeb } from '../src/server/app.js';
import { Candidates } from '../src/customization/candidates.js';
import * as validation from '../src/customization/validation.js';
import { coreTreeManifest } from '../src/core/manifest.js';
import { temporary } from './helpers.js';

it('reads scoped candidate differences without compiling, loading factories or writing lifecycle evidence', async () => {
  const workspace = await temporary(), home = await temporary(), development = await temporary(), candidate = await new Candidates(development).scaffold('readonly');
  await writeFile(join(candidate.path, 'index.ts'), 'throw new Error("must not execute"); export default () => {};');
  const app = await startWeb({ workspace, home, naming: false });
  const compile = vi.spyOn(validation, 'checkTypes');
  try {
    await app.sessions.waitInitialization();
    const session = await app.sessions.create('target', { commandId: 'create-view', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
    const before = await coreTreeManifest(development);
    const response = await fetch(app.origin + `/api/v1/customization/candidates/${candidate.id}?session=${session.id}`, { headers: { authorization: `Bearer ${app.token}` } });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ id: candidate.id, evidence: [], files: expect.arrayContaining([expect.objectContaining({ name: 'index.ts', change: 'added' })]) });
    expect(compile).not.toHaveBeenCalled(); expect((await coreTreeManifest(development)).revision).toBe(before.revision);
    const work = await app.sessions.create('work', { commandId: 'work-view', mode: 'work' });
    const denied = await fetch(app.origin + `/api/v1/customization/candidates/${candidate.id}?session=${work.id}`, { headers: { authorization: `Bearer ${app.token}` } });
    expect(denied.status).toBe(403);
  } finally { compile.mockRestore(); await app.close(); }
});
it('persists explicit compiler diagnostics and keeps obsolete content evidence separate', async () => {
  const development = await temporary(), candidate = await new Candidates(development).scaffold('diagnostics');
  await writeFile(join(candidate.path, 'index.ts'), 'const incompatible: string = 123; export default () => {};');
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), naming: false });
  try {
    const session = await app.sessions.create('target', { commandId: 'create-diagnostic', mode: 'create', target: { kind: 'extension', root: development, scope: 'project' } });
    await app.sessions.customizationAction({ action: 'candidate-inspect', id: candidate.id, sessionId: session.id });
    const view = await app.sessions.candidateView(candidate.id, session.id);
    expect(view.evidence).toHaveLength(1); expect(view.evidence[0]).toMatchObject({ stage: 'static', passed: false, diagnostics: expect.arrayContaining([expect.objectContaining({ file: 'index.ts' })]) });
    await writeFile(join(candidate.path, 'index.ts'), 'export default () => {};');
    const changed = await app.sessions.candidateView(candidate.id, session.id);
    expect(changed.evidence).toHaveLength(0); expect(changed.previousEvidence).toHaveLength(1);
  } finally { await app.close(); }
});
