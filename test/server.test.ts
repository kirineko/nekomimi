import { it, expect, afterEach } from "vitest";
import { join, resolve } from "node:path";
import { writeFile, symlink, readFile } from "node:fs/promises";
import { startWeb } from "../src/server/app.js";
import { Journal, hash } from "../src/journal.js";
import {
  temporary,
  key,
  response,
  textItem,
  callItem,
  delay,
  reasoning,
} from "./helpers.js";
import { parseSubmit } from "../src/shared/protocol.js";
const apps: Awaited<ReturnType<typeof startWeb>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
async function setup(
  fetch?: typeof globalThis.fetch,
  apiKey: string | undefined = key,
) {
  const workspace = await temporary();
  const app = await startWeb({
    workspace,
    apiKey,
    staticDir: resolve("dist/web-dist"),
    runtime: {
      fetch: fetch ?? (async () => response([textItem()])),
      maxTurns: 4,
    },
  });
  apps.push(app);
  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    globalThis.fetch(app.origin + "/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${app.token}`,
        origin: app.origin,
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const create = async () =>
    (
      await request("/sessions", { version: 1, title: "测试会话" })
    ).json() as Promise<{ id: string }>;
  return { app, request, create, workspace };
}
async function finish(app: Awaited<ReturnType<typeof startWeb>>) {
  await app.sessions.active?.done;
}
it("validates protocol and rejects unsupported versions", () => {
  expect(() =>
    parseSubmit({ version: 2, commandId: "x", prompt: "hi" }),
  ).toThrow("协议");
  expect(() =>
    parseSubmit({ version: 1, commandId: "../x", prompt: "hi" }),
  ).toThrow();
});
it("starts static app, protects requests and persists refresh cookie", async () => {
  const { app, request, create } = await setup();
  expect((await fetch(app.origin)).status).toBe(200);
  expect((await fetch(app.origin + "/api/v1/config")).status).toBe(401);
  expect(
    (
      await request(
        "/sessions",
        { version: 1, title: "x" },
        { origin: "https://example.com" },
      )
    ).status,
  ).toBe(403);
  const connect = await request("/connect", {});
  const cookie = connect.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(
    (
      await fetch(app.origin + "/api/v1/config", {
        headers: { cookie: cookie.split(";")[0]! },
      })
    ).status,
  ).toBe(200);
  const { id } = await create();
  expect(
    (await request(`/sessions/${id}/artifacts/${"a".repeat(64)}`)).status,
  ).toBe(404);
});
it("deduplicates submissions and rejects changed payloads while retaining original history", async () => {
  let calls = 0;
  const { app, request, create } = await setup(async () => {
    calls++;
    await delay(50);
    return response([reasoning, textItem()]);
  });
  const { id } = await create();
  const command = { version: 1, commandId: "once", prompt: "hello" };
  const replies = await Promise.all([
    request(`/sessions/${id}/submit`, command),
    request(`/sessions/${id}/submit`, command),
  ]);
  expect(replies.map((r) => r.status)).toEqual([202, 202]);
  const receipts = await Promise.all(replies.map((r) => r.json()));
  expect(receipts[0].runId).toBe(receipts[1].runId);
  await finish(app);
  expect(calls).toBe(1);
  expect(
    (
      await request(`/sessions/${id}/submit`, {
        ...command,
        prompt: "different",
      })
    ).status,
  ).toBe(409);
  expect(
    (await (await request(`/sessions/${id}/submit`, command)).json()).status,
  ).toBe("completed");
  expect(calls).toBe(1);
  const snapshot = await (await request(`/sessions/${id}/snapshot`)).json();
  expect(snapshot.rows.some((r: any) => r.text.includes("done"))).toBe(true);
});
it("keeps work alive across reader disconnect, isolates cancel IDs and rejects concurrent runs", async () => {
  const { app, request, create } = await setup(
    async (_u, init) =>
      await new Promise<Response>((_r, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("cancel")),
          { once: true },
        ),
      ),
  );
  const { id } = await create();
  const other = await create();
  const receipt = await (
    await request(`/sessions/${id}/submit`, {
      version: 1,
      commandId: "run",
      prompt: "wait",
    })
  ).json();
  expect(
    (
      await request(`/sessions/${other.id}/submit`, {
        version: 1,
        commandId: "two",
        prompt: "wait",
      })
    ).status,
  ).toBe(409);
  await request(`/sessions/${id}/cancel`, { version: 1, runId: "old" });
  expect(app.sessions.active?.cancelling).toBe(false);
  const snap = await (await request(`/sessions/${id}/snapshot`)).json();
  const abort = new AbortController();
  const stream = await fetch(
    `${app.origin}/api/v1/sessions/${id}/events?seq=${snap.cursor.seq}&hash=${snap.cursor.hash}`,
    { headers: { authorization: `Bearer ${app.token}` }, signal: abort.signal },
  );
  expect(stream.status).toBe(200);
  abort.abort();
  expect(app.sessions.active).toBeTruthy();
  await request(`/sessions/${id}/cancel`, { version: 1, runId: receipt.runId });
  await finish(app);
  expect(
    (await (await request(`/sessions/${id}/snapshot`)).json()).session.status,
  ).toBe("cancelled");
});
it("rejects unavailable credentials before accepting work", async () => {
  const { request, create } = await setup(undefined, "");
  const { id } = await create();
  expect(
    (
      await request(`/sessions/${id}/submit`, {
        version: 1,
        commandId: "x",
        prompt: "hi",
      })
    ).status,
  ).toBe(422);
});
it("follows durable cursor without gaps and resets invalid cursor", async () => {
  const { app, request, create } = await setup();
  const { id } = await create();
  const snapshot = await (await request(`/sessions/${id}/snapshot`)).json();
  await request(`/sessions/${id}/submit`, {
    version: 1,
    commandId: "x",
    prompt: "hi",
  });
  await finish(app);
  const controller = new AbortController();
  const result = await fetch(
    `${app.origin}/api/v1/sessions/${id}/events?seq=${snapshot.cursor.seq}&hash=${snapshot.cursor.hash}`,
    {
      headers: { authorization: `Bearer ${app.token}` },
      signal: controller.signal,
    },
  );
  const reader = result.body!.getReader();
  const bytes = await reader.read();
  expect(new TextDecoder().decode(bytes.value)).toContain("done");
  controller.abort();
  const invalid = await request(`/sessions/${id}/events?seq=999&hash=bad`);
  expect(await invalid.text()).toContain("event: reset");
});
it("exports without side effects, checks integrity and rejects workspace symlinks", async () => {
  let calls = 0;
  const { app, request, create, workspace } = await setup(async () => {
    calls++;
    return calls === 1
      ? response([callItem("write", { path: "a.txt", content: "hello" })])
      : response([textItem("<script>bad</script> private")]);
  });
  const { id } = await create();
  await request(`/sessions/${id}/submit`, {
    version: 1,
    commandId: "x",
    prompt: "write",
  });
  await finish(app);
  const entry = await app.sessions.entry(id);
  const before = await readFile(join(entry.directory, "journal.jsonl"));
  const html = await request(`/sessions/${id}/export`, {
    version: 1,
    format: "html",
    redact: ["private"],
  });
  expect(html.status).toBe(200);
  const text = await html.text();
  expect(text).not.toContain("<script>");
  expect(text).not.toContain("private");
  expect(calls).toBe(2);
  expect(await readFile(join(entry.directory, "journal.jsonl"))).toEqual(
    before,
  );
  const ref = (
    entry.reader.events.find((e) => e.type === "request.dispatched")!
      .payload as any
  ).body;
  expect(
    (await request(`/sessions/${id}/artifacts/${ref.sha256}?offset=0&limit=10`))
      .status,
  ).toBe(200);
  await writeFile(join(entry.directory, "artifacts", ref.sha256), "corrupt");
  expect(
    (await request(`/sessions/${id}/artifacts/${ref.sha256}`)).status,
  ).toBe(409);
  const outside = await temporary();
  await symlink(outside, join(workspace, ".harness", "sessions", "escape"));
  expect((await request("/sessions/escape/snapshot")).status).toBe(404);
});
it("does not rerun a persisted accepted command after restart", async () => {
  const { app, request, create } = await setup();
  const { id } = await create();
  const dir = (await app.sessions.entry(id)).directory;
  const j = await Journal.open(dir);
  await j.append(
    "command.accepted",
    {
      commandId: "crashed",
      payloadHash: hash(JSON.stringify({ prompt: "hi" })),
    },
    { runId: "old-run" },
  );
  await j.append(
    "tool.intent",
    { name: "write" },
    { runId: "old-run", toolCallId: "x" },
  );
  await j.close();
  const receipt = await (
    await request(`/sessions/${id}/submit`, {
      version: 1,
      commandId: "crashed",
      prompt: "hi",
    })
  ).json();
  expect(receipt.status).toBe("interrupted");
  expect(app.sessions.active).toBeUndefined();
});
it("does not rerun a command after an actual killed tool write", async () => {
  if (process.platform === "win32") return;
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const workspace = await temporary();
  const target = join(workspace, "effect.txt");
  const code = `import {startWeb} from ${JSON.stringify(pathToFileURL(resolve("dist/server/app.js")).href)};import {existsSync} from 'node:fs';
 const output=${JSON.stringify(callItem("write", { path: "effect.txt", content: "once" }))};
 const ev=[{type:'response.created',response:{id:'r',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:output},{type:'response.output_item.done',output_index:0,item:output},{type:'response.completed',response:{id:'r',status:'completed',output:[output],usage:{input_tokens:1,output_tokens:1}}}];
 const app=await startWeb({workspace:${JSON.stringify(workspace)},apiKey:'fixture',lockStaleMs:2000,runtime:{journalOptions:{lockStaleMs:2000,beforeIO:async(op)=>{if(op==='append'&&existsSync(${JSON.stringify(target)}))process.kill(process.pid,'SIGKILL');}},fetch:async()=>new Response(ev.map(e=>'data: '+JSON.stringify(e)+'\\n\\n').join(''),{headers:{'content-type':'text/event-stream'}})}});console.log(JSON.stringify({origin:app.origin,token:app.token}));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = new Promise<void>((r, reject) => {
    child.on("close", () => r());
    child.on("error", reject);
  });
  let output = "";
  const connection = await new Promise<{ origin: string; token: string }>(
    (r, reject) => {
      child.stdout.on("data", (b) => {
        output += b;
        if (output.includes("\n")) r(JSON.parse(output.split("\n")[0]!));
      });
      child.on("error", reject);
    },
  );
  const call = async (path: string, v: unknown) =>
    (
      await fetch(connection.origin + "/api/v1" + path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.token}`,
          origin: connection.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(v),
      })
    ).json();
  try {
    const session = await call("/sessions", { version: 1, title: "crash" });
    await call(`/sessions/${session.id}/submit`, {
      version: 1,
      commandId: "kill",
      prompt: "write",
    });
    await stopped;
    expect(await readFile(target, "utf8")).toBe("once");
    await delay(3300);
    let calls = 0;
    const restored = await startWeb({
      workspace,
      apiKey: key,
      lockStaleMs: 2000,
      runtime: {
        fetch: async () => {
          calls++;
          return response([textItem()]);
        },
      },
    });
    apps.push(restored);
    const receipt = await restored.sessions.submit(session.id, {
      version: 1,
      commandId: "kill",
      prompt: "write",
    });
    expect(receipt.status).toBe("interrupted");
    expect(calls).toBe(0);
    expect(await readFile(target, "utf8")).toBe("once");
  } finally {
    child.kill("SIGKILL");
  }
}, 15000);
it("enforces root lease, recovers managed listing and refuses foreign workspace metadata", async () => {
  const { app, create, workspace, request } = await setup();
  const { id } = await create();
  await expect(startWeb({ workspace })).rejects.toThrow();
  const other = join(app.sessions.root, "foreign");
  const j = await Journal.open(other);
  await j.append("session.created", { workspace: "/different-workspace" });
  await j.close();
  expect((await request("/sessions/foreign/snapshot")).status).toBe(403);
  await app.close();
  apps.splice(apps.indexOf(app), 1);
  const restarted = await startWeb({ workspace });
  apps.push(restarted);
  expect(
    (await restarted.sessions.list(0, 30)).sessions.some((s) => s.id === id),
  ).toBe(true);
});
it("disconnects a saturated subscriber without blocking the runtime", async () => {
  const { app, create } = await setup();
  const { id } = await create();
  const entry = await app.sessions.entry(id);
  const { subscribe } = await import("../src/server/stream.js");
  let destroyed = false;
  const fake = {
    writableLength: 3 * 1024 * 1024,
    writeHead() {},
    flushHeaders() {},
    on() {},
    destroy() {
      destroyed = true;
    },
    end() {},
    write() {
      throw new Error("must not enqueue more");
    },
  };
  await subscribe(
    fake as any,
    app.sessions,
    id,
    entry.reader.cursor.seq,
    entry.reader.cursor.hash,
    new AbortController().signal,
  );
  expect(destroyed).toBe(true);
});

