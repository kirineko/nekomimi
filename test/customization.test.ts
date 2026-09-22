import { describe, it, expect } from "vitest";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { temporary, key, response, callItem, textItem } from "./helpers.js";
import {
  CustomizationHost,
  validateExtension,
} from "../src/customization/host.js";
import { Resources } from "../src/customization/resources.js";
import { checkManifest } from "../src/customization/types.js";
import { run } from "../src/runtime.js";
import { readSession } from "../src/journal.js";
async function fixture() {
  const workspace = await temporary();
  const home = await temporary();
  const root = join(workspace, ".nekomimi/extensions/test");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "extension.json"),
    JSON.stringify({
      name: "test",
      sdkVersion: 1,
      entry: "index.ts",
      requiredCapabilities: ["tools", "commands"],
    }),
  );
  return { workspace, home, root };
}
async function enable(host: CustomizationHost) {
  const r = (await host.catalog.discover()).find(
    (r) => r.kind === "extension",
  )!;
  await host.catalog.decide(
    r.id,
    true,
    true,
    (await host.catalog.decisions()).revision,
  );
  return r;
}
const source = `export default api => { api.registerTool({ name:'greet', description:'Greeting', parameters:{type:'object',properties:{}}, async execute(args,ctx) { await ctx.state.set('used',1,true); return {content:[{type:'text',text:'hello'}]}; }}); api.registerCommand('review',{description:'Review',async handler(args,ctx) { const r = await ctx.callTool('ext_test_greet',{}); await ctx.ui({kind:'card',title:'Review',text:r.content[0].text}); return 'reviewed'; }}); }`;
describe("customization lifecycle", () => {
  it("rejects future SDK capabilities", () => {
    expect(() =>
      checkManifest({
        name: "future",
        sdkVersion: 1,
        entry: "a.ts",
        requiredCapabilities: ["provider"],
      }),
    ).toThrow("Unsupported");
  });
  it("does not execute untrusted factories and retains previous revision on bad reload", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "index.ts"), source);
    const host = new CustomizationHost(f.workspace, f.home);
    try {
      expect((await host.acquire()).extensions).toHaveLength(0);
      await host.release();
      await enable(host);
      const r = host.requestReload();
      await host.reload(r);
      expect(r.status).toBe("activated");
      const revision = host.active!.revision;
      await writeFile(join(f.root, "index.ts"), "export default !!!");
      const bad = host.requestReload();
      await host.reload(bad);
      expect(bad.status).toBe("failed");
      expect(host.active!.revision).toBe(revision);
    } finally {
      await host.close();
    }
  });
  it("records extension commands, state and UI without model dispatch, reloads after run", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "index.ts"), source);
    const host = new CustomizationHost(f.workspace, f.home);
    await enable(host);
    const session = join(f.workspace, "session");
    try {
      const result = await run({
        ...f,
        customization: host,
        session,
        apiKey: key,
        prompt: "/review",
        fetch: async () => {
          throw new Error("Should not call model");
        },
      });
      expect(result.status).toBe("completed");
      expect(result.text).toBe("reviewed");
      const events = (await readSession(session)).events;
      expect(events.some((e) => e.type === "extension.state")).toBe(true);
      expect(events.some((e) => e.type === "extension.ui")).toBe(true);
      expect(events.findIndex((e) => e.type === "tool.intent")).toBeLessThan(
        events.findIndex((e) => e.type === "tool.completed"),
      );
      const reload = await run({
        ...f,
        customization: host,
        session,
        apiKey: key,
        prompt: "/reload",
      });
      expect(JSON.parse(reload.text).status).toBe("pending");
      expect(host.receipts.at(-1)!.status).toBe("activated");
    } finally {
      await host.close();
    }
  });
  it("loads scoped rules before modifying a nested file", async () => {
    const workspace = await temporary();
    const home = await temporary();
    await mkdir(join(workspace, "sub"));
    await writeFile(
      join(workspace, "sub/AGENTS.md"),
      "Always include the word scoped.",
    );
    let calls = 0;
    const bodies: any[] = [];
    const result = await run({
      workspace,
      home,
      session: join(workspace, "session"),
      apiKey: key,
      prompt: "write file",
      fetch: async (_u, init) => {
        bodies.push(JSON.parse(init!.body as string));
        calls++;
        return calls < 3
          ? response([
              callItem(
                "write",
                { path: "sub/a.txt", content: "scoped" },
                `c${calls}`,
              ),
            ])
          : response([textItem()]);
      },
    });
    expect(result.status).toBe("completed");
    expect(bodies[1].instructions).toContain("Always include");
    const events = (await readSession(result.session)).events;
    expect(
      events.filter(
        (e) => e.type === "tool.intent" && (e.payload as any).name === "write",
      ),
    ).toHaveLength(1);
  });
  it("discovers skills with override and rejects outside root reads", async () => {
    const workspace = await temporary();
    const home = await temporary();
    for (const dir of [
      join(home, "skills/check"),
      join(workspace, ".agents/skills/check"),
    ]) {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "SKILL.md"),
        "---\nname: check\ndescription: check code\n---\nDo the check.",
      );
    }
    const catalog = new Resources(workspace, home);
    const r = await catalog.discover();
    expect(r.find((r) => r.scope === "user")!.status).toBe("shadowed");
    const project = r.find((r) => r.scope === "project")!;
    await rm(project.path);
    await symlink(join(home, "skills/check/SKILL.md"), project.path);
    await expect(catalog.read(project)).rejects.toThrow("symlink");
  });
  it("static validation does not execute code", async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, "index.ts"),
      `throw new Error('executed'); export default api=>{};`,
    );
    const r = (await new Resources(f.workspace, f.home).discover())[0]!;
    expect(await validateExtension(r)).toEqual([]);
  });
});

it('loads the shipped SDK example and diagnoses missing imports without executing them', async () => {
  const { readFile } = await import('node:fs/promises');
  const f = await fixture();
  await writeFile(join(f.root, 'index.ts'), await readFile(new URL('../extension-docs/example.ts', import.meta.url), 'utf8'));
  const host = new CustomizationHost(f.workspace, f.home);
  try {
    await enable(host); const active = await host.acquire();
    expect(active.extensions[0]!.tools).toHaveLength(1); expect(active.extensions[0]!.commands.has('inspect')).toBe(true); await host.release();
    await writeFile(join(f.root, 'index.ts'), `import missing from './absent.js'; export default api=>{throw Error('must not execute')};`);
    const resource = (await host.catalog.discover()).find(r => r.kind === 'extension')!;
    expect(await validateExtension(resource)).toEqual([expect.stringContaining('Missing or invalid import')]);
  } finally { await host.close(); }
});
