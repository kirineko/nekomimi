import { tmpdir } from "node:os";
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const dir = await mkdtemp(join(tmpdir(), "harness-pack-"));
function invoke(cmd, args, cwd = dir) {
  console.log(`pack-smoke: ${cmd === 'npm' ? 'npm ' + args[0] : cmd.split(/[\\/]/).at(-1)} ${args.includes('--global') ? '(global)' : ''}`);
  const timeout = cmd === 'npm' && args[0] === 'install' ? 600000 : 120000;
  if (cmd === 'npm' && process.platform === 'win32') {
    args = [process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args];
    cmd = process.execPath;
  }
  return execFileSync(cmd, args, {
    cwd, encoding: 'utf8', env: process.env, timeout,
    windowsVerbatimArguments: process.platform === 'win32' && /(?:^|[\\/])cmd\.exe$/i.test(cmd),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const packed = process.argv[2] ? { filename: resolve(process.argv[2]) } : JSON.parse(invoke('npm', ['pack', '--json', '--pack-destination', dir], process.cwd()))[0];
const archive = resolve(dir, packed.filename);
const listing = invoke('tar', ['-tzf', archive]).trim().split(/\r?\n/);
if (listing.some(p => !/^package\/(dist\/|README.md$|LICENSE$|package.json$)/.test(p))) throw new Error('Unexpected file in release archive');
if (listing.some(p => /^package\/dist\/web-fetch(?:[/.])/.test(p))) throw new Error('Retired web fetch resources in release archive');
if (!listing.includes('package/dist/cli.js') || !listing.includes('package/dist/web-dist/index.html')) throw new Error('Missing release resources');
if (!listing.includes('package/dist/presentation/syntax/node-worker.js') || !listing.some(p => /web-dist\/assets\/syntax-worker-.*\.js$/.test(p))) throw new Error('Missing syntax workers');
await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
invoke('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', archive]);
const prefix = join(dir, 'global');
invoke('npm', ['install', '--global', '--registry=https://registry.npmjs.org', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', archive]);
const cli = process.platform === 'win32' ? join(prefix, 'node_modules/nekomimi/dist/cli.js') : join(prefix, 'bin/nekomimi');
const runCli = (args) => process.platform === 'win32' ? invoke(process.execPath, [cli, ...args]) : invoke(cli, args);
if (process.platform === 'win32') {
  const shim = join(prefix, 'nekomimi.cmd');
  const help = invoke(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${shim}" --help"`]);
  if (!help.includes('Nekomimi')) throw new Error('Invalid Windows npm shim');
}
if (!runCli(['--help']).includes('Nekomimi')) throw new Error('Missing CLI');
console.log(invoke(process.execPath, [fileURLToPath(new URL('./global-web-smoke.mjs', import.meta.url)), cli, dir]).trim());
await writeFile(join(dir, 'smoke.mjs'), `import {Journal, exportSession, inspectBundle, importBundle} from 'nekomimi'; import {nodeSyntax} from './node_modules/nekomimi/dist/presentation/syntax/node.js'; const tokens=await nodeSyntax.run('const ready = true;', 'ts'); if(!tokens?.flat().some(t=>t.className)) throw Error('Installed syntax worker failed'); nodeSyntax.dispose(); const j=await Journal.open('./session'); await j.append('fixture',{artifact:await j.artifact('offline pack fixture')}); await j.close(); await exportSession('./session',{format:'html',output:'./view.html'}); await exportSession('./session',{format:'bundle',output:'./bundle'}); await inspectBundle('./bundle'); await importBundle('./bundle','./imported');`);
invoke(process.execPath, ['smoke.mjs']);
JSON.parse(runCli(['replay', join(dir, 'imported')]));
await writeFile(join(dir, 'web-smoke.mjs'), await readFile(new URL('./pack-web-fixture.mjs', import.meta.url)));
invoke(process.execPath, ['web-smoke.mjs']);
console.log(JSON.stringify({ directory: dir, tarball: packed.filename, installed: true, cli: true, offlineExportImport: true, webStaticCommandExport: true }));