it("pages the full run trace independently of the visible history and includes readable context", async () => {
  const { app, request, create } = await setup();
  const { id } = await create();
  const journal = await Journal.open((await app.sessions.entry(id)).directory);
  for (let i = 0; i < 85; i++)
    await journal.append(
      "context.add",
      { source: "user", item: { role: "user", content: `message ${i}` } },
      { runId: "long-run" },
    );
  await journal.append(
    "context.add",
    { source: "user", item: { role: "user", content: "other run" } },
    { runId: "other-run" },
  );
  await journal.append(
    "tool.requested",
    { name: "write", args: { path: "unknown.txt" } },
    { runId: "abandoned", toolCallId: "unknown" },
  );
  await journal.close();
  const unknown = await (
    await request(`/sessions/${id}/trace?run=abandoned`)
  ).json();
  expect(unknown.rows[0].status).toBe("interrupted");
  expect(unknown.rows[0].text).toContain("结果未知");
  const first = await (
    await request(`/sessions/${id}/trace?run=long-run`)
  ).json();
  expect(first.total).toBe(85);
  expect(first.rows).toHaveLength(40);
  expect(first.rows[0].text).toBe("message 0");
  const second = await (
    await request(`/sessions/${id}/trace?run=long-run&offset=${first.next}`)
  ).json();
  expect(second.rows[0].text).toBe("message 40");
  const last = await (
    await request(`/sessions/${id}/trace?run=long-run&offset=${second.next}`)
  ).json();
  expect(last.rows).toHaveLength(5);
  expect(last.next).toBeUndefined();
  expect(
    (await request(`/sessions/${id}/trace?run=long-run&offset=-1`)).status,
  ).toBe(400);
  expect((await request(`/sessions/${id}/trace`)).status).toBe(400);
});
