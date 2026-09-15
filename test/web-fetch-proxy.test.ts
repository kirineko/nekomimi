import { describe, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Journal, readArtifact } from "../src/journal.js";
import { webFetch } from "../src/web-fetch.js";
import { exportSession, importBundle } from "../src/export.js";
import { SessionProjection } from "../src/projection/session.js";
import { detectProxy, parseMacProxy, parseWindowsProxy, bypassProxy, proxyFor, directPolicy, type ProxyPolicy } from "../src/web-fetch/proxy.js";
import { type FetchNetwork, resolveTarget, fetchNetwork } from "../src/web-fetch/network.js";
import { temporary } from "./helpers.js";
const active = () => new AbortController().signal;
const mac = (fields: string) => `<dictionary> {\n${fields}\n}`;
const staticMac = mac('HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : 1082\nHTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 1082\nExceptionsList : <array> {\n0 : *.example.net\n}\nExcludeSimpleHostnames : 1');
const proxy = "http://127.0.0.1:1082/";
const win = (value: object) => parseWindowsProxy(JSON.stringify(value));
describe("web fetch proxy policy", () => {
  it("keeps unconfigured Linux direct and detects enabled macOS static proxies", async () => {
    expect(await detectProxy(active(), {}, "linux")).toEqual(directPolicy);
    const policy = parseMacProxy(staticMac);
    expect(policy).toMatchObject({ source: "system", httpProxy: proxy, httpsProxy: proxy });
    expect(proxyFor(new URL("https://a.example.net"), policy)).toBeUndefined();
    expect(proxyFor(new URL("https://example.com"), policy)).toBe(proxy);
    expect(parseMacProxy(mac('HTTPEnable : 0\nHTTPProxy : old.invalid\nHTTPSEnable : 0'))).toMatchObject({ source: "none" });
  });
  it("parses enabled Windows shared or per-scheme settings and disabled stale settings", () => {
    expect(win({ ProxyEnable: 1, ProxyServer: "127.0.0.1:1082" })).toMatchObject({ httpProxy: proxy, httpsProxy: proxy });
    expect(win({ ProxyEnable: 1, ProxyServer: "http=127.0.0.1:1082;https=127.0.0.1:1083", ProxyOverride: "*.example.net;<local>" })).toMatchObject({ httpsProxy: "http://127.0.0.1:1083/", noProxy: "*.example.net;<local>" });
    expect(win({ ProxyEnable: 0, ProxyServer: "stale" })).toEqual(directPolicy);
    expect(() => win({ ProxyEnable: 1, ProxyServer: "" })).toThrow("配置无效");
  });
  it("does not silently ignore active unsupported system proxy modes", () => {
    for (const key of ["ProxyAutoConfigEnable", "SOCKSEnable"])
      expect(() => parseMacProxy(mac(`${key} : 1`))).toThrow("PAC");
    expect(() => win({ AutoConfigURL: "http://proxy.example/pac" })).toThrow("PAC");
    expect(win({ AutoDetect: 1 })).toEqual(directPolicy);
    expect(parseMacProxy(mac("ProxyAutoDiscoveryEnable : 1"))).toMatchObject({ source: "none" });
    expect(() => win({ ProxyEnable: 1, ProxyServer: "socks=127.0.0.1:1080" })).toThrow("SOCKS");
    expect(() => parseMacProxy("broken output")).toThrow("配置无效");
    expect(() => parseMacProxy(mac('HTTPEnable : 1\nHTTPProxy : localhost\nHTTPPort : 0'))).toThrow("配置无效");
  });
  it("honors explicit override, environment precedence and scheme fallbacks without system lookup", async () => {
    const read = vi.fn(async () => parseMacProxy(staticMac));
    expect(await detectProxy(active(), { NEKOMIMI_WEB_FETCH_PROXY: "direct", HTTPS_PROXY: "broken" }, "darwin", read)).toMatchObject({ ...directPolicy, source: "explicit" });
    const policy = await detectProxy(active(), { http_proxy: proxy, HTTP_PROXY: "broken", HTTPS_PROXY: "http://localhost:1083", ALL_PROXY: "socks5://ignored" }, "darwin", read);
    expect(policy).toMatchObject({ source: "environment", httpProxy: proxy, httpsProxy: "http://localhost:1083/" });
    expect(await detectProxy(active(), { ALL_PROXY: proxy }, "darwin", read)).toMatchObject({ httpProxy: proxy, httpsProxy: proxy });
    expect(await detectProxy(active(), { NEKOMIMI_WEB_FETCH_PROXY: proxy, HTTPS_PROXY: "broken" }, "darwin", read)).toMatchObject({ source: "explicit", httpsProxy: proxy });
    expect(read).not.toHaveBeenCalled();
    await expect(detectProxy(active(), { HTTPS_PROXY: "socks5://private-user:private-pass@localhost" }, "darwin", read)).rejects.toThrow("HTTP(S)");
    expect(read).not.toHaveBeenCalled();
  });
  it("reads the system when no environment proxy exists and merges bypass lists", async () => {
    const read = vi.fn(async () => parseMacProxy(staticMac));
    const policy = await detectProxy(active(), { NO_PROXY: "example.com" }, "darwin", read);
    expect(read).toHaveBeenCalledOnce();
    expect(proxyFor(new URL("https://example.com"), policy)).toBeUndefined();
    expect(proxyFor(new URL("https://x.example.net"), policy)).toBeUndefined();
  });
  it.each([
    ["https://example.com", "example.com", true], ["https://sub.example.com", ".example.com", true],
    ["https://badexample.com", "example.com", false], ["https://example.com", "example.com:80", false],
    ["https://example.com:443", "example.com:443", true], ["http://[::1]:8080", "[::1]:8080", true],
    ["http://[::1]", "::1", true], ["https://example.com.", "*.example.com", true],
    ["http://machine", "<local>", true], ["https://example.com", "*", true],
  ])("matches NO_PROXY for %s / %s", (url, list, expected) => expect(bypassProxy(new URL(url), list)).toBe(expected));
  it("honors cancellation before and during system detection", async () => {
    const controller = new AbortController(); controller.abort();
    const read = vi.fn(async () => directPolicy);
    await expect(detectProxy(controller.signal, {}, "darwin", read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    const later = new AbortController();
    await expect(detectProxy(later.signal, {}, "darwin", async () => { later.abort(); return directPolicy; })).rejects.toThrow();
  });
});

async function proxyFixture(handler: (request: string, connect: string) => { body?: string; status?: number; headers?: Record<string, string>; hang?: boolean }) {
  const tunnels: string[] = [], requests: string[] = [];
  const sockets = new Set<import("node:stream").Duplex>();
  const server = createServer();
  server.on("connect", (req, socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    tunnels.push(JSON.stringify({ url: req.url, authorization: req.headers["proxy-authorization"] }));
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    let data = "";
    socket.on("data", chunk => {
      data += chunk.toString(); if (!data.includes("\r\n\r\n")) return;
      const request = data; data = ""; requests.push(request);
      const result = handler(request, tunnels.at(-1)!); if (result.hang) return;
      const body = gzipSync(result.body ?? "<p>Readable body</p>");
      const headers = { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip", "Content-Length": String(body.length), Connection: "close", ...result.headers };
      socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 ${result.status ?? 200} Response\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("")}\r\n`), body]));
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;
  return { tunnels, requests, port, policy: { source: "explicit", httpProxy: `http://proxy-user:proxy-password@127.0.0.1:${port}/`, noProxy: "" } as ProxyPolicy,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
const fakeNetwork = (): FetchNetwork => ({ resolve: vi.fn(async () => [{ address: "198.18.0.10", family: 4 }]), request: vi.fn(async () => { throw new Error("must not connect directly"); }) });
async function journal() { return Journal.open(join(await temporary(), "session")); }

describe("web fetch proxy integration", () => {
  it.each(["a", "status", '"', "utf", "text", "artifact"])("preserves protocol and decoding with credential %s", async credential => {
    const fixture = await proxyFixture(request => ({ status: request.includes("/failure ") ? 403 : 200, body: "<p>中文 readable body</p>" }));
    const j = await journal();
    try {
      const options = { network: fakeNetwork(), proxy: { ...fixture.policy, httpProxy: `http://${encodeURIComponent(credential)}:private-password@127.0.0.1:${fixture.port}/` } };
      const result = await webFetch(j, {}, "http://public.example/", options);
      expect(result.details).toMatchObject({ status: "complete", statusCode: 200, bodyTruncated: false, responseCharset: "utf-8", responseEncoding: "utf-8" });
      expect((await readArtifact(j.directory, result.details.artifact!)).toString()).toContain("中文");
      expect((await readArtifact(j.directory, result.details.response!)).toString()).toContain("中文");
      expect(j.events.at(-1)).toMatchObject({ type: "fetch.finished", payload: { status: "complete" } });
      await expect(webFetch(j, {}, "http://public.example/failure", options)).rejects.toThrow();
      expect(j.events.at(-1)).toMatchObject({ type: "fetch.finished", payload: { status: "failed", errorCode: "HTTP_ERROR", statusCode: 403 } });
    } finally { await j.close(); await fixture.close(); }
  });
  it.each(["alpha*beta", "alpha_beta", "alpha[beta]", "alpha|beta"])("redacts decoded HTML before Markdown conversion: %s", async password => {
    const encoded = [...password].map(c => `&#${c.charCodeAt(0)};`).join("");
    const fixture = await proxyFixture(() => ({ body: `<title>${encoded}</title><p>${"x".repeat(16300)} ${encoded}</p><pre>${encoded}</pre><table><tr><td>${encoded}</td></tr></table>` }));
    const j = await journal();
    try {
      const result = await webFetch(j, {}, "http://public.example/", { network: fakeNetwork(), proxy: { ...fixture.policy, httpProxy: `http://private-user:${encodeURIComponent(password)}@127.0.0.1:${fixture.port}/` } });
      const text = (await readArtifact(j.directory, result.details.artifact!)).toString();
      expect(text).toContain("REDACTED");
      expect(text.replaceAll("\\", "")).not.toContain(password);
      expect(result.content[0]!.text.replaceAll("\\", "")).not.toContain(password);
      expect(result.details.title).toBe("[REDACTED]");
    } finally { await j.close(); await fixture.close(); }
  });
  it("uses CONNECT without local Fake-IP DNS; isolates auth, uses browser headers and decodes gzip", async () => {
    const fixture = await proxyFixture(() => ({ body: '<meta name="description" content="Useful summary"><div>Loading</div>' }));
    const j = await journal(), network = fakeNetwork();
    try {
      const result = await webFetch(j, { toolCallId: "fetch" }, "http://public.example/page", { network, proxy: fixture.policy });
      expect(result.details).toMatchObject({ route: { mode: "proxy", source: "explicit" }, extraction: "metadata", status: "complete" });
      expect(network.resolve).not.toHaveBeenCalled(); expect(network.request).not.toHaveBeenCalled();
      expect(fixture.tunnels[0]).toContain("public.example:80");
      expect(fixture.tunnels[0]).toContain(Buffer.from("proxy-user:proxy-password").toString("base64"));
      expect(fixture.requests[0]).toContain("host: public.example");
      expect(fixture.requests[0]).toContain("Chrome/124"); expect(fixture.requests[0]).toContain("sec-fetch-mode: navigate");
      expect(fixture.requests[0]).not.toMatch(/proxy-authorization|proxy-password|cookie:|\r\nauthorization:/i);
      expect(JSON.stringify(j.events)).not.toMatch(/proxy-password|proxy-user|127.0.0.1/);
    } finally { await j.close(); await fixture.close(); }
  });
  it("supports percent-encoded proxy credentials and an empty password", async () => {
    const fixture = await proxyFixture(() => ({})), j = await journal();
    try {
      for (const [auth, decoded] of [["name%40host:p%3Ass", "name@host:p:ss"], ["only-user:", "only-user:"]]) {
        await webFetch(j, {}, "http://public.example/", { network: fakeNetwork(), proxy: { ...fixture.policy, httpProxy: `http://${auth}@127.0.0.1:${fixture.port}/` } });
        expect(fixture.tunnels.at(-1)).toContain(Buffer.from(decoded!).toString("base64"));
      }
      expect(JSON.stringify(j.events)).not.toMatch(/p%3Ass|p:ss|only-user/);
    } finally { await j.close(); await fixture.close(); }
  });
  it("times out a stalled proxy without direct fallback", async () => {
    const fixture = await proxyFixture(() => ({ hang: true })), j = await journal(), network = fakeNetwork();
    try {
      await expect(webFetch(j, {}, "http://public.example/", { timeoutMs: 300, network, proxy: fixture.policy })).rejects.toThrow("超时");
      expect(j.events.at(-1)!.payload).toMatchObject({ errorCode: "TIMEOUT" });
      expect(network.request).not.toHaveBeenCalled();
    } finally { await j.close(); await fixture.close(); }
  });
  it("preserves direct DNS checks for NO_PROXY and rejects local targets before proxy connection", async () => {
    const fixture = await proxyFixture(() => ({})), j = await journal(), network = fakeNetwork();
    try {
      await expect(webFetch(j, {}, "http://public.example/", { network, proxy: { ...fixture.policy, noProxy: "public.example" } })).rejects.toThrow("Fake-IP");
      expect(network.resolve).toHaveBeenCalledOnce();
      for (const host of ["127.0.0.1", "198.18.0.2", "localhost.", "foo.local", "printer", "[::1]"])
        await expect(webFetch(j, {}, `http://${host}/`, { network, proxy: fixture.policy })).rejects.toThrow("非公开");
      expect(fixture.tunnels).toHaveLength(0);
      expect(network.request).not.toHaveBeenCalled();
    } finally { await j.close(); await fixture.close(); }
  });
  it("re-evaluates same-origin hops, records routes, and blocks cross-origin redirects", async () => {
    const fixture = await proxyFixture(request => request.startsWith("GET /start ") ? { status: 302, headers: { Location: "/final" } } : request.startsWith("GET /cross ") ? { status: 302, headers: { Location: "http://other.example" } } : {});
    const j = await journal();
    try {
      const options = { network: fakeNetwork(), proxy: fixture.policy };
      const result = await webFetch(j, {}, "http://public.example/start", options);
      expect(result.details.finalUrl).toBe("http://public.example/final");
      expect(j.events.filter(e => e.type === "fetch.route")).toHaveLength(2);
      await expect(webFetch(j, {}, "http://public.example/cross", options)).rejects.toThrow("跨源");
      expect(fixture.tunnels).toHaveLength(3);
    } finally { await j.close(); await fixture.close(); }
  });
  it.each([200, 403])("classifies explicit challenges with HTTP %s and preserves redacted evidence on replay", async status => {
    const fixture = await proxyFixture(() => ({ status, headers: { "cf-mitigated": "challenge" }, body: "<p>proxy-password " + Buffer.from("proxy-user:proxy-password").toString("base64") + "</p>" }));
    const j = await journal();
    let closed = false;
    try {
      await expect(webFetch(j, { toolCallId: "fetch" }, "http://public.example/", { network: fakeNetwork(), proxy: fixture.policy })).rejects.toThrow("浏览器验证");
      const details = j.events.at(-1)!.payload as any;
      expect(details).toMatchObject({ errorCode: "BROWSER_CHALLENGE", statusCode: status, status: "failed", response: { redacted: true } });
      expect((await readArtifact(j.directory, details.response)).toString()).not.toContain("proxy-password");
      await j.close(); closed = true; const bundle = join(await temporary(), "bundle");
      await exportSession(j.directory, { format: "bundle", output: bundle });
      for (const name of await readdir(join(bundle, "artifacts"))) expect((await readFile(join(bundle, "artifacts", name))).toString()).not.toMatch(/proxy-user|proxy-password|cHJveHktdXNlcjpwcm94eS1wYXNzd29yZA==/);
      const imported = join(await temporary(), "imported"); await importBundle(bundle, imported);
      const projection = new SessionProjection(imported); await projection.update(j.events);
      expect(fixture.tunnels).toHaveLength(1);
    } finally { if (!closed) await j.close(); await fixture.close(); }
  });
  it("does not label ordinary 403 as browser validation", async () => {
    const fixture = await proxyFixture(() => ({ status: 403, body: "Forbidden" })), j = await journal();
    try {
      await expect(webFetch(j, {}, "http://public.example/", { network: fakeNetwork(), proxy: fixture.policy })).rejects.toThrow("HTTP 403");
      expect(j.events.at(-1)!.payload).toMatchObject({ errorCode: "HTTP_ERROR", challenge: false });
    } finally { await j.close(); await fixture.close(); }
  });
  it("never falls back after proxy failure and records no HTTP response", async () => {
    const fixture = await proxyFixture(() => ({})); await fixture.close(); const j = await journal(), network = fakeNetwork();
    try {
      await expect(webFetch(j, {}, "http://public.example/", { network, proxy: fixture.policy })).rejects.toThrow("未回退直连");
      expect(network.resolve).not.toHaveBeenCalled(); expect(network.request).not.toHaveBeenCalled();
      expect(j.events.at(-1)!.payload).toMatchObject({ errorCode: "PROXY_CONNECTION" });
      expect(j.events.at(-1)!.payload).not.toHaveProperty("statusCode");
    } finally { await j.close(); }
  });
  it("cancels a pending proxy response without late results or retries", async () => {
    const controller = new AbortController();
    const fixture = await proxyFixture(() => { controller.abort(); return { hang: true }; }), j = await journal();
    try {
      await expect(webFetch(j, {}, "http://public.example/", { network: fakeNetwork(), proxy: fixture.policy }, controller.signal)).rejects.toThrow("已取消");
      expect(j.events.at(-1)!.payload).toMatchObject({ status: "cancelled", errorCode: "CANCELLED" });
      expect(fixture.tunnels).toHaveLength(1);
    } finally { await j.close(); await fixture.close(); }
  });
  it("unconfigured direct mode still pins a validated DNS answer", async () => {
    const network = { ...fetchNetwork, resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) };
    expect(await resolveTarget(new URL("https://public.example"), network, active())).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});
