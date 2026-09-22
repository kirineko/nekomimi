import { it, expect } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { temporary, key, response, textItem } from "./helpers.js";
import { Journal, readSession } from "../src/journal.js";
import { recordedTool } from "../src/customization/execution.js";
import { LIMITS, Resources } from "../src/customization/resources.js";
import { CustomizationHost } from "../src/customization/host.js";
import { run } from "../src/runtime.js";
import { trialExtension } from "../src/customization/trial.js";
async function setup(source: string) {
  const workspace = await temporary();
  const home = await temporary();
  const root = join(workspace, ".nekomimi/extensions/test");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "extension.json"),
    JSON.stringify({ name: "test", sdkVersion: 1, entry: "index.ts" }),
  );
  await writeFile(join(root, "index.ts"), source);
  const host = new CustomizationHost(workspace, home);
  const r = (await host.catalog.discover()).find(
    (r) => r.kind === "extension",
  )!;
  await host.catalog.decide(r.id, true, true, 0);
  return { workspace, home, root, host, id: r.id };
}
it("preserves full evidence for bounded model results and marks capture gaps", async () => {
  const dir = await temporary();
  const j = await Journal.open(dir);
  try {
    let bytes = 30000;
    const tool = recordedTool(
      {
        name: "test",
        label: "test",
        description: "test",
        parameters: Type.Object({}),
        execute: async () => ({
          content: [{ type: "text", text: "x".repeat(bytes) }],
          details: {},
        }),
      },
      j,
      {},
    );
    const result = await tool.execute("one", {});
    expect(result.content[0]).toHaveProperty(
      "text",
      expect.stringContaining("Truncated"),
    );
    expect(j.events.some((e) => e.type === "tool.completed")).toBe(true);
    bytes = LIMITS.result + 1;
    await expect(tool.execute("two", {})).rejects.toThrow("evidence limit");
    expect(j.events.some((e) => e.type === "tool.evidence_gap")).toBe(true);
  } finally {
    await j.close();
  }
});
it("guards user writes with authorization, version and paths", async () => {
  const workspace = await temporary();
  const home = await temporary();
  const resources = new Resources(workspace, home);
  await expect(
    resources.write("extension", "mine", "index.ts", "hello", null),
  ).rejects.toThrow("not authorized");
  await resources.allowUserWrites(true, 0);
  const a = await resources.write(
    "extension",
    "mine",
    "index.ts",
    "hello",
    null,
  );
  await expect(
    resources.write("extension", "mine", "index.ts", "replacement", null),
  ).rejects.toThrow("changed");
  await expect(
    resources.write("extension", "mine", "../../escape", "bad", null),
  ).rejects.toThrow("outside");
  await resources.write("extension", "mine", "index.ts", "updated", a.hash);
  expect(await readFile(a.path, "utf8")).toBe("updated");
});
it("reports cleanup failure and blocks subsequent runs", async () => {
  const f = await setup(
    `export default api=>{api.onDispose(()=>{throw Error('cannot clean')});}`,
  );
  try {
    await f.host.acquire();
    await f.host.release();
    const receipt = f.host.requestReload();
    await f.host.reload(receipt);
    expect(receipt.status).toBe("failed");
    expect(f.host.degraded).toContain("cleanup");
    await expect(f.host.acquire()).rejects.toThrow("cleanup");
  } finally {
    await f.host.close().catch(() => {});
  }
});
it("retains state across runs and refuses a changed state schema", async () => {
  const f = await setup(
    `export default api=>{api.registerCommand('count',{description:'count',async handler(a,c){const n=await c.state.get('n',1)||0;await c.state.set('n',1,n+1);return String(n+1)}});}`,
  );
  const session = join(f.workspace, "session");
  try {
    expect(
      (
        await run({
          ...f,
          customization: f.host,
          session,
          apiKey: key,
          prompt: "/count",
        })
      ).text,
    ).toBe("1");
    await f.host.close();
    expect(
      (await run({ ...f, session, apiKey: key, prompt: "/count" })).text,
    ).toBe("2");
    await writeFile(
      join(f.root, "index.ts"),
      `export default api=>{api.registerCommand('count',{description:'count',async handler(a,c){await c.state.get('n',2);}});}`,
    );
    const result = await run({ ...f, session, apiKey: key, prompt: "/count" });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("incompatible");
  } finally {
    await f.host.close();
  }
});
it("trial uses mock services in a separate journal and headless form is unavailable", async () => {
  const f = await setup(
    `export default api=>{api.registerCommand('ask',{description:'ask',async handler(a,c){await c.callTool('write',{path:'must-not-exist',content:'bad'});return await c.model('check')}});}`,
  );
  try {
    const result = await trialExtension(f.workspace, f.home, f.id, "/ask");
    expect(result.text).toBe("Trial model response");
    await expect(
      readFile(join(f.workspace, "must-not-exist")),
    ).rejects.toThrow();
    await writeFile(
      join(f.root, "index.ts"),
      `export default api=>{api.registerCommand('ask',{description:'ask',async handler(a,c){await c.ui({kind:'form',title:'input',fields:[{name:'answer',label:'answer'}]})}});}`,
    );
    const r = await run({
      ...f,
      session: join(f.workspace, "session"),
      apiKey: key,
      prompt: "/ask",
    });
    expect(r.error).toContain("interaction_unavailable");
  } finally {
    await f.host.close();
  }
});
it("records auxiliary model attempts without mixing their messages into primary history", async () => {
  const f = await setup(
    `export default api=>{api.registerCommand('think',{description:'think',async handler(a,c){return await c.model('private helper context')}});}`,
  );
  let calls = 0;
  try {
    const r = await run({
      ...f,
      session: join(f.workspace, "session"),
      apiKey: key,
      prompt: "/think",
      retryDelayMs: 1,
      fetch: async () =>
        ++calls === 1
          ? new Response("retry", { status: 429 })
          : response([textItem("helper answer")]),
    });
    expect(r.text).toBe("helper answer");
    const events = (await readSession(r.session)).events;
    expect(events.filter((e) => e.type === "attempt.started")).toHaveLength(2);
    expect(
      events
        .filter((e) => e.type === "context.add")
        .some((e) => JSON.stringify(e.payload).includes("helper answer")),
    ).toBe(false);
    expect(
      events
        .filter((e) => e.type === "attempt.started")
        .every((e) => e.resourceId === f.id),
    ).toBe(true);
  } finally {
    await f.host.close();
  }
});
it("rejects same-scope collisions and duplicate tool registration", async () => {
  const f = await setup(
    `export default api=>{const t={name:'same',description:'x',parameters:{type:'object'},async execute(){return {content:[]}}};api.registerTool(t);api.registerTool(t);}`,
  );
  try {
    await expect(f.host.acquire()).rejects.toThrow("duplicate");
    const second = join(f.workspace, ".nekomimi/extensions/second");
    await mkdir(second);
    await writeFile(
      join(second, "extension.json"),
      JSON.stringify({ name: "test", sdkVersion: 1, entry: "index.ts" }),
    );
    await writeFile(join(second, "index.ts"), "export default api=>{}");
    expect(
      (await f.host.catalog.discover())
        .filter((r) => r.kind === "extension")
        .every((r) => r.status === "error"),
    ).toBe(true);
  } finally {
    await f.host.close();
  }
});
it("explicit skills load content and arguments and disabled tools withdraw prompt contributions", async () => {
  const f = await setup(
    `export default api=>{api.registerTool({name:'check',description:'UNIQUE_GUIDANCE',parameters:{type:'object'},async execute(){return {content:[]}}})}`,
  );
  const skill = join(f.workspace, ".agents/skills/check");
  await mkdir(skill, { recursive: true });
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: check\ndescription: review skill\n---\nSKILL_BODY_SENTINEL",
  );
  let body: any;
  try {
    let r = await run({
      ...f,
      session: join(f.workspace, "session"),
      apiKey: key,
      prompt: "/skill:check extra-argument",
      fetch: async (_u, init) => {
        body = JSON.parse(String(init?.body));
        return response([textItem()]);
      },
    });
    expect(r.status).toBe("completed");
    expect(body.instructions).toContain("SKILL_BODY_SENTINEL");
    expect(body.input[0].content[0].text).toContain("extra-argument");
    expect(body.instructions).toContain("UNIQUE_GUIDANCE");
    await f.host.catalog.decide(f.id, false, false, 1);
    r = await run({
      ...f,
      session: join(f.workspace, "session2"),
      apiKey: key,
      prompt: "hello",
      fetch: async (_u, init) => {
        body = JSON.parse(String(init?.body));
        return response([textItem()]);
      },
    });
    expect(body.instructions).not.toContain("UNIQUE_GUIDANCE");
    expect(body.instructions).not.toContain("SKILL_BODY_SENTINEL");
  } finally {
    await f.host.close();
  }
});
it("blocks front-hook errors, keeps post-hook errors separate and propagates cancellation", async () => {
  const f = await setup(
    `export default api=>{api.on('beforeTool',async()=>{throw Error('gate failed')});api.registerCommand('test',{description:'test',async handler(a,c){await c.callTool('write',{path:'no.txt',content:'no'});}});}`,
  );
  try {
    const a = await run({
      ...f,
      session: join(f.workspace, "a"),
      apiKey: key,
      prompt: "/test",
    });
    expect(a.error).toContain("gate failed");
    await expect(readFile(join(f.workspace, "no.txt"))).rejects.toThrow();
    await writeFile(
      join(f.root, "index.ts"),
      `export default api=>{api.on('afterTool',async()=>{throw Error('observer failed')});api.registerCommand('test',{description:'test',async handler(a,c){await c.callTool('write',{path:'yes.txt',content:'yes'});return 'done'}});}`,
    );
    const b = await run({
      ...f,
      session: join(f.workspace, "b"),
      apiKey: key,
      prompt: "/test",
    });
    expect(b.status).toBe("completed");
    expect(await readFile(join(f.workspace, "yes.txt"), "utf8")).toBe("yes");
    expect(
      (await readSession(b.session)).events.some(
        (e) => e.type === "extension.error",
      ),
    ).toBe(true);
    const c = new AbortController();
    c.abort();
    await expect(
      run({
        ...f,
        session: join(f.workspace, "c"),
        apiKey: key,
        prompt: "/test",
        signal: c.signal,
      }),
    ).resolves.toMatchObject({ status: "cancelled" });
  } finally {
    await f.host.close();
  }
});

it('retains a reported error result and distinguishes it from an unknown outcome', async () => {
  const journal = await Journal.open(await temporary());
  try {
    const result = { content: [{ type: 'text' as const, text: 'remote failure' }], details: { structuredContent: { reason: 'fixture' }, isError: true }, isError: true };
    const tool = recordedTool({ name: 'remote', label: 'remote', description: 'remote', parameters: Type.Object({}), execute: async () => result }, journal, {});
    await expect(tool.execute('call', {})).rejects.toThrow('Tool reported an error');
    const completed = journal.events.find(e => e.type === 'tool.completed')!;
    expect(completed).toBeDefined();
    expect(journal.events.find(e => e.type === 'tool.execution_error')!.payload).toMatchObject({ unknown: false });
  } finally { await journal.close(); }
});
