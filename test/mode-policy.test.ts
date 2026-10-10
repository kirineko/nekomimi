import { afterEach, expect, it } from "vitest";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../src/runtime.js";
import { CustomizationHost } from "../src/customization/host.js";
import { readSession } from "../src/journal.js";
import { startWeb } from "../src/server/app.js";
import { CREATION_TOOLS } from "../src/shared/mode-policy.js";
import { temporary, key, response, textItem, callItem } from "./helpers.js";
const cleanup: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const resource of cleanup.splice(0)) await resource.close(); });
const source = `export default (api: import('nekomimi/extensions').ExtensionAPI)=>{
 api.registerTool({name:'ordinary',description:'Project check',parameters:{type:'object'},async execute(){return {content:[{type:'text',text:'project checked'}]}}});
 api.registerTool({name:'author',modes:['create'],description:'Create-only check',parameters:{type:'object'},async execute(){return {content:[{type:'text',text:'author checked'}]}}});
 api.registerCommand('review',{description:'Review the project',async handler(_,ctx){return (await ctx.callTool('ext_modes_ordinary',{})).content.filter(c=>c.type==='text').map(c=>c.text).join('')}});
 api.registerCommand('create_command',{modes:['create'],description:'Create-only command',async handler(_,ctx){return (await ctx.callTool('ext_modes_author',{})).content.filter(c=>c.type==='text').map(c=>c.text).join('')}});
 api.registerCommand('nested',{description:'Try requested host tool',async handler(args,ctx){await ctx.callTool(args,{});return 'unexpected'}});
 api.registerCommand('reload_host',{description:'Try host reload',async handler(_,ctx){return JSON.stringify(ctx.reload())}});
 api.registerCommand('documents',{description:'Read an exact document',async handler(args,ctx){return JSON.stringify(await ctx.callTool('resource_read',{id:args}))}});
 api.registerCommand('resources',{description:'List pinned resources',async handler(_,ctx){return JSON.stringify((await ctx.callTool('resource_list',{})).details)}});
 api.registerCommand('user_write',{description:'Try user scope',async handler(_,ctx){await ctx.callTool('resource_write',{scope:'user',kind:'rule',name:'global',file:'AGENTS.md',text:'must not be granted',previousHash:null});return 'unexpected'}});
 api.registerWorkflow({id:'author_flow',modes:['create'],schemaVersion:1,inputSchema:{type:'object'},entry:'main',steps:{main:{transitions:[],async execute(){return {kind:'complete',output:'author flow'}}}},triggers:[{kind:'command',name:'author_flow'}]});
};`;
async function fixture() {
  const workspace = await temporary(), home = await temporary(), owner = await temporary();
  const root = join(workspace, ".nekomimi/extensions/modes"); await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "modes", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["tools", "commands", "workflows"] }));
  await writeFile(join(root, "index.ts"), source);
  const host = new CustomizationHost(workspace, home); cleanup.push(host);
  const resources = await host.catalog.discover(), resource = resources.find(resource => resource.kind === "extension")!;
  await host.catalog.decide(resource.id, true, true, 0);
  const create = { mode: "create" as const, ownerWorkspace: owner, target: { kind: "extension" as const, root: workspace } };
  return { workspace, home, owner, host, root, resource, create, doc: resources.find(resource => resource.kind === "doc")! };
}
it("sends only work capabilities while retaining project rules, skills and ordinary tools", async () => {
  const f = await fixture(); await writeFile(join(f.workspace, "AGENTS.md"), "PROJECT_RULE_REQUIRED");
  const skill = join(f.workspace, ".agents/skills/project"); await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "---\nname: project\ndescription: Project-specific skill\n---\nPROJECT_SKILL_BODY");
  let body: any;
  const result = await run({ ...f, customization: f.host, session: join(f.workspace, "work"), apiKey: key, prompt: "fix project", fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return response([textItem()]); } });
  expect(result.status, result.error).toBe("completed");
  const names = body.tools.map((tool: any) => tool.name);
  for (const name of CREATION_TOOLS) expect(names).not.toContain(name);
  expect(names).toContain("ext_modes_ordinary"); expect(names).not.toContain("ext_modes_author");
  expect(body.instructions).toContain("PROJECT_RULE_REQUIRED"); expect(body.instructions).toContain("Project-specific skill");
  expect(body.instructions).not.toContain("first read customization_sdk"); expect(body.instructions).not.toContain("Find installed SDK");
  expect(body.instructions).not.toContain("/modes:create_command"); expect(body.instructions).toContain("/modes:review");
});
it("keeps ordinary enabled review commands executable in work mode without a model request", async () => {
  const f = await fixture(); let calls = 0;
  const result = await run({ ...f, customization: f.host, session: join(f.workspace, "review"), apiKey: key, prompt: "/review", fetch: async () => { calls++; throw Error("must not call"); } });
  expect(result.status, result.error).toBe("completed"); expect(result.text).toBe("project checked"); expect(calls).toBe(0);
  expect(f.host.commands("work").commands.some(command => command.name === "/create_command")).toBe(false);
  expect(f.host.commands("create").commands.some(command => command.name === "/create_command")).toBe(true);
});
it.each([...CREATION_TOOLS, "ext_modes_author"])("rejects an actual nested RPC to %s before a tool intent", async name => {
  const f = await fixture(), session = join(f.workspace, "nested");
  const result = await run({ ...f, customization: f.host, session, apiKey: key, prompt: "/nested " + name });
  expect(result.status).toBe("failed"); expect(result.error).toContain("session mode");
  const events = (await readSession(session)).events;
  expect(events.some(event => event.type === "tool.intent" && (event.payload as { name?: string }).name === name)).toBe(false);
  expect(events.some(event => event.type === "tool.blocked" && (event.payload as { reason?: string }).reason === "mode")).toBe(true);
  expect(events.find(event => event.type === "extension.rpc.failed")?.payload).toMatchObject({ unknown: false, code: "mode_permission", effect: "not-dispatched" });
  expect(f.host.receipts).toHaveLength(0);
});
it.each(["/reload", "/reload_host", "/create_command", "/author_flow"])("rejects the work command %s through its real command path", async prompt => {
  const f = await fixture(), session = join(f.workspace, "command");
  const result = await run({ ...f, customization: f.host, session, apiKey: key, prompt });
  expect(result.status).toBe("failed"); expect(result.error).toMatch(/create mode|session mode/);
  expect(f.host.receipts).toHaveLength(0);
  expect((await readSession(session)).events.some(event => event.type === "operation.blocked")).toBe(true);
});
it("omits SDK documents from work discovery and refuses a known document ID before intent", async () => {
  const f = await fixture();
  const listed = await run({ ...f, customization: f.host, session: join(f.workspace, "list"), apiKey: key, prompt: "/resources" });
  expect(listed.status).toBe("completed"); expect(JSON.parse(listed.text).items.some((resource: any) => resource.kind === "doc")).toBe(false);
  const session = join(f.workspace, "doc");
  const blocked = await run({ ...f, customization: f.host, session, apiKey: key, prompt: "/documents " + f.doc.id });
  expect(blocked.status).toBe("failed"); expect(blocked.error).toContain("create mode");
  expect((await readSession(session)).events.some(event => event.type === "tool.intent")).toBe(false);
});
it("records a forged model call to a hidden creation tool and executes no creation side effect", async () => {
  const f = await fixture(), session = join(f.workspace, "forged-model"); let calls = 0;
  const result = await run({ ...f, customization: f.host, session, apiKey: key, prompt: "work", fetch: async () => response(++calls === 1 ? [callItem("customization_candidate", { action: "create", name: "forbidden" })] : [textItem()]) });
  expect(result.status, result.error).toBe("completed");
  const events = (await readSession(session)).events;
  expect(events.some(event => event.type === "tool.blocked" && (event.payload as { reason?: string }).reason === "mode")).toBe(true);
  expect(events.some(event => event.type === "tool.intent")).toBe(false);
  await expect(readdir(join(f.workspace, ".nekomimi/v2/candidates"))).rejects.toThrow();
});
it("offers creation tools and declared author capabilities only in the create request", async () => {
  const f = await fixture(); let body: any;
  const result = await run({ ...f, ...f.create, customization: f.host, session: join(f.workspace, "create"), apiKey: key, prompt: "develop", fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return response([textItem()]); } });
  expect(result.status, result.error).toBe("completed");
  expect(body.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining([...CREATION_TOOLS, "ext_modes_author"]));
  expect(body.instructions).toContain("first read customization_sdk");
  const command = await run({ ...f, ...f.create, customization: f.host, session: join(f.workspace, "create-command"), apiKey: key, prompt: "/create_command" });
  expect(command.status, command.error).toBe("completed"); expect(command.text).toBe("author checked");
});
it("does not grant user-directory writes merely because the session is create mode", async () => {
  const f = await fixture();
  const result = await run({ ...f, ...f.create, customization: f.host, session: join(f.workspace, "user-write"), apiKey: key, prompt: "/user_write" });
  expect(result.status).toBe("failed"); expect(result.error).toMatch(/authoriz|permission/i);
  await expect(readFile(join(f.home, "AGENTS.md"))).rejects.toThrow();
  expect((await f.host.catalog.decisions()).userWrites).not.toBe(true);
});
it("rejects forged work HTTP management requests and records the refusal", async () => {
  const f = await fixture(), app = await startWeb({ workspace: f.owner, home: f.home, apiKey: key, naming: false }); cleanup.push(app);
  const work = await app.sessions.create("work");
  const request = (value: unknown) => fetch(app.origin + "/api/v1/customization", { method: "POST", headers: { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" }, body: JSON.stringify(value) });
  for (const action of ["candidate-activate", "candidate-inspect", "package-activate", "reload", "validate", "user-writes", "authorize-version"]) {
    const response = await request({ action, sessionId: work.id, mode: "create", id: "forged", contentHash: "fake", authorize: true, enabled: true });
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: "mode_permission" } });
  }
  expect((await request({ action: "candidate-activate", mode: "create" })).status).toBe(403);
  expect(app.sessions.customization.receipts).toHaveLength(0);
  const catalog = await readSession(join(app.sessions.paths.root, "session-catalog"));
  expect(catalog.events.filter(event => event.type === "operation.blocked")).toHaveLength(8);
});
it("routes an authorized create management request to its bound development host", async () => {
  const f = await fixture(), app = await startWeb({ workspace: f.owner, home: f.home, apiKey: key, naming: false }); cleanup.push(app);
  const create = await app.sessions.create("create", { commandId: "create-api", mode: "create", target: f.create.target });
  const response = await fetch(app.origin + "/api/v1/customization", { method: "POST", headers: { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" }, body: JSON.stringify({ action: "validate", sessionId: create.id, id: f.resource.id }) });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ errors: [], report: { passed: true } });
  expect(app.sessions.customization.receipts).toHaveLength(0);
  expect((await readSession(join(app.sessions.root, create.id))).events.some(event => event.type === "request.dispatched")).toBe(false);
});
it("requires a persisted create identity for a new HTTP grant despite a forged mode", async () => {
  const f = await fixture();
  // The shared fixture is pretrusted; revoke it so this case actually requests a new grant.
  await f.host.catalog.decide(f.resource.id, false, false, (await f.host.catalog.decisions()).revision);
  const app = await startWeb({ workspace: f.workspace, home: f.home, apiKey: key, naming: false }); cleanup.push(app);
  const work = await app.sessions.create("work");
  const request = (value: unknown) => fetch(app.origin + "/api/v1/customization", { method: "POST", headers: { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" }, body: JSON.stringify(value) });
  const revision = (await app.sessions.customization.catalog.decisions()).revision;
  const blocked = await request({ action: "set", id: f.resource.id, enabled: true, trusted: true, revision, sessionId: work.id, mode: "create" });
  expect(blocked.status).toBe(403); expect(await blocked.json()).toMatchObject({ error: { code: "mode_permission" } });
  expect((await app.sessions.customization.catalog.decisions()).revision).toBe(revision);
  const development = await temporary();
  const root = join(development, ".nekomimi/extensions/modes"); await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), await readFile(join(f.root, "extension.json")));
  await writeFile(join(root, "index.ts"), source);
  const create = await app.sessions.create("create", { commandId: "grant-create", mode: "create", target: { kind: "extension", root: development } });
  const description = await app.sessions.describeCustomization(create.id);
  const resource = description.resources.find(resource => resource.kind === "extension")!;
  const granted = await request({ action: "set", id: resource.id, enabled: true, trusted: true, revision: description.settingsRevision, sessionId: create.id });
  expect(granted.status, JSON.stringify(await granted.json())).toBe(200);
  expect((await app.sessions.customization.catalog.decisions()).revision).toBe(revision);
});
it("rejects a create-only workflow in work mode and prevents changing the persisted workflow mode", async () => {
  const f = await fixture(), activation = await f.host.acquire();
  try {
    f.host.workflows.configure({ apiKey: key, mode: "work" });
    await expect(f.host.workflows.create(f.resource.id, "author_flow", {}, activation)).rejects.toThrow("session mode");
    expect(await f.host.workflows.list()).toHaveLength(0);
    f.host.workflows.configure({ apiKey: key, mode: "create" });
    const workflow = await f.host.workflows.create(f.resource.id, "author_flow", {}, activation);
    expect(workflow.mode).toBe("create");
    f.host.workflows.configure({ apiKey: key, mode: "work" });
    await expect(f.host.workflows.advance(workflow.id, { activation })).rejects.toThrow("mode cannot change");
    const history = await readSession(join(f.workspace, ".nekomimi/workflows", workflow.id));
    expect(history.events.some(event => event.type === "workflow.step.started")).toBe(false);
    expect(history.events.some(event => event.type === "tool.intent")).toBe(false);
  } finally { await f.host.release(); }
});
