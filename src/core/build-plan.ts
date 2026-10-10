import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hash } from '../journal.js';
import { CoreCandidates } from './candidates.js';
import { coreTreeManifest } from './manifest.js';
import { DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from '../shared/versions.js';
import { API_VERSION } from '../shared/protocol.js';

export interface CoreToolchain {
  node: { path: string; version: string; hash: string };
  npm: { path: string; version: string; revision: string };
  platform: string;
  arch: string;
  path: string;
}
export async function coreToolchain(): Promise<CoreToolchain> {
  const node = await realpath(process.execPath);
  // Resolve the npm shipped alongside this Node, never a project-local executable.
  for (const root of [join(dirname(node), '../lib/node_modules/npm'), join(dirname(node), 'node_modules/npm')]) {
    try {
      const canonical = await realpath(root), manifest = JSON.parse(await readFile(join(canonical, 'package.json'), 'utf8'));
      if (manifest.name !== 'npm' || typeof manifest.version !== 'string') continue;
      const path = await realpath(join(canonical, 'bin/npm-cli.js'));
      const npm = await coreTreeManifest(canonical);
      return { node: { path: node, version: process.version, hash: hash(await readFile(node)) }, npm: { path, version: manifest.version, revision: npm.revision }, platform: process.platform, arch: process.arch, path: dirname(node) + ':' + (process.env.PATH ?? '') };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw Error('A matching npm installation beside the current Node is required for core builds');
}
export async function coreBuildPlan(candidates: CoreCandidates, candidateId: string) {
  const inspected = await candidates.inspect(candidateId);
  if (!inspected.hostMatches) throw Error('Core target host changed; select a new candidate');
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('Trusted core build process cleanup is not supported on this platform');
  const toolchain = await coreToolchain();
  const input = {
    version: 1 as const, candidateId, sourceRevision: inspected.current.revision,
    baselineRevision: inspected.candidate.source.revision, lockHash: inspected.current.lockHash,
    targetHost: inspected.candidate.targetHost, toolchain,
    commands: [{ executable: toolchain.node.path, args: [toolchain.npm.path, 'ci', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'] },
      { executable: toolchain.node.path, args: [toolchain.npm.path, 'run', 'build'] }],
    buildScript: inspected.current.buildCommand,
    expectedContracts: { api: API_VERSION, sdk: SDK_CONTRACT_VERSION, data: DATA_FORMAT_VERSION },
    policy: { version: 1, environment: 'isolated-home-no-inherited-credentials', timeoutMs: 15 * 60 * 1000, logBytes: 8 * 1024 * 1024, stopGraceMs: 1000, stopDeadlineMs: 5000 },
  };
  return { ...input, inputHash: hash(JSON.stringify(input)), stage: 'static' as const, executesScripts: false as const,
    requiresAuthorization: 'trusted-build-including-dependency-and-package-lifecycle-scripts' as const };
}
