import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Agent, runToolCall } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { CodemodeSandbox } from '@earendil-works/pi-codemode';
import { Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { McpClient, StdioTransport } from '@earendil-works/pi-mcp';

const root = path.dirname(fileURLToPath(import.meta.url));
const report = { node: process.version, platform: process.platform, arch: process.arch, packages: [], imports: [], checks: [] };
for (const name of ['pi-agent-core', 'pi-ai', 'pi-codemode', 'pi-durable', 'pi-mcp']) {
  const dir = path.join(root, 'node_modules/@earendil-works', name);
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.4');
  const sourceOnly = [], checkedTargets = [];
  for (const [entry, conditions] of Object.entries(pkg.exports)) {
    for (const [condition, target] of Object.entries(typeof conditions === 'string' ? { default: conditions } : conditions)) {
      if (target.includes('*')) continue; // Concrete wildcard consumer entries are tested below.
      if (condition === 'source') { sourceOnly.push({ entry, target }); continue; }
      assert.ok((await stat(path.join(dir, target))).isFile());
      checkedTargets.push({ entry, condition, target });
    }
  }
  report.packages.push({ name: pkg.name, version: pkg.version, engines: pkg.engines, checkedTargets, sourceConditionsNotUsed: sourceOnly });
}
for (const entry of [
  '@earendil-works/pi-ai/api/openai-responses',
  '@earendil-works/pi-ai/utils/event-stream',
  '@earendil-works/pi-ai/models',
  '@earendil-works/pi-durable/env',
  '@earendil-works/pi-durable/env/node',
  '@earendil-works/pi-durable/storage/memory',
  '@earendil-works/pi-durable/storage/jsonl',
  '@earendil-works/pi-durable/storage/jsonl/node',
  '@earendil-works/pi-durable/storage/sqlite/node',
  '@earendil-works/pi-mcp/oauth',
  '@earendil-works/pi-mcp/testing',
  '@earendil-works/pi-codemode/source',
  '@earendil-works/pi-codemode/declarations',
]) {
  const resolved = fileURLToPath(import.meta.resolve(entry));
  assert.ok(resolved.startsWith(root + path.sep));
  await import(entry);
  report.imports.push({ entry, resolved });
}
for (const value of [Agent, runToolCall, createModels, CodemodeSandbox, Harness, MemoryStorage, McpClient, StdioTransport]) assert.equal(typeof value, 'function');
report.checks.push('public exported constructors/functions present');
const wasm = fileURLToPath(import.meta.resolve('quickjs-wasi/quickjs.wasm'));
assert.ok((await stat(wasm)).size > 0);
const sandbox = new CodemodeSandbox({ timeoutMs: 5000, tools: [{ name: 'echo', execute: async args => args }] });
try {
  const result = await sandbox.execute('const v = await tools.echo({ value: 42 }); text(v); return v.value;');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value, 42);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].status, 'ok');
  report.checks.push('published worker + QuickJS WASM execute a host tool and return 42');
} finally { await sandbox.close(); }
console.log(JSON.stringify(report, null, 2));
