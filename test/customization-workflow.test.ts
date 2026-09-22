import { it, expect } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { temporary, key, response, callItem, textItem } from "./helpers.js";
import { CustomizationHost } from "../src/customization/host.js";
import { run } from "../src/runtime.js";
import { readSession, hash } from "../src/journal.js";
it("creates a review extension through recorded model tools, then uses skills, rules and MCP across reload and restart", async () => {
  const workspace = await temporary();
  const home = await temporary();
  const session = join(workspace, "session");
  await mkdir(join(workspace, ".agents/skills/review"), { recursive: true });
  await writeFile(
    join(workspace, "AGENTS.md"),
    "Report only observed behavior.",
  );
  await writeFile(join(workspace, "target.txt"), "synthetic target");
  await mkdir(join(workspace, ".nekomimi"), { recursive: true });
  await writeFile(
    join(workspace, "mcp.mjs"),
    `import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:m.method==='tools/list'?{tools:[{name:'check',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:'checked'}]};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`,
  );
  await writeFile(
    join(workspace, ".nekomimi/mcp.json"),
    JSON.stringify({
      version: 1,
      servers: {
        review: {
          transport: "stdio",
          command: process.execPath,
          args: ["mcp.mjs"],
        },
      },
    }),
  );
  const source = `export default api=>{api.registerCommand('review',{description:'Review',async handler(_,ctx){const list=await ctx.callTool('resource_list',{});const skill=list.details.find(r=>r.kind==='skill');await ctx.callTool('resource_read',{id:skill.id}); await ctx.callTool('mcp_review_${hash("check").slice(0, 8)}',{}); const file=await ctx.callTool('read',{path:'target.txt'}); const value=(await ctx.state.get('count',1)??0)+1;await ctx.state.set('count',1,value);await ctx.ui({kind:'card',title:'Review',text:file.content[0].text});return 'review-'+value;}});}`;
  const outputs = [
    callItem('write', { path: '.agents/skills/review/SKILL.md', content: '---\nname: review\ndescription: Review checklist\n---\nCheck evidence first.' }, 'skill'),
    callItem(
      "write",
      {
        path: ".nekomimi/extensions/review/extension.json",
        content: JSON.stringify({
          name: "review",
          sdkVersion: 1,
          entry: "index.ts",
        }),
      },
      "manifest",
    ),
    callItem(
      "write",
      { path: ".nekomimi/extensions/review/index.ts", content: source },
      "source",
    ),
    callItem("customization_validate", {}, "validate"),
    textItem("ready"),
  ];
  let host = new CustomizationHost(workspace, home);
  try {
    const created = await run({
      workspace,
      home,
      customization: host,
      session,
      apiKey: key,
      prompt: "Create /review",
      fetch: async () => response([outputs.shift()!]),
    });
    expect(created.status).toBe("completed");
    expect(
      await readFile(
        join(workspace, ".nekomimi/extensions/review/index.ts"),
        "utf8",
      ),
    ).toBe(source);
    const resource = (await host.catalog.discover()).find(
      (r) => r.kind === "extension",
    )!;
    for (const r of (await host.catalog.discover()).filter((r) =>
      ["extension", "mcp"].includes(r.kind),
    ))
      await host.catalog.decide(
        r.id,
        true,
        true,
        (await host.catalog.decisions()).revision,
      );
    const receipt = host.requestReload();
    await host.reload(receipt);
    const invoke = () =>
      run({
        workspace,
        home,
        customization: host,
        session,
        apiKey: key,
        prompt: "/review",
        fetch: async () => {
          throw Error("No model needed");
        },
      });
    expect((await invoke()).text).toBe("review-1");
    const revision = host.active!.revision;
    await writeFile(
      join(workspace, ".nekomimi/extensions/review/index.ts"),
      source.replace("'review-'", "'updated-'"),
    );
    const reload = host.requestReload();
    await host.reload(reload);
    expect(host.active!.revision).not.toBe(revision);
    expect((await invoke()).text).toBe("updated-2");
    await host.close();
    host = new CustomizationHost(workspace, home);
    expect((await invoke()).text).toBe("updated-3");
    const events = (await readSession(session)).events;
    for (const type of [
      "resources.activated",
      "skill.loaded",
      "rule.loaded",
      "tool.intent",
      "tool.completed",
      "extension.ui",
    ])
      expect(events.some((e) => e.type === type)).toBe(true);
    await host.catalog.decide(
      resource.id,
      false,
      false,
      (await host.catalog.decisions()).revision,
    );
    const disabled = host.requestReload();
    await host.reload(disabled);
    expect((await invoke()).status).toBe("failed");
  } finally {
    await host.close();
  }
}, 30000);
