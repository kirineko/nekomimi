import { expect, it, vi } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { McpOAuth } from "../src/customization/mcp-oauth.js";
import { McpConnection } from "../src/customization/mcp.js";
import { temporary } from "./helpers.js";
import {oauthFixture as fixture} from "./fixtures/oauth-server.js";
it("binds loopback callbacks, persists private tokens and refreshes once across concurrent clients after restart", async () => {
  const f = await fixture(), home = await temporary(), oauth = new McpOAuth(home);
  try {
    const callback = await f.authorize(oauth), wrong = new URL(callback); wrong.searchParams.set("state", "wrong");
    expect((await fetch(wrong)).status).toBe(400); expect(f.counts().grants).toBe(0);
    const result = await fetch(callback); expect(result.status).toBe(200); await result.text();
    expect(f.counts().grants).toBe(1); expect(JSON.stringify(await oauth.describe(f.resource))).not.toContain("secret");
    oauth.close();
    const one = new McpOAuth(home), two = new McpOAuth(home);
    const tokens = await Promise.all([one.token(f.resource), two.token(f.resource), one.token(f.resource)]);
    expect(tokens).toEqual(["refreshed-secret", "refreshed-secret", "refreshed-secret"]); expect(f.counts().refreshes).toBe(1);
    const file = join(home, "mcp-auth", (await readdir(join(home, "mcp-auth"))).find(p => p.endsWith(".json"))!);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toContain("refresh-secret");
    await expect(one.token({ ...f.resource, id: "different-server" })).rejects.toThrow("authorization required");
    const connection = new McpConnection(f.resource, await temporary(), one);
    try { await connection.connect(); expect(connection.serverInfo?.name).toBe("oauth-fixture"); expect(connection.clean("refreshed-secret")).toBe("[REDACTED]"); }
    finally { await connection.close(); }
    await one.disconnect(f.resource); expect((await two.describe(f.resource)).status).toBe("disconnected");
    await expect(two.token(f.resource)).rejects.toThrow("authorization required");
    expect(await readFile(file, "utf8")).not.toContain("secret");
    await expect(fetch(callback)).rejects.toThrow();
    one.close(); two.close();
  } finally { oauth.close(); await f.close(); }
});
it("rejects expired callbacks and issuer endpoint substitution without token exchange", async () => {
  const f = await fixture(), oauth = new McpOAuth(await temporary());
  try {
    const callback = await f.authorize(oauth), now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60_000);
    try { expect((await fetch(callback)).status).toBe(400); } finally { clock.mockRestore(); }
    expect(f.counts().grants).toBe(0); await oauth.disconnect(f.resource);
    f.malicious(); await expect(oauth.begin(f.resource)).rejects.toThrow("outside authorized issuer");
    expect(f.counts().grants).toBe(0);
  } finally { oauth.close(); await f.close(); }
});
it("clears invalid refresh credentials and exposes a generic reauthorization state", async () => {
  const f = await fixture(), oauth = new McpOAuth(await temporary());
  try {
    const callback = await f.authorize(oauth); await (await fetch(callback)).text(); f.failRefresh();
    await expect(oauth.token(f.resource)).rejects.toThrow("MCP OAuth refresh failed; reauthorization required");
    expect((await oauth.describe(f.resource)).status).toBe("reauthorize");
    await expect(oauth.token(f.resource)).rejects.toThrow("authorization required"); expect(f.counts().refreshes).toBe(1);
  } finally { oauth.close(); await f.close(); }
});

it("registers a bound public client dynamically and retains its identity for refresh after restart", async () => {
  const f = await fixture(), home = await temporary(), oauth = new McpOAuth(home);
  f.resource.config!.oauth = {issuer:f.resource.config!.oauth!.issuer, dynamicRegistration:true};
  try {
    const callback = await f.authorize(oauth); expect(callback.pathname).toBe('/oauth/callback');
    expect((await fetch(callback)).status).toBe(200); expect(f.counts().registrations).toBe(1);
    oauth.close(); const restarted = new McpOAuth(home);
    try { expect(await restarted.token(f.resource)).toBe('refreshed-secret'); expect((await restarted.describe(f.resource)).clientId).toBe('fixture-public'); }
    finally {restarted.close();}
  } finally {oauth.close(); await f.close();}
});
it('refuses a server without S256 instead of falling back to a weaker authorization flow',async()=>{
 const f=await fixture(),oauth=new McpOAuth(await temporary());f.unsupported();
 try{await expect(oauth.begin(f.resource)).rejects.toThrow('S256');expect(f.counts().grants).toBe(0);expect((await oauth.describe(f.resource)).status).toBe('disconnected');}finally{oauth.close();await f.close();}
});
