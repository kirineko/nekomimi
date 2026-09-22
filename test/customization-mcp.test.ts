import { it, expect } from "vitest";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporary } from "./helpers.js";
import { CustomizationHost } from "../src/customization/host.js";
import { McpConnection } from "../src/customization/mcp.js";
import type { Resource } from "../src/customization/resources.js";
function answer(m: any) {
  if (m.id === undefined) return undefined;
  if (m.method === "initialize")
    return {
      jsonrpc: "2.0",
      id: m.id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "fixture", version: "1" },
      },
    };
  if (m.method === "tools/list")
    return {
      jsonrpc: "2.0",
      id: m.id,
      result: m.params?.cursor
        ? {
            tools: [
              {
                name: "second",
                description: "second",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }
        : {
            tools: [
              {
                name: "echo",
                description: "echo",
                inputSchema: { type: "object", properties: {} },
              },
            ],
            nextCursor: "page2",
          },
    };
  if (m.method === "tools/call")
    return {
      jsonrpc: "2.0",
      id: m.id,
      result: {
        content: [
          { type: "text", text: "hello" },
          {
            type: "resource_link",
            uri: "https://example.com/not-fetched",
            name: "reference",
          },
        ],
        structuredContent: { ok: true },
      },
    };
}
it("supports HTTP pagination, preserved result and cancellation without replay", async () => {
  const workspace = await temporary();
  let calls = 0;
  let hang = false;
  let sse = false;
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
    const m = JSON.parse(raw);
    if (m.method === "tools/call") {
      calls++;
      if (hang) return;
    }
    const result = answer(m);
    if (result)
      res
        .writeHead(200, {
          "content-type": sse ? "text/event-stream" : "application/json",
        })
        .end(
          sse
            ? "event: message\ndata: " + JSON.stringify(result) + "\n\n"
            : JSON.stringify(result),
        );
    else res.writeHead(202).end();
  });
  await new Promise<void>((r, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", r);
  });
  const port = (server.address() as any).port;
  const resource = {
    id: "mcp:test",
    name: "test",
    config: { transport: "http", url: `http://127.0.0.1:${port}/mcp` },
  } as Resource;
  const m = new McpConnection(resource, workspace);
  try {
    await m.connect();
    expect(m.tools.map((t) => t.name)).toEqual(["echo", "second"]);
    const result = await m.call("echo", {}, new AbortController().signal);
    expect(result.details).toHaveProperty("structuredContent.ok", true);
    expect(result.content[1]).toHaveProperty(
      "text",
      expect.stringContaining("resource_link"),
    );
    sse = true;
    expect(
      (await m.call("echo", {}, new AbortController().signal)).details,
    ).toHaveProperty("structuredContent.ok", true);
    hang = true;
    const controller = new AbortController();
    const pending = m.call("echo", {}, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow("UNKNOWN");
    expect(calls).toBe(3);
  } finally {
    await m.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
it("loads stdio through trusted resources, separates stderr and discovers tools", async () => {
  const workspace = await temporary();
  const home = await temporary();
  await mkdir(join(workspace, ".nekomimi"));
  await writeFile(
    join(workspace, "server.mjs"),
    `import readline from 'node:readline'; const answer=${answer.toString()};console.error('fixture diagnostics');readline.createInterface({input:process.stdin}).on('line',l=>{const r=answer(JSON.parse(l));if(r)console.log(JSON.stringify(r));});`,
  );
  await writeFile(
    join(workspace, ".nekomimi/mcp.json"),
    JSON.stringify({
      version: 1,
      servers: {
        fixture: {
          transport: "stdio",
          command: process.execPath,
          args: ["server.mjs"],
        },
      },
    }),
  );
  const host = new CustomizationHost(workspace, home);
  const resource = (await host.catalog.discover()).find(
    (r) => r.kind === "mcp",
  )!;
  expect(resource.status).toBe("untrusted");
  await host.catalog.decide(resource.id, true, true, 0);
  try {
    const a = await host.acquire();
    expect(a.mcp[0]!.tools).toHaveLength(2);
    expect(a.mcp[0]!.diagnostic).toContain("fixture diagnostics");
    await host.release();
  } finally {
    await host.close();
  }
});

it("redacts credentials, rejects unsupported schemas and refreshes only between runs", async () => {
  const workspace = await temporary();
  const home = await temporary();
  await mkdir(join(workspace, ".nekomimi"));
  const secret = "synthetic-mcp-private-value";
  process.env.NEKOMIMI_TEST_MCP = secret;
  await writeFile(
    join(workspace, "server.mjs"),
    `import readline from 'node:readline'; const answer=${answer.toString()}; console.error(process.env.TOKEN); readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l); let r=answer(m); if(m.method==='tools/list') r={jsonrpc:'2.0',id:m.id,result:{tools:[{name:'bad',inputSchema:{type:'object',properties:{x:{$ref:'#/foo'}}}},{name:'echo',inputSchema:{type:'object',properties:{}}}]}}; if(m.method==='tools/call'){r.result.content=[{type:'text',text:process.env.TOKEN}]; console.log(JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'}));}if(r)console.log(JSON.stringify(r));});`,
  );
  await writeFile(
    join(workspace, ".nekomimi/mcp.json"),
    JSON.stringify({
      version: 1,
      servers: {
        fixture: {
          transport: "stdio",
          command: process.execPath,
          args: ["server.mjs"],
          env: { TOKEN: "NEKOMIMI_TEST_MCP" },
        },
      },
    }),
  );
  const host = new CustomizationHost(workspace, home);
  try {
    const r = (await host.catalog.discover()).find((r) => r.kind === "mcp")!;
    await host.catalog.decide(r.id, true, true, 0);
    const active = await host.acquire();
    const connection = active.mcp[0]!;
    expect(connection.tools.map((t) => t.name)).toEqual(["echo"]);
    expect(connection.toolErrors).toHaveLength(1);
    expect(connection.diagnostic).not.toContain(secret);
    const result = await connection.call(
      "echo",
      {},
      new AbortController().signal,
    );
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(connection.changed).toBe(true);
    expect(host.active).toBe(active);
    await host.release();
    expect(host.active).not.toBe(active);
  } finally {
    await host.close();
    delete process.env.NEKOMIMI_TEST_MCP;
  }
});

it("marks an executed then disconnected call unknown and kills a stubborn stdio child", async () => {
  const workspace = await temporary();
  await writeFile(
    join(workspace, "server.mjs"),
    `import readline from 'node:readline';const answer=${answer.toString()}; process.on('SIGTERM',()=>{});setInterval(()=>{},1000);readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='tools/call'){process.stdout.end();return;}const r=answer(m);if(r)console.log(JSON.stringify(r));});`,
  );
  const connection = new McpConnection(
    {
      id: "mcp:stuck",
      name: "stuck",
      config: {
        transport: "stdio",
        command: process.execPath,
        args: ["server.mjs"],
      },
    } as Resource,
    workspace,
  );
  try {
    await connection.connect();
    const pid = (connection.transport as any).pid;
    const signal = AbortSignal.timeout(100);
    await expect(connection.call("echo", {}, signal)).rejects.toThrow(
      "UNKNOWN",
    );
    expect(connection.stale).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    await connection.close();
  }
}, 15000);

it('reports HTTP authentication failure instead of marking the server connected', async () => {
  const server = createServer((_req, res) => res.writeHead(401).end('Unauthorized'));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as any).port;
  const connection = new McpConnection({ id: 'mcp:auth', name: 'auth', config: { transport: 'http', url: `http://127.0.0.1:${port}/mcp` } } as Resource, await temporary());
  try { await expect(connection.connect()).rejects.toThrow(); expect(connection.tools).toEqual([]); }
  finally { await connection.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
