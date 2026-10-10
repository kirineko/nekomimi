import { expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Candidates } from '../src/customization/candidates.js';
import { CustomizationHost } from '../src/customization/host.js';
import { trialCandidate } from '../src/customization/trial.js';
import { ExtensionProcess } from '../src/customization/process.js';
import { readSession } from '../src/journal.js';
import { temporary } from './helpers.js';

for (const stage of ['simulation', 'preview'] as const) {
  it(`cancels an actually stuck ${stage} factory during initialization before reporting a terminal`, async () => {
    const workspace = await temporary(), home = await temporary(), marker = join(workspace, 'factory-pid');
    const store = new Candidates(workspace), candidate = await store.scaffold('stuck', stage === 'preview' ? 'panel' : 'command');
    await writeFile(join(candidate.path, 'index.ts'), `import {writeFileSync} from 'node:fs'; export default () => {writeFileSync(${JSON.stringify(marker)},String(process.pid));while(true){}};`);
    const resource = await store.read(candidate.id), controller = new AbortController(), host = new CustomizationHost(workspace, home);
    const pending = (stage === 'preview'
      ? host.panels.previewCandidate(candidate.id, resource.hash, undefined, {}, true, controller.signal)
      : trialCandidate(workspace, home, candidate.id, resource.hash, '/stuck', true, { signal: controller.signal }))
      .then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      await expect.poll(() => readFile(marker, 'utf8').catch(() => ''), { timeout: 15000 }).not.toBe('');
      const pid = Number(await readFile(marker, 'utf8')); expect(pid).not.toBe(process.pid);
      controller.abort(new Error('explicit cancellation'));
      const result = await pending;
      expect(result.value).toBeUndefined(); expect(result.error).toMatchObject({ verification: { stage, status: 'cancelled', hostIntegration: 'not_run' } });
      expect(() => process.kill(pid, 0)).toThrow();
      expect((await host.lifecycle.evidence()).at(-1)).toMatchObject({ stage, status: 'cancelled', passed: false });
      expect(await store.active()).toEqual([]);
    } finally { controller.abort(); await pending; await host.close(); }
  }, 20000);
}
it('does not prepare or dispatch a panel preview that was cancelled before acceptance', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), candidate = await store.scaffold('idle', 'panel');
  const host = new CustomizationHost(workspace, home), controller = new AbortController(); controller.abort();
  try {
    await expect(host.panels.previewCandidate(candidate.id, (await store.read(candidate.id)).hash, undefined, {}, true, controller.signal)).rejects.toThrow();
    await expect(readSession(join(workspace, '.nekomimi/panel-history'))).rejects.toThrow();
    expect(await host.lifecycle.evidence()).toEqual([]);
  } finally { await host.close(); }
});
it('records unknown instead of cancelled or failed when simulation cleanup acknowledgement is lost', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), candidate = await store.scaffold('cleanup');
  const original = CustomizationHost.prototype.close;
  const close = vi.spyOn(CustomizationHost.prototype, 'close').mockImplementation(async function (this: CustomizationHost) { await original.call(this); throw Error('cleanup acknowledgement lost'); });
  try {
    await expect(trialCandidate(workspace, home, candidate.id, (await store.read(candidate.id)).hash, '/cleanup', true)).rejects.toMatchObject({ verification: { status: 'unknown', hostIntegration: 'not_run' } });
    const host = new CustomizationHost(workspace, home);
    expect((await host.lifecycle.evidence()).at(-1)).toMatchObject({ status: 'unknown', passed: false });
  } finally { close.mockRestore(); }
});
it('revokes an already built preview frame when process cleanup cannot be acknowledged', async () => {
  const workspace = await temporary(), home = await temporary(), store = new Candidates(workspace), candidate = await store.scaffold('cleanup-panel', 'panel');
  const host = new CustomizationHost(workspace, home), original = ExtensionProcess.prototype.stop;
  const stop = vi.spyOn(ExtensionProcess.prototype, 'stop').mockImplementation(async function (this: ExtensionProcess) { await original.call(this); throw Error('process cleanup acknowledgement lost'); });
  try {
    await expect(host.panels.previewCandidate(candidate.id, (await store.read(candidate.id)).hash, undefined, {}, true)).rejects.toMatchObject({ verification: { status: 'unknown', stage: 'preview' } });
    const history = await readSession(join(workspace, '.nekomimi/panel-history'));
    const mounted = history.events.find(event => event.type === 'panel.mounted')?.payload as { instanceId: string };
    expect(mounted).toBeTruthy();
    await expect(host.panels.document(mounted.instanceId)).rejects.toThrow('expired');
    expect((await host.lifecycle.evidence()).at(-1)).toMatchObject({ status: 'unknown', passed: false });
  } finally { stop.mockRestore(); await host.close(); }
});
