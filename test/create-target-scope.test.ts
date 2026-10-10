import { afterEach, expect, it } from "vitest";
import { mkdir, readFile, readdir, symlink, writeFile, realpath } from "node:fs/promises";
import { join, dirname } from "node:path";
import { run } from "../src/runtime.js";
import { hash, readArtifact, readSession } from "../src/journal.js";
import { createSessionBinding, checkSessionTarget } from "../src/session/identity.js";
import { hostIdentity, sdkCatalog } from "../src/customization/sdk.js";
import { startWeb } from "../src/server/app.js";
import { temporary, key, response, textItem, callItem } from "./helpers.js";
const services: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); });
async function fixture(kind: "extension" | "core" = "extension") {
  const workspace = await temporary(), ownerWorkspace = await temporary(), home = await temporary(), session = join(await temporary(), "scope");
  return { workspace, ownerWorkspace, home, session, mode: "create" as const, target: { kind, root: workspace }, apiKey: key };
}
async function binding(f: Awaited<ReturnType<typeof fixture>>) {
  return createSessionBinding(f.ownerWorkspace, "scope-session", { commandId: "scope-create", mode: "create", target: f.target }, hash("scope"), f.home);
}
it("refuses an ancestor of the owner project and any current installation target before factories or model calls", async () => {
  const f = await fixture(), nested = join(f.workspace, "owner"); await mkdir(nested);
  let calls = 0;
  await expect(run({ ...f, ownerWorkspace: nested, prompt: "develop", fetch: async () => { calls++; return response([textItem()]); } })).rejects.toThrow("不能包含用户项目");
  const installation = dirname(dirname((await hostIdentity()).entry));
  for (const root of [installation, join(installation, "src")])
    await expect(run({ ...f, workspace: root, target: { kind: "extension", root }, prompt: "develop", fetch: async () => { calls++; return response([textItem()]); } })).rejects.toThrow("安装目录");
  expect(calls).toBe(0); await expect(readFile(join(f.session, "journal.jsonl"))).rejects.toThrow();
});
it("refuses missing core source through headless and HTTP without a fallback or model call", async () => {
  const f = await fixture("core"); let calls = 0;
  await expect(run({ ...f, prompt: "change core", fetch: async () => { calls++; return response([textItem()]); } })).rejects.toThrow("核心目标缺少");
  const app = await startWeb({ workspace: f.ownerWorkspace, home: f.home, apiKey: key, naming: false }); services.push(app);
  const reply = await fetch(app.origin + "/api/v1/sessions", { method: "POST", headers: { authorization: `Bearer ${app.token}`, origin: app.origin, "content-type": "application/json" }, body: JSON.stringify({ version: 1, title: "core", commandId: "core-source", mode: "create", target: f.target }) });
  expect(reply.status).toBe(422); expect(await reply.json()).toMatchObject({ error: { code: "core_source" } });
  expect(await readdir(app.sessions.root)).toHaveLength(0); expect(await readdir(f.workspace)).toHaveLength(0); expect(calls).toBe(0);
});
it("cannot use a development root to bypass user-resource and host-data authorization", async () => {
  const f = await fixture(); await writeFile(join(f.home, "protected"), "original");
  await expect(run({ ...f, workspace: f.home, target: { kind: "extension", root: f.home }, prompt: "write user files" })).rejects.toThrow("用户资源或宿主数据");
  await mkdir(join(f.home, "extensions"));
  await expect(run({ ...f, workspace: join(f.home, "extensions"), target: { kind: "extension", root: join(f.home, "extensions") }, prompt: "write user files" })).rejects.toThrow("用户资源或宿主数据");
  expect(await readFile(join(f.home, "protected"), "utf8")).toBe("original");
  await expect(readFile(join(f.session, "journal.jsonl"))).rejects.toThrow();
});
it("checks source, lock and build prerequisites without executing lifecycle scripts", async () => {
  const f = await fixture("core"), host = await hostIdentity();
  const pkg = { name: "nekomimi", version: host.version, scripts: { build: "touch EXECUTED" } };
  await writeFile(join(f.workspace, "package.json"), JSON.stringify(pkg));
  await writeFile(join(f.workspace, "package-lock.json"), JSON.stringify({ packages: { "": { name: pkg.name, version: pkg.version } } }));
  await mkdir(join(f.workspace, "src")); await writeFile(join(f.workspace, "src/cli.ts"), "export {};"); await writeFile(join(f.workspace, "tsconfig.build.json"), "{}");
  await expect(binding(f)).rejects.toThrow('未登记源码候选');
  const { CoreCandidates } = await import('../src/core/candidates.js');
  const candidates = new CoreCandidates(f.ownerWorkspace, f.home), preview = await candidates.preview(f.workspace);
  const prepared = await candidates.prepare({ source: f.workspace, destination: join(await temporary(), 'core'), sourceRevision: preview.source.revision, targetHostBuild: preview.targetHost.build });
  f.workspace = prepared.directory; f.target.root = prepared.directory;
  const selected = await binding(f); await checkSessionTarget(selected, f.home);
  await expect(readFile(join(f.workspace, "EXECUTED"))).rejects.toThrow();
  await writeFile(join(f.workspace, "package.json"), JSON.stringify({ ...pkg, version: "0.0.0" }));
  await expect(checkSessionTarget(selected, f.home)).rejects.toThrow("核心目标缺少");
  await writeFile(join(f.workspace, "package.json"), JSON.stringify(pkg));
  const outside = await temporary(); await writeFile(join(outside, "cli.ts"), "export {};");
  const { unlink } = await import("node:fs/promises"); await unlink(join(f.workspace, "src/cli.ts")); await symlink(join(outside, "cli.ts"), join(f.workspace, "src/cli.ts"));
  await expect(checkSessionTarget(selected, f.home)).rejects.toThrow("核心目标缺少");
});
it("rejects bound SDK host mismatch and path escapes without returning another host's documents", async () => {
  const f = await fixture(), selected = await binding(f);
  const stale = { ...selected.target, host: { ...selected.target.host!, build: "0".repeat(64) } };
  await expect(checkSessionTarget({ ...selected, target: stale })).rejects.toThrow("宿主或 SDK 构建已变化");
  await expect(sdkCatalog("public", f.workspace, f.home, stale)).rejects.toThrow("资料与绑定");
  await expect(sdkCatalog("public", f.ownerWorkspace, f.home, selected.target)).rejects.toThrow("资料与绑定");
  await expect(sdkCatalog("guide:../../package.json", f.workspace, f.home, selected.target)).rejects.toThrow("outside");
});
it("returns the bound development target and honest shell boundary through the real SDK tool", async () => {
  const f = await fixture(); let calls = 0;
  const result = await run({ ...f, prompt: "read matching SDK", fetch: async () => response(++calls === 1 ? [callItem("customization_sdk", {})] : [textItem()]) });
  expect(result.status, result.error).toBe("completed"); expect(calls).toBe(2);
  const history = await readSession(f.session), event = history.events.find(event => event.type === "tool.completed" && (event.payload as any).name === "customization_sdk")!;
  const value = JSON.parse((await readArtifact(result.session, (event.payload as any).artifact)).toString());
  const sdk = JSON.parse(value.content[0].text), selected = (history.events.find(event => event.type === "session.created")!.payload as any).binding;
  expect(sdk.target).toMatchObject({ id: selected.target.id, root: await realpath(f.workspace), host: selected.target.host });
  expect(sdk.security.shell).toContain("not an OS sandbox"); expect(sdk.security.extensions).toContain("only host service calls are recorded");
  const guide = await sdkCatalog("guide:scopes.md", f.workspace, f.home, selected.target);
  expect((guide as any).text).toContain("可信 Node 扩展");
});
it.each(["parent", "symlink", "resource"])("blocks %s writes outside the create target through the actual tool pipeline", async kind => {
  const f = await fixture(), ownerFile = join(f.ownerWorkspace, "protected"); await writeFile(ownerFile, "original");
  await symlink(f.ownerWorkspace, join(f.workspace, "escape"), "dir"); let calls = 0;
  const name = kind === "resource" ? "resource_write" : "write";
  const args = kind === "resource" ? { kind: "extension", name: "scope", file: "../../outside", text: "tampered", previousHash: null } : { path: kind === "symlink" ? "escape/protected" : ownerFile, content: "tampered" };
  const result = await run({ ...f, prompt: "attempt write", fetch: async () => response(++calls === 1 ? [callItem(name, args)] : [textItem()]) });
  expect(result.status, result.error).toBe("completed");
  expect(await readFile(ownerFile, "utf8")).toBe("original");
  const events = (await readSession(f.session)).events;
  expect(events.some(event => event.type === "tool.completed" && (event.payload as any).name === name)).toBe(false);
  expect(events.some(event => ["tool.blocked", "tool.execution_error"].includes(event.type))).toBe(true);
});
