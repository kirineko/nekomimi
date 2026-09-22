import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { transform, version as esbuildVersion } from 'esbuild';
import { startAuthorization, exchangeAuthorization, refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { stream } from '@earendil-works/pi-ai/api/openai-responses';
import { readFile } from 'node:fs/promises';
const dependencies = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).dependencies;
const compiled = await transform('const Component = (props: {text:string}) => <div>{props.text}</div>;', { loader: 'tsx', jsx: 'automatic', target: 'es2022' });
assert.match(compiled.code, /jsx-runtime/);
assert.equal(typeof stream, 'function');
const metadata = {
  issuer: 'https://auth.fixture.invalid', authorization_endpoint: 'https://auth.fixture.invalid/authorize', token_endpoint: 'https://auth.fixture.invalid/token',
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
};
const clientInformation = { client_id: 'fixture-client' };
const resource = new URL('https://mcp.fixture.invalid/mcp');
const { authorizationUrl, codeVerifier } = await startAuthorization(metadata.issuer, { metadata, clientInformation, redirectUrl: 'http://127.0.0.1:9876/callback', state: 'fixture-state', resource });
assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorizationUrl.searchParams.get('code_challenge'), createHash('sha256').update(codeVerifier).digest('base64url'));
assert.equal(authorizationUrl.searchParams.get('state'), 'fixture-state');
assert.equal(authorizationUrl.searchParams.get('resource'), resource.href);
const grants = [];
const fetchFn = async (url, init) => {
  assert.equal(String(url), metadata.token_endpoint);
  const body = new URLSearchParams(String(init.body));
  grants.push(body.get('grant_type'));
  assert.equal(body.get('resource'), resource.href);
  if (body.get('grant_type') === 'authorization_code') assert.equal(body.get('code_verifier'), codeVerifier);
  else assert.equal(body.get('refresh_token'), 'fixture-refresh');
  return Response.json({ access_token: 'fixture-access', token_type: 'Bearer', refresh_token: 'fixture-refresh', expires_in: 3600 });
};
const tokens = await exchangeAuthorization(metadata.issuer, { metadata, clientInformation, authorizationCode: 'fixture-code', codeVerifier, redirectUri: 'http://127.0.0.1:9876/callback', resource, fetchFn });
await refreshAuthorization(metadata.issuer, { metadata, clientInformation, refreshToken: tokens.refresh_token, resource, fetchFn });
assert.deepEqual(grants, ['authorization_code', 'refresh_token']);
console.log(JSON.stringify({ node: process.version, platform: process.platform, esbuild: esbuildVersion, pi: dependencies['@earendil-works/pi-ai'], mcp: dependencies['@modelcontextprotocol/sdk'], checks: ['tsx', 'pi-public-responses-entry', 'pkce-S256', 'resource-indicator', 'code-exchange', 'refresh'], boundary: 'OAuth token endpoint is a deterministic fetch fixture; no real account' }, null, 2));
