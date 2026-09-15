import { describe, it, expect, vi, afterEach } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execute }));
import { readSystemProxy } from "../src/web-fetch/proxy.js";
afterEach(() => execute.mockReset());
describe("system proxy detection boundaries", () => {
  it("reads macOS static settings with a timeout and bounded output", async () => {
    execute.mockImplementation((_file, _args, _options, done) => done(null, "<dictionary> {\nHTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : 1082\n}"));
    const signal = new AbortController().signal;
    expect(await readSystemProxy("darwin", signal)).toMatchObject({ source: "system", httpProxy: "http://127.0.0.1:1082/" });
    expect(execute.mock.calls[0]?.slice(0, 3)).toEqual(["/usr/sbin/scutil", ["--proxy"], { signal, timeout: 2000, maxBuffer: 65536, encoding: "utf8", windowsHide: true }]);
  });
  it("reads Windows current-user static settings without loading a PowerShell profile", async () => {
    execute.mockImplementation((_file, _args, _options, done) => done(null, JSON.stringify({ ProxyEnable: 1, ProxyServer: "localhost:1082" })));
    expect(await readSystemProxy("win32", new AbortController().signal)).toMatchObject({ source: "system", httpsProxy: "http://localhost:1082/" });
    expect(execute.mock.calls[0]?.[1]).toContain("-NoProfile");
    expect(execute.mock.calls[0]?.[1].at(-1)).toContain("HKCU:");
  });
  it("suppresses raw subprocess failures instead of leaking settings or falling back", async () => {
    execute.mockImplementation((_file, _args, _options, done) => done(new Error("http://secret-user:secret-pass@proxy.invalid")));
    await expect(readSystemProxy("darwin", new AbortController().signal)).rejects.toMatchObject({ code: "PROXY_DETECTION", message: expect.not.stringContaining("secret-pass") });
  });
  it("propagates cancellation to the process and does not accept a late result", async () => {
    const controller = new AbortController();
    execute.mockImplementation((_file, _args, options, done) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort(new Error("cancelled")); done(null, "<dictionary> {}");
    });
    await expect(readSystemProxy("darwin", controller.signal)).rejects.toThrow("cancelled");
  });
});
