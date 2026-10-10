import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpConnection } from '../src/customization/mcp.js';
import { CustomizationHost } from '../src/customization/host.js';
import { mcpToolName } from '../src/customization/mcp-discovery.js';
import type { Resource } from '../src/customization/resources.js';
import { readSession } from '../src/journal.js';
import { readScriptState } from '../src/codemode-state.js';
import { run } from '../src/runtime.js';
import { temporary, key, response, callItem, textItem } from './helpers.js';

it('preserves remote unknown alongside committed local script state without replay after restart', async () => {
  const workspace = await temporary(), home = await temporary(), session = join(workspace, 'session');
  let effects = 0, mainCalls = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const m = JSON.parse(raw);
    if (m.method === 'tools/call') { effects++; res.destroy(); return; }
    if (m.id === undefined) { res.writeHead(202).end(); return; }
    const result = m.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fault', version: '1' } } : { tools: [{ name: 'job', inputSchema: { type: 'object', properties: {} } }] };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await mkdir(join(workspace, '.nekomimi'));
  await writeFile(join(workspace, '.nekomimi/mcp.json'), JSON.stringify({ version: 1, servers: { fault: { transport: 'http', url: `http://127.0.0.1:${(server.address() as any).port}/mcp` } } }));
  const host = new CustomizationHost(workspace, home); let reopened: CustomizationHost | undefined;
  try {
    const resource = (await host.catalog.discover()).find(r => r.kind === 'mcp')!;
    await host.catalog.decide(resource.id, true, true, 0);
    const name = mcpToolName(resource, 'job');
    const result = await run({ workspace, home, session, customization: host, apiKey: key, prompt: 'handle unknown locally', tools: ['codemode', name], fetch: async () => ++mainCalls === 1 ? response([callItem('codemode', { code: `try { await tools.${name}({}); throw Error('expected disconnect'); } catch(e) { if(!String(e).includes('UNKNOWN'))throw e; store('remoteOutcome','unknown'); text('Remote outcome unknown; no retry.'); }` })]) : response([textItem('Recorded unknown.')]) });
    expect(result.status, result.error).toBe('completed');
    const saved = await readSession(session);
    const intent = saved.events.find(e => e.type === 'tool.intent' && (e.payload as any).name === name)!;
    expect(intent).toBeDefined();
    expect(saved.events.find(e => e.type === 'tool.execution_error' && e.toolCallId === intent.toolCallId)?.payload).toMatchObject({ unknown: true });
    expect(saved.events.find(e => e.type === 'mcp.cleanup' && e.toolCallId === intent.toolCallId)?.payload).toMatchObject({ server: resource.id, scope: 'connection', status: 'completed' });
    expect(saved.events.find(e => e.type === 'codemode.finished')?.payload).toMatchObject({ status: 'completed' });
    expect((await readScriptState(result.session, saved.events)).state).toEqual({ remoteOutcome: 'unknown' });
    await host.close(); reopened = new CustomizationHost(workspace, home);
    await reopened.acquire(); await reopened.release();
    const resumed = await run({ workspace, home, session, customization: reopened, apiKey: key, prompt: 'read saved state only', tools: [], fetch: async () => response([textItem('No replay.')]) });
    expect(resumed.status, resumed.error).toBe('completed');
    expect(effects).toBe(1);
    const final = await readSession(session);
    expect(final.events.filter(e => e.type === 'tool.intent' && (e.payload as any).name === name)).toHaveLength(1);
    expect((await readScriptState(result.session, final.events)).state).toEqual({ remoteOutcome: 'unknown' });
  } finally { await host.close(); await reopened?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 30000);

it.skipIf(process.platform === 'win32')('verifies forced cleanup of a stdio process that ignores SIGTERM', async () => {
  const workspace = await temporary();
  await writeFile(join(workspace, 'server.mjs'), `import readline from 'node:readline'; import {appendFileSync} from 'node:fs'; process.on('SIGTERM',()=>appendFileSync('signals','TERM\\n')); setInterval(()=>{},1000); readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return; const result=m.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'stubborn',version:'1'}}:{tools:[]}; console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`);
  const connection = new McpConnection({ id: 'mcp:stubborn', name: 'stubborn', config: { transport: 'stdio', command: process.execPath, args: ['server.mjs'] } } as Resource, workspace);
  try {
    await connection.connect(); const closing = connection.close();
    expect(connection.catalog().cleanup?.status).toBe('pending');
    await closing;
    const cleanup = connection.catalog().cleanup!;
    expect(cleanup).toMatchObject({ platform: process.platform, scope: 'process-group', status: 'completed' });
    expect(await readFile(join(workspace, 'signals'), 'utf8')).toContain('TERM');
    expect(() => process.kill(-cleanup.pid!, 0)).toThrow();
    await connection.close(); expect(connection.catalog().cleanup).toEqual(cleanup);
  } finally { await connection.close(); }
}, 15000);

it('retains unknown and failed cleanup independently and does not later claim success', async () => {
  const connection = new McpConnection({ id: 'mcp:failure', name: 'failure', config: { transport: 'http', url: 'http://127.0.0.1/mcp' } } as Resource, await temporary());
  connection.tools = [{ name: 'job', inputSchema: { type: 'object' } }];
  vi.spyOn(connection.client, 'callTool').mockRejectedValue(new Error('socket lost'));
  vi.spyOn(connection.client, 'close').mockRejectedValue(new Error('synthetic cleanup failure'));
  await expect(connection.call('job', {}, new AbortController().signal)).rejects.toThrow(/UNKNOWN.*socket lost.*cleanup failed/);
  expect(connection.catalog().cleanup).toMatchObject({ status: 'failed', error: expect.stringContaining('synthetic cleanup failure') });
  await expect(connection.close()).rejects.toThrow('cleanup failed');
  expect(connection.client.close).toHaveBeenCalledTimes(1);
});
