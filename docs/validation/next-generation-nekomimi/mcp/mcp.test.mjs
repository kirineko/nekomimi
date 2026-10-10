import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpClient, StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import { OAuthCallbackServer, startAuthorization, exchangeAuthorizationCode, refreshAuthorization, discoverAuthorizationServerMetadata, McpOAuthProvider, MemoryOAuthStateStore } from '@earendil-works/pi-mcp/oauth';
import { handle } from './fixture.mjs';

async function serve(handler) {
  const server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(e => { res.statusCode = 500; res.end(String(e)); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
for (const transportKind of ['stdio', 'http']) test(`${transportKind}: tools/resources/templates/prompts/subscription/cancel/error`, { timeout: 10000 }, async () => {
  let server; const seen = []; let stderr = '';
  const client = new McpClient({ name: 'probe', version: '1', requestTimeoutMs: 1500 });
  let transport;
  if (transportKind === 'stdio') transport = new StdioTransport({ command: process.execPath, args: [fileURLToPath(new URL('./fixture.mjs', import.meta.url)), '--stdio'], inheritEnv: false, onStderr: text => { stderr += text; }, closeTimeoutMs: 200 });
  else {
    server = await serve(async (req, res) => {
      if (req.method !== 'POST') { res.statusCode = req.method === 'DELETE' ? 200 : 405; res.end(); return; }
      let body = ''; for await (const b of req) body += b; const m = JSON.parse(body); seen.push({ method: m.method, name: m.params?.name }); const r = handle(m);
      if (r.drop) { res.destroy(); return; } if (r.hang) return;
      if (m.id === undefined) { res.statusCode = 202; res.end(); return; }
      if (m.method === 'initialize') res.setHeader('mcp-session-id', 'fixture-session');
      const response = { jsonrpc: '2.0', id: m.id, ...(r.error ? { error: r.error } : { result: r.result }) };
      if (r.notification) { res.setHeader('content-type', 'text/event-stream'); res.end(`data: ${JSON.stringify(r.notification)}\n\ndata: ${JSON.stringify(response)}\n\n`); }
      else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response)); }
    });
    transport = new StreamableHttpTransport({ url: server.url + '/mcp', openGetStream: false });
  }
  try {
    const init = await client.connect(transport); assert.equal(init.serverInfo.name, 'fixture');
    assert.deepEqual((await client.listTools()).map(t => t.name), ['echo', 'second']);
    const result = await client.callTool('echo', { x: 1 }); assert.deepEqual(result.structuredContent, { received: { x: 1 } });
    assert.equal((await client.callTool('error', {})).isError, true);
    assert.equal((await client.listResources()).length, 2); assert.equal((await client.listResourceTemplates()).length, 2);
    assert.equal((await client.readResource('fixture://first/one')).contents[0].text, 'resource-body');
    assert.equal((await client.request('prompts/list')).prompts[0].name, 'review');
    const prompt = await client.request('prompts/get', { name: 'review', arguments: { target: 'file.ts' } }); assert.equal(prompt.messages[0].role, 'user'); assert.equal(prompt.messages[0].content.text, 'review file.ts');
    let notice; const unsubscribe = client.onNotification('notifications/resources/updated', params => { notice = params; });
    await client.request('resources/subscribe', { uri: 'fixture://first' }); assert.equal(notice.uri, 'fixture://first');
    await client.request('resources/unsubscribe', { uri: 'fixture://first' }); unsubscribe();
    await assert.rejects(client.request('unsupported'), e => e.code === -32601);
    const controller = new AbortController(); const pending = client.callTool('hang', {}, { signal: controller.signal }); const rejected = assert.rejects(pending); controller.abort(); await rejected;
    if (transportKind === 'http') { const before = seen.filter(m => m.method === 'tools/call' && m.name === 'drop').length; await assert.rejects(client.callTool('drop', {})); assert.equal(seen.filter(m => m.method === 'tools/call' && m.name === 'drop').length, before + 1, 'dropped POST must not replay'); }
    else assert.match(stderr, /fixture-stderr-only/);
  } finally { await client.close(); await server?.close(); }
});
test('OAuth callback binds state and PKCE/token exchange/refresh use loopback fixture', { timeout: 10000 }, async () => {
  const callback = await OAuthCallbackServer.listen({ timeoutMs: 3000 }); let expectedChallenge; let refreshes = 0; let server;
  try {
    server = await serve(async (req, res) => {
      let raw = ''; for await (const b of req) raw += b; const p = new URLSearchParams(raw);
      if (p.get('grant_type') === 'authorization_code') assert.equal(createHash('sha256').update(p.get('code_verifier')).digest('base64url'), expectedChallenge);
      else { assert.equal(p.get('grant_type'), 'refresh_token'); refreshes++; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ access_token: 'fixture-access', token_type: 'Bearer', refresh_token: refreshes ? 'fixture-rotated' : 'fixture-refresh', expires_in: 60 }));
    });
    const metadata = { issuer: server.url, authorization_endpoint: server.url + '/authorize', token_endpoint: server.url + '/token', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] };
    const clientInformation = { client_id: 'fixture-client', token_endpoint_auth_method: 'none' };
    const started = await startAuthorization(server.url, { metadata, clientInformation, redirectUrl: callback.redirectUrl, state: 'expected-state' });
    assert.equal(started.authorizationUrl.searchParams.get('code_challenge_method'), 'S256'); expectedChallenge = started.authorizationUrl.searchParams.get('code_challenge');
    const pending = callback.waitForCallback('expected-state');
    const bad = await fetch(callback.redirectUrl + '?code=fake&state=wrong-state'); assert.ok(bad.status >= 400);
    await fetch(callback.redirectUrl + '?code=fixture-code&state=expected-state'); const received = await pending; assert.equal(received.code, 'fixture-code');
    const tokens = await exchangeAuthorizationCode(server.url, { metadata, clientInformation, code: received.code, codeVerifier: started.codeVerifier, redirectUrl: callback.redirectUrl });
    const refreshed = await refreshAuthorization(server.url, { metadata, clientInformation, refreshToken: tokens.refresh_token }); assert.equal(refreshed.refresh_token, 'fixture-rotated'); assert.equal(refreshes, 1);
  } finally { await callback.close(); await server?.close(); }
});
test('OAuth issuer mismatch is rejected and separate stores isolate same URL accounts', async () => {
  let server; server = await serve((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ issuer: 'https://wrong.example', authorization_endpoint: 'https://wrong.example/authorize', token_endpoint: 'https://wrong.example/token', response_types_supported: ['code'] })); });
  try {
    await assert.rejects(discoverAuthorizationServerMetadata(server.url), /issuer/i);
    const make = store => new McpOAuthProvider({ serverUrl: server.url + '/mcp', redirectUrl: 'http://127.0.0.1/callback', clientMetadata: { client_name: 'fixture' }, store, onRedirect: () => {} });
    const a = make(new MemoryOAuthStateStore()), b = make(new MemoryOAuthStateStore()); await a.saveTokens({ access_token: 'fixture-A', token_type: 'Bearer' }); assert.equal(await b.tokens(), undefined);
    await b.saveTokens({ access_token: 'fixture-B', token_type: 'Bearer' }); assert.equal((await a.tokens()).access_token, 'fixture-A');
  } finally { await server.close(); }
});
