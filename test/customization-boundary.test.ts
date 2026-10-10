import { expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Candidates } from '../src/customization/candidates.js';
import { CustomizationHost } from '../src/customization/host.js';
import { run } from '../src/runtime.js';
import { readSession } from '../src/journal.js';
import { temporary, key } from './helpers.js';

it('keeps an active command on its original implementation until a queued candidate is committed', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), host = new CustomizationHost(workspace, home);
  const draft = await store.scaffold('boundary');
  await writeFile(join(draft.path, 'index.ts'), `import {existsSync,writeFileSync} from 'node:fs';export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('boundary',{description:'old',async handler(){writeFileSync('started','yes');while(!existsSync('release'))await new Promise(r=>setTimeout(r,10));return 'old implementation'}})}`);
  const initial = (await store.inspect(draft.id)).candidate;
  try {
    const first = await host.requestCandidate(draft.id, initial.contentHash, true); await host.reload(first);
    const active = host.active, session = join(workspace, 'session');
    const running = run({ workspace, home, customization: host, session, apiKey: key, prompt: '/boundary' });
    await expect.poll(() => readFile(join(workspace, 'started'), 'utf8').catch(() => ''), { timeout: 8000 }).toBe('yes');
    await writeFile(join(draft.path, 'index.ts'), `export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('boundary',{description:'new',async handler(){return 'new implementation'}})}`);
    const preview = await store.preview(draft.id);
    const pending = await host.requestCandidate(draft.id, preview.contentHash, false, undefined, preview.activeRevision);
    expect(pending.status).toBe('pending'); expect(host.active).toBe(active);
    await host.reload(pending); expect(pending.status).toBe('pending');
    expect((await store.active())[0]?.revision).toBe(initial.contentHash);
    await writeFile(join(workspace, 'release'), 'yes');
    expect((await running).text).toBe('old implementation');
    expect(pending.status, pending.error).toBe('activated');
    expect((await store.active())[0]?.revision).toBe(preview.contentHash);
    const next = await run({ workspace, home, customization: host, session, apiKey: key, prompt: '/boundary' });
    expect(next.text).toBe('new implementation');
    const before = await host.catalog.decisions();
    await expect(host.requestRollback('boundary', true, initial.contentHash, preview.activeRevision)).rejects.toThrow('revision conflict');
    await expect(host.requestRollback('boundary', true, preview.contentHash, await store.revision())).rejects.toThrow('target revision conflict');
    expect(await host.catalog.decisions()).toEqual(before);
    expect((await store.active())[0]?.revision).toBe(preview.contentHash);
  } finally { await writeFile(join(workspace, 'release'), 'yes'); await host.close(); }
}, 30000);

it('stops rolled-back code after a state mismatch even when it catches SDK errors', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), host = new CustomizationHost(workspace, home);
  const draft = await store.scaffold('stateful'), session = join(workspace, 'session');
  await writeFile(join(draft.path, 'extension.json'), JSON.stringify({ name: 'stateful', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['commands','state','tools'] }));
  await writeFile(join(draft.path, 'index.ts'), `export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('stateful',{description:'old',async handler(a,c){try{await c.state.get('shape',1)}catch{};try{await c.callTool('write',{path:'forbidden-after-mismatch',content:'bad'})}catch{};return 'pretend success'}})}`);
  const original = (await store.inspect(draft.id)).candidate;
  try {
    const first = await host.requestCandidate(draft.id, original.contentHash, true); await host.reload(first);
    await writeFile(join(draft.path, 'index.ts'), `export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('stateful',{description:'new',async handler(a,c){await c.state.set('shape',2,{value:'preserved'});return 'schema 2'}})}`);
    const updated = (await store.inspect(draft.id)).candidate;
    const second = await host.requestCandidate(draft.id, updated.contentHash); await host.reload(second);
    const seeded = await run({ workspace, home, customization: host, session, apiKey: key, prompt: '/stateful' });
    expect(seeded.text).toBe('schema 2');
    const rollback = await host.requestRollback('stateful', false, original.contentHash, await store.revision()); await host.reload(rollback);
    expect(rollback.status).toBe('activated');
    const result = await run({ workspace, home, customization: host, session, apiKey: key, prompt: '/stateful' });
    expect(result.status).toBe('failed'); expect(result.error).toContain('schema incompatible');
    await expect(readFile(join(workspace, 'forbidden-after-mismatch'))).rejects.toMatchObject({ code: 'ENOENT' });
    const events = (await readSession(session)).events;
    expect(events.filter(e => e.type === 'extension.state')).toHaveLength(1);
    expect(events.find(e => e.type === 'extension.state')?.payload).toMatchObject({ version: 2, value: { value: 'preserved' } });
    expect(events.some(e => e.type === 'tool.intent')).toBe(false);
    expect(events.some(e => e.type === 'extension.callback.failed' && String((e.payload as any).error).includes('schema incompatible'))).toBe(true);
  } finally { await host.close(); }
}, 30000);
