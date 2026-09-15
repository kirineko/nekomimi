import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readSession } from '../src/journal.js';
import { temporary, key } from './helpers.js';
it('CLI SIGINT ends a blocked HTTP request with a durable cancelled run', async () => {
  const dir = await temporary(); let arrived!: () => void;
  const requested = new Promise<void>(r => { arrived = r; });
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); arrived(); });
  await new Promise<void>((r, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', r); });
  const address = server.address() as { port: number };
  const child = spawn(process.execPath, [resolve('dist/cli.js'), 'run', 'synthetic', '--workspace', dir, '--session', join(dir, 's'), '--base-url', `http://127.0.0.1:${address.port}`, '--json'], { env: { ...process.env, DEEPSEEK_API_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  let output = ''; child.stdout.on('data', data => { output += data; });
  const exited = new Promise<number | null>((r, reject) => { child.on('error', reject); child.on('close', r); });
  try {
    await Promise.race([requested, exited.then(code => { throw new Error(`CLI exited ${code}: ${stderr}`); })]); child.kill('SIGINT');
    expect(await exited).toBe(130); expect(JSON.parse(output).status).toBe('cancelled');
    expect((await readSession(join(dir, 's'))).events.at(-1)?.payload).toMatchObject({ status: 'cancelled' });
  } finally { child.kill('SIGKILL'); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

it('web CLI starts a local service and exits cleanly on SIGINT', async () => {
  const dir = await temporary();
  const child = spawn(process.execPath, [resolve('dist/cli.js'), 'web', '--workspace', dir], { env: { ...process.env, DEEPSEEK_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  let output = '';
  const started = new Promise<string>(resolve => child.stdout.on('data', bytes => { output += bytes; const match = output.match(/Web: (http:\/\/[^\s]+)/); if (match) resolve(match[1]!); }));
  try {
    const url = await Promise.race([started, exited.then(code => { throw new Error(`web exited early: ${code}`); })]);
    expect(new URL(url).hostname).toBe('127.0.0.1'); expect((await fetch(url)).status).toBe(200);
    child.kill('SIGINT'); expect(await exited).toBe(0);
  } finally { child.kill('SIGKILL'); }
});
