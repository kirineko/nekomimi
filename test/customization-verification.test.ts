import { expect, it } from 'vitest';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { Candidates } from '../src/customization/candidates.js';
import { CustomizationHost } from '../src/customization/host.js';
import { trialCandidate, trialExtension } from '../src/customization/trial.js';
import { Journal, readSession } from '../src/journal.js';
import { run } from '../src/runtime.js';
import { startWeb } from '../src/server/app.js';
import { temporary, key } from './helpers.js';

it('records cancelled simulation against its exact environment and preserves the working version', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), host = new CustomizationHost(workspace, home);
  const draft = await store.scaffold('stable'), initial = await store.inspect(draft.id);
  const controller = new AbortController();
  try {
    const receipt = await host.requestCandidate(draft.id, initial.candidate.contentHash, true); await host.reload(receipt);
    expect(receipt.status).toBe('activated');
    const active = host.active, pointer = await store.active();
    await writeFile(join(draft.path, 'index.ts'), `import {writeFileSync} from 'node:fs';export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('stable',{description:'loop',async handler(){writeFileSync('trial-started','yes');while(true){} }})}`);
    const candidate = (await store.inspect(draft.id)).candidate;
    const pending = trialCandidate(workspace, home, draft.id, candidate.contentHash, '/stable', false, { signal: controller.signal }).catch(error => error);
    await Promise.race([expect.poll(() => readFile(join(workspace, 'trial-started'), 'utf8').catch(() => ''), { timeout: 8000 }).toBe('yes'), pending.then(value => { throw new Error('Trial settled before marker: ' + String(value)); })]);
    controller.abort(new Error('cancel verification'));
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.verification).toMatchObject({ stage: 'simulation', status: 'cancelled', hostIntegration: 'not_run', resourceRevision: candidate.contentHash, environment: { node: process.version, platform: process.platform, arch: process.arch, hostBuild: expect.any(String) } });
    expect((await readSession(error.session)).events.find(e => e.type === 'trial.finished')?.payload).toMatchObject({ simulated: true, verification: { status: 'cancelled' } });
    expect(await store.active()).toEqual(pointer); expect(host.active).toBe(active);
    const result = await run({ workspace, home, customization: host, session: join(workspace, 'old-command'), apiKey: key, prompt: '/stable old-version' });
    expect(result.text).toBe('old-version');
    const regular = await trialExtension(workspace, home, initial.resource.id, '/stable simulated');
    expect(regular.verification).toMatchObject({ resourceRevision: initial.resource.hash, status: 'passed', stage: 'simulation', hostIntegration: 'not_run' });
    const evidence = await host.lifecycle.evidence();
    expect(evidence.some(e => e.stage === 'simulation' && e.status === 'cancelled' && e.revision === candidate.contentHash)).toBe(true);
    expect(evidence.some(e => e.stage === 'host' && e.passed)).toBe(false);
  } finally { controller.abort(); await host.close(); }
}, 30000);

it('keeps verification from another Node environment in historical evidence', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), host = new CustomizationHost(workspace, home);
  const draft = await store.scaffold('environment'), { resource } = await store.inspect(draft.id);
  const recorded = await host.lifecycle.record(resource, 'static', { passed: true });
  const journal = await Journal.open(join(workspace, '.nekomimi/lifecycle-journal'));
  await journal.append('customization.lifecycle', { ...recorded, environment: { ...recorded.environment, node: 'v0.0.0' } }); await journal.close();
  const ability = (await host.lifecycle.catalog()).find(item => item.resourceId === resource.id)!;
  expect(ability.evidence).toHaveLength(1);
  expect(ability.previousEvidence).toEqual([expect.objectContaining({ environment: expect.objectContaining({ node: 'v0.0.0' }) })]);
  await host.close();
});

it('records theme mounting as observation rather than complete host acceptance', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace);
  const draft = await store.scaffold('observed', 'theme'), checked = await store.inspect(draft.id);
  const app = await startWeb({ workspace, home, apiKey: key, naming: false });
  try {
    const host = app.sessions.customization;
    const receipt = await host.requestCandidate(draft.id, checked.candidate.contentHash, true); await host.reload(receipt);
    expect(receipt.status).toBe('activated');
    await host.themes.select('project', { resourceId: checked.resource.id, revision: checked.resource.hash, id: 'observed' }, 0);
    const response = await fetch(app.origin + '/api/v1/customization', { method: 'POST', headers: { authorization: `Bearer ${app.token}`, origin: app.origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'theme-verify', resourceId: checked.resource.id, contentHash: checked.resource.hash, id: 'observed' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'observed', hostIntegration: 'observed' });
    const evidence = (await host.lifecycle.evidence()).filter(e => e.stage === 'host');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ status: 'observed', check: 'theme-stylesheet-mounted', verification: { status: 'observed', resourceRevision: checked.resource.hash } });
    expect(evidence[0]?.passed).toBeUndefined();
  } finally { await app.close(); }
}, 30000);
