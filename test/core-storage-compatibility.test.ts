import { expect, it } from 'vitest';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, Journal } from '../src/journal.js';
import { inspectCoreStorage } from '../src/core/storage-compatibility.js';
import { coreTreeManifest } from '../src/core/manifest.js';
import { workspacePaths } from '../src/storage/paths.js';
import { temporary } from './helpers.js';

async function fixture() {
  const root = await temporary(), workspace = join(root, 'workspace'), home = join(root, 'data'); await mkdir(workspace);
  const paths = await workspacePaths(workspace, home);
  const journal = await Journal.open(join(paths.sessions, 'session-one'));
  await journal.append('session.created', { title: 'retained session' }); await journal.close();
  return { root, workspace, home, paths };
}
it('reads existing storage with the selected reader without writing or loading extensions', async () => {
  const f = await fixture(), directory = join(f.workspace, '.nekomimi/extensions'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'danger.ts'), 'throw new Error("factory must not load");');
  const before = await coreTreeManifest(f.root);
  expect(await inspectCoreStorage(f.workspace, f.home)).toEqual({ version: 1, dataFormatVersion: 2, sdkVersion: 3, journals: 1, writes: false });
  expect((await coreTreeManifest(f.root)).revision).toBe(before.revision);
});
it('refuses a future data format before changing any old or new data', async () => {
  const f = await fixture(); await writeFile(join(f.home, 'nekomimi-format.json'), JSON.stringify({ product: 'nekomimi', formatVersion: 999 }));
  const before = await coreTreeManifest(f.root);
  await expect(inspectCoreStorage(f.workspace, f.home)).rejects.toThrow('格式不受支持');
  expect((await coreTreeManifest(f.root)).revision).toBe(before.revision);
});
it('rejects future Journal schemas and tentative history without repairing it', async () => {
  const f = await fixture(), file = join(f.paths.sessions, 'session-one/journal.jsonl'), original = await readFile(file, 'utf8');
  const event = JSON.parse(original.trim()); event.schemaVersion = 2; const { hash: _, ...body } = event; event.hash = hash(JSON.stringify(body)); await writeFile(file, JSON.stringify(event) + '\n');
  let before = await coreTreeManifest(f.root); await expect(inspectCoreStorage(f.workspace, f.home)).rejects.toThrow('Invalid journal chain'); expect((await coreTreeManifest(f.root)).revision).toBe(before.revision);
  await writeFile(file, original + '{"unfinished":'); before = await coreTreeManifest(f.root);
  await expect(inspectCoreStorage(f.workspace, f.home)).rejects.toThrow('explicit recovery'); expect((await coreTreeManifest(f.root)).revision).toBe(before.revision);
});
it('rejects incompatible configuration and workspace identity without falling back to defaults', async () => {
  const f = await fixture(); await writeFile(join(f.home, 'auth.json'), JSON.stringify({ version: 3, formatVersion: 2, revision: 0 }));
  await expect(inspectCoreStorage(f.workspace, f.home)).rejects.toThrow('Configuration version');
  await writeFile(join(f.home, 'auth.json'), JSON.stringify({ version: 2, formatVersion: 2, revision: 0 }));
  await writeFile(join(f.paths.root, 'workspace.json'), JSON.stringify({ version: 2, formatVersion: 2, workspace: '/different' }));
  await expect(inspectCoreStorage(f.workspace, f.home)).rejects.toThrow('workspace identity');
});
it('does not follow workflow storage outside the workspace', async () => {
  const f = await fixture(), outside = await temporary(); await mkdir(join(f.workspace, '.nekomimi')); await symlink(outside, join(f.workspace, '.nekomimi/workflows'));
  await expect(inspectCoreStorage(f.workspace, f.home)).rejects.toThrow('symlink');
});
