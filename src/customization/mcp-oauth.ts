import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { chmod } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, startAuthorization, exchangeAuthorization, refreshAuthorization, registerClient } from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthorizationServerMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { atomicFile, hash } from "../journal.js";
import { directory } from "../storage/paths.js";
import { boundedRead, exists, safePath, type Resource } from "./resources.js";

export interface McpOAuthConfig { issuer: string; clientId?: string; dynamicRegistration?: boolean; redirectPort?: number; scope?: string }
interface Stored { version: 1; binding: string; metadata?: AuthorizationServerMetadata; clientId?: string; tokens?: OAuthTokens; expiresAt?: number; status: "authorized" | "reauthorize" | "disconnected" }
function endpoint(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("OAuth endpoint must be HTTPS or loopback HTTP without credentials/query");
  return url;
}
/** Public authorization-code clients with S256; no implicit or client-secret fallback. */
export class McpOAuth {
  private pending = new Map<string, { server: Server; expires: number; stop: () => void }>();
  private starting = new Set<string>();
  private closed = new AbortController();
  private generations = new Map<string, number>();
  constructor(readonly home: string) {}
  private binding(resource: Resource) {
    const config = resource.config?.oauth;
    if (resource.config?.transport !== "http" || !config || resource.config.credentialEnv || !(typeof config.clientId === "string" && config.clientId.length > 0 && config.clientId.length <= 1024 && !config.dynamicRegistration || config.dynamicRegistration === true && config.clientId === undefined)) throw new Error("MCP OAuth requires an HTTP server, issuer and either public clientId or dynamicRegistration; credentialEnv cannot be combined");
    if (config.scope !== undefined && (typeof config.scope !== "string" || config.scope.length > 2048)) throw new Error("Invalid OAuth scope");
    if (config.redirectPort !== undefined && (!Number.isInteger(config.redirectPort) || config.redirectPort < 1024 || config.redirectPort > 65535)) throw new Error("Invalid OAuth redirect port");
    const server = endpoint(resource.config.url!), issuer = endpoint(config.issuer);
    const binding = hash(JSON.stringify([resource.id, server.href, issuer.href, config.clientId, config.scope, config.dynamicRegistration, config.redirectPort]));
    return { config, server, issuer, binding };
  }
  private async storage(resource: Resource) {
    const bound = this.binding(resource), home = await directory(this.home), root = await directory(await safePath(home, join(home, "mcp-auth")));
    return { ...bound, root, file: await safePath(root, bound.binding + ".json") };
  }
  private async read(file: string, binding: string): Promise<Stored> {
    if (!(await exists(file))) return { version: 1, binding, status: "disconnected" };
    const value = JSON.parse(await boundedRead(file));
    if (value.version !== 1 || value.binding !== binding || !["authorized", "reauthorize", "disconnected"].includes(value.status)) throw new Error("Invalid OAuth credential store");
    return value;
  }
  private async write(file: string, value: Stored) { await atomicFile(file, JSON.stringify(value)); await chmod(file, 0o600); }
  private async exclusive<T>(resource: Resource, fn: (storage: Awaited<ReturnType<McpOAuth["storage"]>>, state: Stored) => Promise<T>) {
    const storage = await this.storage(resource);
    const release = await lockfile.lock(storage.root, { retries: { retries: 60, minTimeout: 50, maxTimeout: 500 } });
    try { return await fn(storage, await this.read(storage.file, storage.binding)); } finally { await release(); }
  }
  private fetch(origins: string[], exact?: string): typeof fetch {
    return async (input, init) => {
      const url = endpoint(String(input));
      if (!origins.includes(url.origin) || (exact && url.href !== exact)) throw new Error("OAuth target outside authorized binding");
      const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([this.closed.signal, AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
      if (!response.body) return response;
      const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 256 * 1024) throw new Error("OAuth response limit"); parts.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); }
      return new Response(Buffer.concat(parts), { status: response.status, headers: response.headers });
    };
  }
  private validate(metadata: AuthorizationServerMetadata | undefined, issuer: URL) {
    if (!metadata || endpoint(metadata.issuer).href !== issuer.href || !metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.code_challenge_methods_supported?.includes("S256") || !metadata.response_types_supported.includes("code") || !metadata.token_endpoint_auth_methods_supported?.includes("none")) throw new Error("OAuth metadata requires matching issuer, code, S256 and public-client authentication");
    for (const target of [metadata.authorization_endpoint, metadata.token_endpoint]) if (endpoint(target).origin !== issuer.origin) throw new Error("OAuth endpoints outside authorized issuer");
    return metadata;
  }
  async describe(resource: Resource) {
    const { file, binding, issuer, config } = await this.storage(resource), state = await this.read(file, binding);
    return { server: resource.id, issuer: issuer.href, clientId: state.clientId ?? config.clientId, dynamicRegistration: config.dynamicRegistration === true, status: this.pending.has(binding) ? "authorizing" : state.status, expiresAt: state.expiresAt };
  }
  async begin(resource: Resource) {
    this.closed.signal.throwIfAborted();
    const bound = await this.storage(resource);
    if (this.pending.has(bound.binding) || this.starting.has(bound.binding)) throw new Error("OAuth authorization already pending");
    if (this.pending.size + this.starting.size >= 8) throw new Error("OAuth pending authorization limit");
    this.starting.add(bound.binding);
    try { return await this.start(resource, bound); } finally { this.starting.delete(bound.binding); }
  }
  private async start(resource: Resource, bound: Awaited<ReturnType<McpOAuth["storage"]>>) {
    const generation = this.generations.get(bound.binding) ?? 0;
    const current = () => { this.closed.signal.throwIfAborted(); if ((this.generations.get(bound.binding) ?? 0) !== generation) throw new Error("OAuth authorization cancelled"); };
    const protectedMetadata = await discoverOAuthProtectedResourceMetadata(bound.server, undefined, this.fetch([bound.server.origin]));
    if (protectedMetadata.resource !== bound.server.href || !protectedMetadata.authorization_servers?.includes(bound.issuer.href)) throw new Error("OAuth resource/issuer discovery mismatch");
    const metadata = this.validate(await discoverAuthorizationServerMetadata(bound.issuer, { fetchFn: this.fetch([bound.issuer.origin]) }), bound.issuer);
    current();
    const state = randomBytes(32).toString("base64url"), path = "/oauth/callback";
    let clientId = bound.config.clientId ?? "";
    let redirectUri = "", verifier = "", used = false;
    const expires = Date.now() + 5 * 60_000;
    const server = createServer(async (req, res) => {
      const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer" };
      try {
        if (req.method !== "GET" || req.headers.host !== new URL(redirectUri).host || !req.url || req.url.length > 8192) throw new Error();
        const url = new URL(req.url, redirectUri), supplied = Buffer.from(url.searchParams.get("state") ?? "");
        if (url.pathname !== path || used || Date.now() >= expires || supplied.length !== state.length || !timingSafeEqual(supplied, Buffer.from(state)) || url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length !== 1 || url.searchParams.has("error")) throw new Error();
        current(); used = true;
        await this.exclusive(resource, async storage => {
          const tokens = await exchangeAuthorization(bound.issuer, { metadata, clientInformation: { client_id: clientId }, authorizationCode: url.searchParams.get("code")!, codeVerifier: verifier, redirectUri, resource: bound.server, fetchFn: this.fetch([bound.issuer.origin], metadata.token_endpoint) });
          current(); this.validateTokens(tokens);
          await this.write(storage.file, { version: 1, binding: storage.binding, status: "authorized", metadata, clientId, tokens, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 });
        });
        res.writeHead(200, headers).end("授权完成，可以关闭此窗口。");
        this.pending.get(bound.binding)?.stop();
      } catch {
        res.writeHead(400, headers).end("授权回调无效或交换失败，请重新授权。");
        if (used) this.pending.get(bound.binding)?.stop();
      }
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(bound.config.redirectPort ?? 0, "127.0.0.1", resolve); });
    redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}${path}`;
    try {
      current();
      if (bound.config.dynamicRegistration) {
        if (!metadata.registration_endpoint || endpoint(metadata.registration_endpoint).origin !== bound.issuer.origin) throw new Error("OAuth dynamic registration unavailable or outside authorized issuer");
        const registered = await registerClient(bound.issuer, { metadata, clientMetadata: { client_name: "Nekomimi", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, scope: bound.config.scope, fetchFn: this.fetch([bound.issuer.origin], metadata.registration_endpoint) });
        current();
        if (registered.client_secret || registered.token_endpoint_auth_method !== "none" || !registered.client_id || registered.client_id.length > 1024 || !registered.redirect_uris.includes(redirectUri)) throw new Error("OAuth registration must return the requested public client binding");
        clientId = registered.client_id;
      }
      const authorization = await startAuthorization(bound.issuer, { metadata, clientInformation: { client_id: clientId }, redirectUrl: redirectUri, scope: bound.config.scope, state, resource: bound.server });
      current(); verifier = authorization.codeVerifier;
      const timer = setTimeout(() => stop(), expires - Date.now()); timer.unref();
      const stop = () => { used = true; verifier = ""; clearTimeout(timer); this.pending.delete(bound.binding); server.close(); server.closeIdleConnections(); };
      this.pending.set(bound.binding, { server, expires, stop });
      return { authorizationUrl: authorization.authorizationUrl.href, expiresAt: expires, status: "authorizing" };
    } catch { server.close(); server.closeAllConnections(); throw new Error("Unable to start OAuth authorization; public client registration or discovery unsupported"); }
  }
  private validateTokens(tokens: OAuthTokens) {
    if (tokens.token_type.toLowerCase() !== "bearer" || !tokens.access_token || tokens.access_token.length > 16384 || (tokens.expires_in !== undefined && (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0))) throw new Error("Unsupported OAuth token response");
  }
  async token(resource: Resource): Promise<string> {
    return this.exclusive(resource, async (storage, state) => {
      if (!state.tokens || state.status !== "authorized") throw new Error("MCP OAuth authorization required");
      if ((state.expiresAt ?? 0) > Date.now() + 30_000) return state.tokens.access_token;
      if (!state.tokens.refresh_token) { await this.write(storage.file, { version: 1, binding: storage.binding, status: "reauthorize" }); throw new Error("MCP OAuth reauthorization required"); }
      try {
        const metadata = this.validate(state.metadata, storage.issuer);
        const tokens = await refreshAuthorization(storage.issuer, { metadata, clientInformation: { client_id: state.clientId ?? storage.config.clientId! }, refreshToken: state.tokens.refresh_token, resource: storage.server, fetchFn: this.fetch([storage.issuer.origin], metadata.token_endpoint) });
        this.validateTokens(tokens);
        await this.write(storage.file, { ...state, tokens, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 });
        return tokens.access_token;
      } catch { await this.write(storage.file, { version: 1, binding: storage.binding, status: "reauthorize" }); throw new Error("MCP OAuth refresh failed; reauthorization required"); }
    });
  }
  async disconnect(resource: Resource, invalid = false) {
    const binding = this.binding(resource).binding; this.generations.set(binding, (this.generations.get(binding) ?? 0) + 1); this.pending.get(binding)?.stop();
    await this.exclusive(resource, async storage => { await this.write(storage.file, { version: 1, binding: storage.binding, status: invalid ? "reauthorize" : "disconnected" }); });
  }
  close() { this.closed.abort(new Error("OAuth host closed")); for (const item of this.pending.values()) item.stop(); }
}
