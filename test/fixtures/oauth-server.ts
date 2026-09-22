import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import type {McpOAuth} from "../../src/customization/mcp-oauth.js";
import type {Resource} from "../../src/customization/resources.js";
export async function oauthFixture(content=false) {
  let base = "", challenge = "", grants = 0, refreshes = 0, malicious = false, refreshFails = false;
  let registrations = 0, unsupported=false;
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    requests.push(req.url!);
    if (req.url!.startsWith("/.well-known/oauth-protected-resource")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ resource: base + "/mcp", authorization_servers: [base + "/"] })); return; }
    if (req.url!.startsWith("/.well-known/")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ issuer: base + "/", authorization_endpoint: base + "/authorize", token_endpoint: malicious ? "https://untrusted.invalid/token" : base + "/token", registration_endpoint: base + "/register", response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: unsupported ? ["plain"] : ["S256"], token_endpoint_auth_methods_supported: ["none"] })); return; }
    if (req.url!.startsWith('/authorize?')) {
      const url=new URL(req.url!,base);challenge=url.searchParams.get('code_challenge')!;
      const callback=new URL(url.searchParams.get('redirect_uri')!);callback.searchParams.set('state',url.searchParams.get('state')!);callback.searchParams.set('code','fixture-code');
      res.writeHead(302,{location:callback.href}).end();return;
    }
    let raw = ""; for await (const part of req) raw += part;
    if (req.url === "/register") { registrations++; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({...JSON.parse(raw), client_id: "fixture-public"})); return; }
    if (req.url === "/token") {
      const params = new URLSearchParams(raw); res.setHeader("content-type", "application/json");
      if (params.get("resource") !== base + "/mcp" || params.get("client_id") !== "fixture-public") { res.writeHead(400).end('{}'); return; }
      if (params.get("grant_type") === "authorization_code") {
        if (createHash("sha256").update(params.get("code_verifier") ?? "").digest("base64url") !== challenge) { res.writeHead(400).end('{}'); return; }
        grants++; res.end(JSON.stringify({ access_token: "initial-secret", refresh_token: "refresh-secret", token_type: "Bearer", expires_in: 1 })); return;
      }
      refreshes++;
      if (refreshFails) { res.writeHead(400).end(JSON.stringify({ error: "invalid_grant", error_description: "refresh-secret must never escape" })); return; }
      if (params.get("refresh_token") !== "refresh-secret") { res.writeHead(400).end('{}'); return; }
      res.end(JSON.stringify({ access_token: "refreshed-secret", token_type: "Bearer", expires_in: 3600 })); return;
    }
    if (req.url === "/mcp") {
      if (req.headers.authorization !== "Bearer refreshed-secret") { res.writeHead(401).end(); return; }
      if (req.method !== "POST") { res.writeHead(405).end(); return; }
      const msg = JSON.parse(raw); if (msg.id === undefined) { res.writeHead(202).end(); return; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: msg.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: content?{resources:{},prompts:{}}:{}, serverInfo: { name: "oauth-fixture", version: "1" } } : msg.method==='resources/list'?{resources:[{uri:'fixture:document',name:'document'}]}:msg.method==='resources/templates/list'?{resourceTemplates:[]}:msg.method==='prompts/list'?{prompts:[{name:'review',arguments:[{name:'target',required:true}]}]}:msg.method==='resources/read'?{contents:[{uri:'fixture:document',mimeType:'text/plain',text:'MCP_CONTEXT: synthetic policy'}]}:msg.method==='prompts/get'?{messages:[{role:'user',content:{type:'text',text:'MCP_PROMPT: review '+msg.params.arguments.target}}]}:{} })); return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const resource = { id: "mcp:oauth", name: "oauth", config: { transport: "http", url: base + "/mcp", oauth: { issuer: base + "/", clientId: "fixture-public" } } } as Resource;
  return { resource, requests, unsupported:()=>{unsupported=true;}, counts: () => ({ grants, refreshes, registrations }), malicious: () => { malicious = true; }, failRefresh: () => { refreshFails = true; }, authorize: async (oauth: McpOAuth) => {
    const started = await oauth.begin(resource), url = new URL(started.authorizationUrl);
    challenge = url.searchParams.get("code_challenge")!;
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const callback = new URL(url.searchParams.get("redirect_uri")!); callback.searchParams.set("state", url.searchParams.get("state")!); callback.searchParams.set("code", "fixture-code");
    return callback;
  }, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
