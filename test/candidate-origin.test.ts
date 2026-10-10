import { expect, it, vi } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Candidates } from '../src/customization/candidates.js';
import { run } from '../src/runtime.js';
import { readSession } from '../src/journal.js';
import { sessionBinding } from '../src/session/identity.js';
import * as sdk from '../src/customization/sdk.js';
import { temporary, key, response, callItem, textItem } from './helpers.js';

it('persists the actual creating session, target host and project scope without executing on inspection', async () => {
  const workspace = await temporary(), ownerWorkspace = await temporary(), home = await temporary(); let requests = 0;
  const result = await run({ workspace, ownerWorkspace, home, session: join(await temporary(), 'session'), mode: 'create', target: { kind: 'extension', root: workspace }, apiKey: key, prompt: 'create candidate', tools: ['customization_candidate'], fetch: async () => response(++requests === 1 ? [callItem('customization_candidate', { action: 'create', name: 'bound' })] : [textItem('created')]) });
  expect(result.status, result.error).toBe('completed');
  const session = await readSession(result.session), binding = sessionBinding(session.events)!;
  const store = new Candidates(workspace), candidateId = (await store.list())[0]!;
  const checked = await store.inspect(candidateId);
  expect(checked.candidate.origin).toEqual({ session: binding, runId: result.runId });
  const reopened = new Candidates(workspace);
  expect((await reopened.inspect(candidateId)).candidate.origin).toEqual(checked.candidate.origin);
  expect(checked.candidate.origin?.session.target.scope).toBe('project');
  const journalPath = join(store.base, 'customization-journal', 'journal.jsonl');
  const before = await readFile(journalPath);
  const original = await sdk.hostIdentity();
  const spy = vi.spyOn(sdk, 'hostIdentity').mockResolvedValue({ ...original, build: 'f'.repeat(64) });
  try {
    await expect(reopened.prepare(candidateId, checked.candidate.contentHash)).rejects.toThrow();
    expect(await readFile(journalPath)).toEqual(before);
    expect((await reopened.inspect(candidateId)).candidate.origin).toEqual(checked.candidate.origin);
    expect(await reopened.active()).toEqual([]);
  } finally { spy.mockRestore(); }
  expect(requests).toBe(2);
}, 30000);

it('invalidates checked content when its declared dependency lock changes', async () => {
  const store = new Candidates(await temporary()), draft = await store.scaffold('locked');
  await writeFile(join(draft.path, 'package.json'), JSON.stringify({ name: 'locked', type: 'module', dependencies: {} }));
  await writeFile(join(draft.path, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  const before = await store.inspect(draft.id);
  expect(before.candidate.report.passed).toBe(true);
  await writeFile(join(draft.path, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { version: '2.0.0' } } }));
  await expect(store.prepare(draft.id, before.candidate.contentHash)).rejects.toThrow('changed since validation');
  expect((await store.inspect(draft.id)).candidate.contentHash).not.toBe(before.candidate.contentHash);
  expect(await store.active()).toEqual([]);
  expect(await store.origin(draft.id)).toBeUndefined();
});

it('binds user packages without granting new permissions and detects stripped origin metadata', async () => {
  const { mkdir } = await import('node:fs/promises');
  const { Packages } = await import('../src/customization/packages.js');
  const { CustomizationHost } = await import('../src/customization/host.js');
  const { createSessionBinding } = await import('../src/session/identity.js');
  const { hash } = await import('../src/journal.js');
  const workspace = await temporary(), ownerWorkspace = await temporary(), home = await temporary(), source = join(workspace, 'package');
  await mkdir(source);
  const { prepareDataHome } = await import('../src/storage/format.js'); await prepareDataHome(home);
  const manifest = { manifestVersion: 1, name: 'bound-package', version: '1.0.0', sdkVersion: 3, requiredCapabilities: ['commands'], dependencies: {}, resources: [{ kind: 'extension', name: 'bound-package', entry: 'index.ts' }] };
  await writeFile(join(source, 'nekomimi.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'index.ts'), `export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('bound',{description:'bound',async handler(){return 'ready'}})}`);
  const session = await createSessionBinding(ownerWorkspace, 'creator', { commandId: 'create-origin', mode: 'create', target: { kind: 'extension', root: workspace } }, hash('create'));
  const origin = { session, runId: 'creator-run' }, store = new Packages(workspace, home), host = new CustomizationHost(workspace, home);
  try {
    const first = await store.prepare({ kind: 'local', path: source }, 'user', {}, undefined, origin);
    expect((await store.preview('user', first.id)).candidate.origin).toEqual(origin);
    await expect(host.requestPackage(first.id, 'user')).rejects.toThrow('authorization');
    const receipt = await host.requestPackage(first.id, 'user', true); await host.reload(receipt);
    expect(receipt.status, receipt.error).toBe('activated');
    await writeFile(join(source, 'nekomimi.json'), JSON.stringify({ ...manifest, requiredCapabilities: ['commands', 'state'] }));
    const update = await store.prepare({ kind: 'local', path: source }, 'user', {}, undefined, origin);
    await expect(host.requestPackage(update.id, 'user')).rejects.toThrow('authorization');
    expect((await store.list())[0]?.revision).toBe(first.revision);
    const metadata = join(home, 'package-candidates', update.id + '.json');
    const stripped = { ...update }; delete stripped.origin;
    await writeFile(metadata, JSON.stringify(stripped));
    await expect(host.requestPackage(update.id, 'user', true)).rejects.toThrow('origin mismatch');
    expect((await store.list())[0]?.revision).toBe(first.revision);
  } finally { await host.close(); }
}, 30000);
