// Copied into an isolated tarball installation by pack-smoke. No checkout imports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, access, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { run, readSession } from 'nekomimi';
import { CustomizationHost } from './node_modules/nekomimi/dist/customization/host.js';
import { sdkCatalog } from './node_modules/nekomimi/dist/customization/sdk.js';
import { createSessionBinding } from './node_modules/nekomimi/dist/session/identity.js';

const installed = resolve('node_modules/nekomimi');
await assert.rejects(access(join(installed, 'src')));
const workspace = resolve('guide-development'), home = resolve('guide-home'), owner = resolve('guide-owner');
for (const directory of [workspace, home, owner]) await mkdir(directory);
const cli = (...args) => execFileSync(process.execPath, [join(installed, 'dist/cli.js'), ...args, '--workspace', workspace, '--home', home], { encoding: 'utf8', timeout: 60000 });
const json = (...args) => JSON.parse(cli(...args));
const catalog = json('candidates', 'sdk');
assert.deepEqual(catalog.supportedSdkVersions, [3]);
assert.equal(catalog.host.requiresBuild, false);
assert.equal(await realpath(catalog.host.entry), await realpath(join(installed, 'dist/cli.js')));
for (const guide of catalog.guides) {
  const document = json('candidates', 'sdk', guide.entry);
  assert.equal(document.hash, createHash('sha256').update(document.text).digest('hex'));
  assert.equal(document.host.build, catalog.host.build);
}
const binding = await createSessionBinding(owner, randomUUID(), { commandId: randomUUID(), mode: 'create', target: { kind: 'extension', root: workspace } }, 'a'.repeat(64), home);
assert.equal((await sdkCatalog('guide:cli.md', workspace, home, binding.target)).target.host.build, catalog.host.build);
await assert.rejects(sdkCatalog('public', workspace, home, { ...binding.target, host: { ...binding.target.host, build: '0'.repeat(64) } }), /宿主不匹配/);

const command = json('candidates', 'create', 'offline-review', 'command');
const checked = json('candidates', 'inspect', command.id);
assert.equal(checked.report.passed, true);
const trial = json('candidates', 'trial', command.id, checked.contentHash, '/offline-review');
assert.equal(trial.verification.status, 'passed');
assert.equal(trial.verification.hostIntegration, 'not_run');
assert.equal(json('candidates', 'activate', command.id, checked.contentHash).status, 'activated');
const theme = json('candidates', 'create', 'offline-style', 'theme');
const themeChecked = json('candidates', 'inspect', theme.id);
assert.equal(themeChecked.report.passed, true);
assert.equal(json('candidates', 'activate', theme.id, themeChecked.contentHash).status, 'activated');

const { writeFile } = await import('node:fs/promises');
// Exercise the documented complete example's manifest as well as its types.
const example = json('candidates', 'create', 'offline-example', 'command');
const manifestText = json('candidates', 'sdk', 'guide:extensions.md').text.match(/清单：`([^`]+)`/)[1];
const manifest = { ...JSON.parse(manifestText), name: 'offline-example' };
await writeFile(join(example.path, 'extension.json'), JSON.stringify(manifest));
await writeFile(join(example.path, 'index.ts'), json('candidates', 'sdk', 'guide:example.ts').text);
const exampleChecked = json('candidates', 'inspect', example.id);
assert.equal(exampleChecked.report.passed, true);
assert.equal(json('candidates', 'activate', example.id, exampleChecked.contentHash).status, 'activated');
const skillText = json('candidates', 'sdk', 'guide:examples/review-checklist/SKILL.md').text;
const skillRoot = join(workspace, '.agents/skills/review-checklist');
await mkdir(skillRoot, { recursive: true });
await writeFile(join(skillRoot, 'SKILL.md'), skillText);
const host = new CustomizationHost(workspace, home);
try {
  const skill = (await host.catalog.discover()).find(resource => resource.kind === 'skill' && resource.name === 'review-checklist');
  assert.ok(skill);
  cli('extensions', 'enable', skill.id);
  const commandRun = await run({ workspace, home, customization: host, session: resolve('guide-command-session'), apiKey: 'unused', prompt: '/offline-review', fetch: async () => { throw Error('Unexpected network call'); } });
  assert.equal(commandRun.status, 'completed');
  assert.equal(commandRun.text, 'Ready');
  assert.equal(host.commands('work').commands.some(command => command.name === '/skill:review-checklist'), true);
  const loadedTheme = (await host.themes.catalog()).find(theme => theme.id === 'offline-style');
  assert.ok(loadedTheme);
  assert.equal((await host.themes.describe()).active, undefined);
  await host.themes.select('project', { resourceId: loadedTheme.resourceId, revision: loadedTheme.revision, id: loadedTheme.id }, 0);
  assert.equal((await host.themes.describe()).active.id, 'offline-style');
  const events = (await readSession(commandRun.session)).events;
  assert.equal(events.some(event => event.type === 'attempt.started'), false);
  assert.equal((await readFile(join(skillRoot, 'SKILL.md'), 'utf8')), skillText);
} finally { await host.close(); }
console.log(JSON.stringify({ fixture: 'installed-sdk-guides', node: process.version, hostBuild: catalog.host.build, checkout: false, realModelCalls: 0, command: true, skill: true, themeLoadedAndSelected: true, browserVisualAcceptance: 'not_run', staleTargetRejected: true }));
