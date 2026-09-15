import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/presentation/markdown.js";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync, deflateSync } from "node:zlib";
import { join } from "node:path";
import { Journal, readArtifact, readSession } from "../src/journal.js";
import { CoreTools } from "../src/tools.js";
import { webFetch, type WebFetchOptions } from "../src/web-fetch.js";
import { extractHtml, decodePage } from "../src/web-fetch/extract.js";
import { fetchNetwork, publicAddress, pinnedLookup, type FetchNetwork } from "../src/web-fetch/network.js";
import { SessionProjection } from "../src/projection/session.js";
import { exportSession, importBundle } from "../src/export.js";
import { temporary } from "./helpers.js";
const signal = () => new AbortController().signal;
const publicIP = [{ address: "93.184.216.34", family: 4 }];
function fixture(reply: (url: URL, signal: AbortSignal) => Response | Promise<Response>): FetchNetwork {
  return { resolve: vi.fn(async () => publicIP), request: vi.fn(async (url, _addresses, active) => ({ response: await reply(url, active), close: vi.fn(async () => {}) })) };
}
const html = (text: string, init?: ResponseInit) => new Response(text, { ...init, headers: { "content-type": "text/html", ...init?.headers } });
async function setup(network: FetchNetwork, overrides: WebFetchOptions = {}) {
  const dir = await temporary();
  const j = await Journal.open(join(dir, "session"), { secrets: ["fixture-secret"] });
  const options = { network, ...overrides };
  const tools = (await CoreTools.create(dir, j, { runId: "run" }, { webFetch: options })).definitions();
  return { dir, j, tools, call: (url = "https://example.com/page", active?: AbortSignal) => webFetch(j, { runId: "run", toolCallId: "fetch" }, url, options, active) };
}
describe("web fetch extraction", () => {
  it("preserves body structure and omits executable/hidden content without fetching embedded resources", async () => {
    const page = await extractHtml('<html><head><title>A &amp; B</title><meta name="description" content="SEO"></head><body><h1>Heading</h1><p>Hello <a href="/docs">docs</a></p><ul><li>First</li><li>Second</li></ul><pre>const x = 1;\n  line</pre><table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table><script>bad()</script><style>BAD</style><noscript>BAD</noscript><div hidden>BAD</div><div style="display: none !important">BAD</div><div aria-hidden="true">BAD</div><iframe src="http://localhost">BAD</iframe><img src="http://localhost"><svg>BAD</svg></body></html>', "https://example.com/a", signal());
    expect(page.title).toBe("A & B"); expect(page.extraction).toBe("body");
    for (const text of ["# Heading", "[docs](https://example.com/docs)", "- First", "- Second", "const x = 1;\n  line", "| Name | Value |", "| --- | --- |", "| A | 1 |"]) expect(page.text).toContain(text);
    expect(page.text).not.toMatch(/BAD|bad\(\)|SEO|localhost/);
  });
  it.each(['my_func("a_b")', 'C:\\temp\\file', '`value`', 'x``y', '  spaced  ', 'a|b'])('preserves inline code through Markdown: %s', async code => {
    const page = await extractHtml(`<p>Run <code><span>${code}</span></code>.</p>`, "https://example.com", signal());
    const rendered = renderToStaticMarkup(createElement(Markdown, { text: page.text }));
    expect(rendered).toContain(renderToStaticMarkup(createElement("code", null, code)));
  });
  it("keeps code fences containing backticks intact", async () => {
    const code = 'hello\n````\nworld';
    const page = await extractHtml(`<pre><code><span>${code}</span></code></pre>`, "https://example.com", signal());
    expect(renderToStaticMarkup(createElement(Markdown, { text: page.text }))).toContain(renderToStaticMarkup(createElement("code", null, code + "\n")));
  });
  it.each([
    '<table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table>',
    '<table>\n <thead>\n  <tr><th>Name</th><th>Value</th></tr>\n </thead>\n <tbody>\n  <tr><td><p>A</p></td><td><div>1</div></td></tr>\n  <tr><td>B</td><td>2</td></tr>\n </tbody>\n</table>',
  ])("renders actual GFM table body without splitting data rows", async source => {
    const page = await extractHtml(source, "https://example.com", signal());
    const rendered = renderToStaticMarkup(createElement(Markdown, { text: page.text })).replace(/>\s+</g, "><");
    expect(rendered).toContain('<tbody><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></tbody>');
    expect(rendered).not.toContain('<p>|');
  });
  it("retains table captions and literal pipes in inline code cells", async () => {
    const page = await extractHtml('<table><caption>Results</caption><tr><th>Code</th></tr><tr><td><code>a|b</code></td></tr></table>', "https://example.com", signal());
    const rendered = renderToStaticMarkup(createElement(Markdown, { text: page.text }));
    expect(rendered).toContain('<p>Results</p>');
    expect(rendered).toContain('<tbody><tr><td><code>a|b</code></td></tr></tbody>');
  });
  it.each(["", "Loading", "loading...", "Please enable JavaScript", "You need to enable JavaScript to run this app."])("uses description only for placeholder %s", async body => {
    const page = await extractHtml(`<meta property="og:description" content="social"><meta name="description" content="Real &amp; useful"><p>${body}</p>`, "https://example.com", signal());
    expect(page).toMatchObject({ text: "Real & useful", extraction: "metadata" });
  });
  it("keeps short useful body and metadata priority, normalizes whitespace and decodes entities", async () => {
    expect(await extractHtml('<meta name="description" content="SEO"><p>OK</p>', "https://example.com", signal())).toMatchObject({ text: "OK", extraction: "body" });
    expect(await extractHtml('<meta name="twitter:description" content="twitter"><meta property="og:description" content="  social &amp; text ">', "https://example.com", signal())).toMatchObject({ text: "social & text", extraction: "metadata" });
    expect(await extractHtml('<meta name="twitter:description" content="twitter">', "https://example.com", signal())).toMatchObject({ text: "twitter", extraction: "metadata" });
    expect(await extractHtml('<script>stuff</script>', "https://example.com", signal())).toMatchObject({ text: "", extraction: "empty" });
  });
  it("rejects excessive nesting, avoids expanding span counts and supports cancellation", async () => {
    await expect(extractHtml("<div>".repeat(257), "https://example.com", signal())).rejects.toThrow("解析限制");
    const page = await extractHtml('<table><tr><th colspan="999999999">A</th></tr></table>', "https://example.com", signal());
    expect(page.text.length).toBeLessThan(100);
    const ac = new AbortController(); ac.abort();
    await expect(extractHtml("<p>hello</p>", "https://example.com", ac.signal)).rejects.toThrow();
  });
  it("decodes declared charsets and classifies text without binary garbage", () => {
    expect(decodePage(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]), "text/plain; charset='gbk'").text).toBe("中文");
    expect(decodePage(Buffer.from('<!doctype html><p>hi</p>'), "").html).toBe(true);
    expect(() => decodePage(Buffer.from("x"), "image/png")).toThrow("内容类型");
    expect(() => decodePage(Buffer.from("x"), "text/plain;charset=bogus")).toThrow("字符编码");
  });
});
describe("web fetch transport and evidence", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "0.0.0.0", "100.64.0.1", "192.168.0.1", "192.0.2.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::7f00:1", "2001:db8::1", "2002:7f00:1::"])("rejects non-public %s", ip => expect(publicAddress(ip)).toBe(false));
  it("validates all DNS answers and rejects credentials/schemes before requesting", async () => {
    const net = fixture(() => html("good")); const { j, call } = await setup(net);
    try {
      for (const url of ["file:///etc/passwd", "https://name:pass@example.com", "http://2130706433", "http://[::ffff:127.0.0.1]"])
        await expect(call(url)).rejects.toThrow();
      net.resolve = async () => [...publicIP, { address: "10.0.0.1", family: 4 }];
      await expect(call()).rejects.toThrow("非公开");
      expect(net.request).not.toHaveBeenCalled();
      expect(publicAddress("8.8.8.8")).toBe(true); expect(publicAddress("2606:4700:4700::1111")).toBe(true);
    } finally { await j.close(); }
  });
  it("pins lookup to the validated address and preserves family/all lookup semantics", () => {
    const cb = vi.fn(); const lookup = pinnedLookup(publicIP);
    lookup("example.com", { all: true }, cb); expect(cb).toHaveBeenLastCalledWith(null, publicIP);
    lookup("example.com", { family: 4 }, cb); expect(cb).toHaveBeenLastCalledWith(null, publicIP[0]!.address, 4);
    lookup("example.com", { family: 6 }, cb); expect(cb.mock.lastCall?.[0]).toHaveProperty("code", "ENOTFOUND");
  });
  it("follows same-origin hops and blocks cross-origin, missing Location and loops", async () => {
    const net = fixture(url => url.pathname === "/page" ? new Response(null, { status: 302, headers: { location: "/final" } }) : html("done"));
    const { j, call } = await setup(net);
    try {
      expect((await call()).details.finalUrl).toBe("https://example.com/final");
      expect(net.resolve).toHaveBeenCalledTimes(2);
      const blocked = fixture(() => new Response(null, { status: 302, headers: { location: "https://other.example/target" } }));
      await expect(webFetch(j, {}, "https://example.com", { network: blocked })).rejects.toThrow("https://other.example/target");
      expect(blocked.request).toHaveBeenCalledTimes(1);
      await expect(webFetch(j, {}, "https://example.com", { network: fixture(() => new Response(null, { status: 302 })) })).rejects.toThrow("Location");
      const loop = fixture(() => new Response(null, { status: 302, headers: { location: "/loop" } }));
      await expect(webFetch(j, {}, "https://example.com", { network: loop })).rejects.toThrow("5 次");
      expect(loop.request).toHaveBeenCalledTimes(6);
    } finally { await j.close(); }
  });
  it("does not attribute a previous redirect status to a failed destination and rejects unknown encodings", async () => {
    const net = fixture(url => {
      if (url.pathname === "/page") return new Response(null, { status: 302, headers: { location: "/final" } });
      throw new Error("connection failed");
    });
    const { j, call } = await setup(net);
    try {
      await expect(call()).rejects.toThrow("connection failed");
      expect(j.events.at(-1)!.payload).toMatchObject({ finalUrl: "https://example.com/final", status: "failed" });
      expect(j.events.at(-1)!.payload).not.toHaveProperty("statusCode");
      expect(j.events.at(-1)!.payload).not.toHaveProperty("response");
      await expect(webFetch(j, {}, "https://example.com", { network: fixture(() => html("encoded data", { headers: { "content-encoding": "unknown" } })) })).rejects.toThrow("压缩编码");
    } finally { await j.close(); }
  });
  it("caps streaming bytes with exact-cap correctness, keeps full extraction beyond output and supports read", async () => {
    const net = fixture(url => html(url.pathname === "/exact" ? "x".repeat(100) : "x".repeat(101)));
    const { dir, j, call } = await setup(net, { maxResponseBytes: 100 });
    try {
      expect((await call("https://example.com/exact")).details.bodyTruncated).toBe(false);
      const cut = await call(); expect(cut.details).toMatchObject({ bodyTruncated: true, byteCount: 100, status: "partial" });
      const result = await webFetch(j, {}, "https://example.com", { network: fixture(() => html("汉".repeat(1000))), maxOutputChars: 700 });
      expect(result.content[0]!.text.length).toBeLessThanOrEqual(700);
      expect(result.details).toMatchObject({ outputTruncated: true, bodyTruncated: false });
      expect((await readArtifact(j.directory, result.details.artifact!)).toString()).toBe("汉".repeat(1000));
      const read = (await CoreTools.create(dir, j, {})).definitions().find(t => t.tool.name === "read")!;
      const continued = await read.tool.execute("read", { path: `artifact:${result.details.artifact!.sha256}`, offset: 99, limit: 99 });
      expect(continued.details).toHaveProperty("nextOffset", 198);
    } finally { await j.close(); }
  });
  it("saves failed HTTP evidence, redacts secrets and replays/imports without requests", async () => {
    const net = fixture(() => html("fixture-secret failure", { status: 404 })); const { dir, j, call } = await setup(net);
    await j.append("tool.requested", { name: "web_fetch", args: { url: "https://example.com" } }, { runId: "run", toolCallId: "fetch" });
    await expect(call()).rejects.toThrow("HTTP 404");
    await j.append("tool.failed", { item: { output: "HTTP 404" }, details: {} }, { runId: "run", toolCallId: "fetch" });
    const event = j.events.find(e => e.type === "fetch.finished")!;
    expect((await readArtifact(j.directory, (event.payload as any).response)).toString()).toBe("[REDACTED] failure");
    await j.close();
    const bundle = join(dir, "bundle"); await exportSession(j.directory, { format: "bundle", output: bundle });
    const imported = join(dir, "imported"); await importBundle(bundle, imported);
    const snapshot = await readSession(imported); const projection = new SessionProjection(imported); await projection.update(snapshot.events);
    const row = projection.page().rows.find(r => r.title === "web_fetch")!;
    expect(row.status).toBe("failed"); expect(row.details).toHaveProperty("statusCode", 404); expect(row.refs.length).toBeGreaterThan(0);
    expect(net.request).toHaveBeenCalledTimes(1);
  });
  it.each(["utf-16le", "utf-16be"])("redacts %s response evidence on success, HTTP failure and cancellation, including exports", async charset => {
    const bytes = Buffer.from('<p>fixture-secret</p>', "utf16le");
    if (charset === "utf-16be") bytes.swap16();
    for (const mode of ["success", "failed", "cancelled"] as const) {
      const ac = new AbortController(); let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({ pull(controller) {
        if (++pulls === 1) controller.enqueue(bytes.subarray(0, 17));
        else if (pulls === 2) controller.enqueue(bytes.subarray(17));
        else if (mode === "cancelled") ac.abort();
        else controller.close();
      } }, { highWaterMark: 0 });
      const { j, dir, call } = await setup(fixture(() => new Response(stream, { status: mode === "failed" ? 404 : 200, headers: { "content-type": `text/html; charset=${charset}` } })));
      try {
        if (mode === "success") expect((await call(undefined, ac.signal)).content[0]!.text).toContain("REDACTED");
        else await expect(call(undefined, ac.signal)).rejects.toThrow(mode === "failed" ? "404" : "取消");
        const details = j.events.at(-1)!.payload as any;
        expect(details).toMatchObject({ responseCharset: charset, responseEncoding: "utf-8", byteCount: bytes.length });
        expect(details.response.redacted).toBe(true);
        expect((await readArtifact(j.directory, details.response)).toString()).toBe('<p>[REDACTED]</p>');
      } finally { await j.close(); }
      const output = join(dir, "bundle"); await exportSession(j.directory, { format: "bundle", output });
      for (const file of await readdir(join(output, "artifacts"))) {
        const saved = await readFile(join(output, "artifacts", file));
        expect(saved.includes(Buffer.from("fixture-secret"))).toBe(false);
        expect(saved.includes(Buffer.from("fixture-secret", "utf16le"))).toBe(false);
        expect(saved.includes(Buffer.from("fixture-secret", "utf16le").swap16())).toBe(false);
      }
    }
  });
  it("omits response bytes for an unknown charset instead of persisting unredactable content", async () => {
    const { j, call } = await setup(fixture(() => new Response(Buffer.from("fixture-secret", "utf16le"), { headers: { "content-type": "text/plain; charset=unsupported" } })));
    try {
      await expect(call()).rejects.toThrow("字符编码");
      expect(j.events.at(-1)!.payload).toHaveProperty("responseOmitted");
      expect(j.events.at(-1)!.payload).not.toHaveProperty("response");
      expect(await readdir(join(j.directory, "artifacts"))).toEqual([]);
    } finally { await j.close(); }
  });
  it("is available without search and contributes untrusted-source guidance", async () => {
    const { j, tools } = await setup(fixture(() => html("Hello")));
    try {
      expect(tools.some(t => t.tool.name === "web_search")).toBe(false);
      const tool = tools.find(t => t.tool.name === "web_fetch")!;
      expect(tool.guidance.join(" ")).toContain("untrusted");
      expect((await tool.tool.execute("call", { url: "https://example.com" })).content[0]).toMatchObject({ type: "text" });
      expect(j.events.some(e => e.type === "attempt.started")).toBe(false);
    } finally { await j.close(); }
  });
  it("cancels DNS without a late connection, retains partial bytes on cancel and reports timeout", async () => {
    let complete!: (value: typeof publicIP) => void;
    const net = fixture(() => html("late")); net.resolve = () => new Promise(resolve => complete = resolve);
    const { j, call } = await setup(net); const ac = new AbortController();
    try {
      const pending = call(undefined, ac.signal); const rejected = expect(pending).rejects.toThrow("取消");
      await vi.waitFor(() => expect(complete).toBeDefined()); ac.abort(); await rejected; complete(publicIP);
      expect(net.request).not.toHaveBeenCalled();
      const cancelRead = new AbortController(); let reads = 0;
      const stream = new ReadableStream<Uint8Array>({ pull(controller) {
        if (++reads === 1) controller.enqueue(Buffer.from("partial"));
        else cancelRead.abort();
      } }, { highWaterMark: 0 });
      await expect(webFetch(j, {}, "https://example.com", { network: fixture(() => new Response(stream, { headers: { "content-type": "text/plain" } })) }, cancelRead.signal)).rejects.toThrow("取消");
      const last = j.events.at(-1)!.payload as any; expect(last.byteCount).toBe(7); expect(last.status).toBe("cancelled");
      expect((await readArtifact(j.directory, last.response)).toString()).toBe("partial");
      const slow = fixture(() => html("never")); slow.resolve = () => new Promise(() => {});
      await expect(webFetch(j, {}, "https://example.com", { timeoutMs: 30, network: slow })).rejects.toThrow("超时");
      expect((j.events.at(-1)!.payload as any).status).toBe("failed");
      expect(slow.request).not.toHaveBeenCalled();
    } finally { await j.close(); }
  });
  it("real HTTP transport decompresses gzip/deflate once, enforces decoded cap and sends no credentials", async () => {
    const requests: any[] = [];
    const server = createServer((req, res) => {
      requests.push(req.headers);
      const compress = req.url === "/deflate" ? deflateSync : gzipSync;
      const data = compress(Buffer.from("compressed body ".repeat(1000)));
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": req.url === "/deflate" ? "deflate" : "gzip", "content-length": data.length }); res.end(data);
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as any).port;
    // Exercise the real pinned transport via a fixture connector after normal public target validation.
    const net: FetchNetwork = { resolve: async () => publicIP, request: (url, _addresses, active) => fetchNetwork.request(new URL(`http://fixture.invalid:${port}${url.pathname}`), [{ address: "127.0.0.1", family: 4 }], active) };
    const { j, call } = await setup(net, { maxResponseBytes: 1000 });
    try {
      for (const path of ["gzip", "deflate"]) {
        const result = await call(`https://example.com/${path}`);
        expect(result.details).toMatchObject({ byteCount: 1000, bodyTruncated: true });
        expect((await readArtifact(j.directory, result.details.artifact!)).toString()).toContain("compressed body");
      }
      expect(requests.every(h => !h.authorization && !h.cookie && !h["x-api-key"])).toBe(true);
    } finally { await j.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
