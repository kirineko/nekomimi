import { expect, it } from 'vitest';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { SDK_VERSION, CAPABILITIES, SDK_MODES, SDK_PROTOCOLS } from '../src/extensions.js';
import { sdkCatalog } from '../src/customization/sdk.js';
import { checkTypes } from '../src/customization/validation.js';
import { CustomizationHost } from '../src/customization/host.js';
import type { Resource } from '../src/customization/resources.js';
import { temporary } from './helpers.js';

it('publishes consistent immutable supported modes and protocols without implying grants', async () => {
  const catalog = await sdkCatalog();
  expect(catalog.supportedSdkVersions).toEqual([SDK_VERSION]);
  expect(catalog.availableCapabilities).toEqual(CAPABILITIES);
  expect(catalog.modes).toEqual(SDK_MODES);
  expect(catalog.protocols).toEqual(SDK_PROTOCOLS);
  expect(catalog.capabilityStatus).toBe('supported_not_granted');
  expect(catalog.capabilityPolicy).toHaveProperty('executable');
  expect(Object.isFrozen(CAPABILITIES)).toBe(true);
  expect(Object.isFrozen(SDK_PROTOCOLS.chat)).toBe(true);
  const full = await sdkCatalog('public');
  expect('sections' in full && full.sections?.some(s => s.entry === 'capabilities' && s.text.includes('SDK_MODES'))).toBe(true);
});

it('type checks every shipped TypeScript example without executing module bodies', async () => {
  const root = resolve('extension-docs'), files: Record<string, string> = {};
  const walk = async (dir: string, prefix = ''): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name), prefix + entry.name + '/');
      else if (entry.name.endsWith('.ts')) files[prefix + entry.name] = await readFile(join(dir, entry.name), 'utf8');
    }
  };
  await walk(root);
  expect(Object.keys(files)).toEqual(expect.arrayContaining(['example.ts', 'http-providers.ts', 'review-workflow.ts', 'panel-extension.ts', 'examples/sakura/index.ts']));
  const result = checkTypes({ id: 'sdk:all-examples', root, files, manifest: { name: 'examples', sdkVersion: 3, entry: 'example.ts' } } as Resource);
  expect(result.diagnostics).toEqual([]);
  expect(result.verification).toMatchObject({ stage: 'static', status: 'passed', hostIntegration: 'not_run', environment: { node: process.version, sdkHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
}, 30000);

it('keeps the public SDK type dependency graph free of Pi and runtime implementation types', () => {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, types: ['node'], noEmit: true };
  const program = ts.createProgram([resolve('src/extensions.ts')], options);
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  const sources = program.getSourceFiles().map(f => f.fileName.replaceAll('\\', '/'));
  expect(sources.some(path => path.includes('/@earendil-works/'))).toBe(false);
  expect(sources.some(path => /\/src\/(pi|runtime|journal|provider)\b/.test(path))).toBe(false);
});

it('rejects a future capability before importing even a top-level side effect', async () => {
  const workspace = await temporary(), home = await temporary(), root = join(workspace, '.nekomimi/extensions/future');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'future', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['future-power'] }));
  await writeFile(join(root, 'index.ts'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(workspace, 'executed'))}, 'bad'); export default ()=>{};`);
  const host = new CustomizationHost(workspace, home);
  try {
    const resource = (await host.catalog.discover()).find(r => r.kind === 'extension')!;
    expect(resource.error).toContain('future-power');
    await expect(host.catalog.decide(resource.id, true, true, 0)).rejects.toThrow('Unsupported capabilities');
    await expect(host.acquire()).rejects.toThrow('Unsupported capabilities');
    await expect(readFile(join(workspace, 'executed'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(home)).toEqual([]);
  } finally { await host.close(); }
});
