import { expect, it } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Packages } from "../src/customization/packages.js";
import { Resources } from "../src/customization/resources.js";
import { CustomizationHost } from "../src/customization/host.js";
import { run } from "../src/runtime.js";
import { readSession } from "../src/journal.js";
import { temporary, key, response, callItem, textItem } from "./helpers.js";
async function fixture() {
  const source = await temporary();
  await mkdir(join(source, "skills")); await mkdir(join(source, "rules"));
  await writeFile(join(source, "nekomimi.json"), JSON.stringify({ manifestVersion: 1, name: "review-package", version: "1.0.0", sdkVersion: 2, requiredCapabilities: ["commands"], dependencies: {}, resources: [
    { kind: "extension", name: "review-package", entry: "index.ts" },
    { kind: "skill", name: "package-checklist", entry: "skills/SKILL.md" },
    { kind: "rule", name: "typescript-rules", entry: "rules/typescript.md", ruleScope: { root: ".", include: ["**/*.ts"] } },
  ] }));
  await writeFile(join(source, "index.ts"), `import type {ExtensionFactory} from 'nekomimi/extensions'; export default ((api)=>{api.registerCommand('pack-review',{description:'package',async handler(){return 'package active'}})}) satisfies ExtensionFactory;`);
  await writeFile(join(source, "skills/SKILL.md"), "---\nname: package-checklist\ndescription: Package checklist\n---\nReview according to package checklist.\n");
  await writeFile(join(source, "rules/typescript.md"), "Package rule: explain every changed TypeScript export.");
  return source;
}
it("installs a local multi-resource package with stable identities and target-bound rules", async () => {
  const workspace = await temporary(), home = await temporary(), source = await fixture();
  const packages = new Packages(workspace, home), host = new CustomizationHost(workspace, home);
  try {
    await expect(packages.prepare({ kind: "local", path: source }, "project")).rejects.toThrow("target binding");
    const candidate = await packages.prepare({ kind: "local", path: source }, "project", { "typescript-rules": "src" });
    await expect(host.requestPackage(candidate.id, "project")).rejects.toThrow("authorization");
    const receipt = await host.requestPackage(candidate.id, "project", true); await host.reload(receipt);
    expect(receipt.status).toBe("activated");
    const installed = await new Resources(workspace, home).discover();
    expect(installed.filter(r => r.packageId === candidate.packageId)).toHaveLength(3);
    const command = await run({ workspace, home, customization: host, session: join(workspace, "command"), apiKey: key, prompt: "/pack-review" });
    expect(command.text).toBe("package active");
    const bodies: any[] = []; let n = 0;
    const written = await run({ workspace, home, customization: host, session: join(workspace, "rules"), apiKey: key, prompt: "Write src/test.ts", fetch: async (_u, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return ++n < 3 ? response([callItem("write", { path: "src/test.ts", content: "export const value = 1;" }, `p${n}`)]) : response([textItem()]);
    } });
    expect(written.status).toBe("completed");
    expect(bodies[0].instructions).not.toContain("Package rule:");
    expect(bodies[1].instructions).toContain("Package rule:");
    expect(bodies[1].instructions).toContain("src [**/*.ts]");
    expect((await readSession(written.session)).events.filter(e => e.type === "tool.intent" && (e.payload as any).name === "write")).toHaveLength(1);
    await writeFile(join(source, "index.ts"), (await readFile(join(source, "index.ts"), "utf8")).replace("package active", "package updated"));
    const update = await packages.prepare({ kind: "local", path: source }, "project", { "typescript-rules": "src" });
    expect(update.packageId).toBe(candidate.packageId); expect(update.revision).not.toBe(candidate.revision);
    const updated = await host.requestPackage(update.id, "project"); await host.reload(updated); expect(updated.status).toBe("activated");
  } finally { await host.close(); }
});
it("keeps project overrides and rejects private source files and same-scope collisions", async () => {
  const workspace = await temporary(), home = await temporary(), source = await fixture();
  const packages = new Packages(workspace, home);
  const user = await packages.prepare({ kind: "local", path: source }, "user", { "typescript-rules": "src" });
  await packages.commit(user, await packages.permissions(user), 0);
  const project = await packages.prepare({ kind: "local", path: source }, "project", { "typescript-rules": "src" });
  await packages.commit(project, await packages.permissions(project), 0);
  const resources = await new Resources(workspace, home).discover();
  expect(resources.find(r => r.packageId === user.packageId && r.kind === "skill")!.status).toBe("shadowed");
  expect(resources.find(r => r.packageId === project.packageId && r.kind === "skill")!.status).toBe("enabled");
  const duplicateSource = await fixture();
  const duplicate = await packages.prepare({ kind: "local", path: duplicateSource }, "project", { "typescript-rules": "src" });
  const host = new CustomizationHost(workspace, home);
  try {
    const receipt = await host.requestPackage(duplicate.id, "project", true);
    await host.reload(receipt);
    expect(receipt.status).toBe("failed");
    expect(receipt.error).toContain("same scope");
    expect((await packages.list()).filter(p => p.scope === "project").map(p => p.packageId)).toEqual([project.packageId]);
  } finally { await host.close(); }
  const manifest = JSON.parse(await readFile(join(source, "nekomimi.json"), "utf8")); manifest.files = ["auth.json"];
  await writeFile(join(source, "nekomimi.json"), JSON.stringify(manifest)); await writeFile(join(source, "auth.json"), '{"secret":"must not package"}');
  await expect(packages.prepare({ kind: "local", path: source }, "project", { "typescript-rules": "src" })).rejects.toThrow("private");
});
it("shares one process per executable package revision while keeping resource state separate", async () => {
  const workspace = await temporary(), home = await temporary(), source = await temporary();
  await writeFile(join(source, "nekomimi.json"), JSON.stringify({ manifestVersion: 1, name: "multi", version: "1.0.0", sdkVersion: 2, requiredCapabilities: ["commands", "state"], dependencies: {}, resources: ["one", "two"].map(name => ({ kind: "extension", name, entry: name + ".ts" })) }));
  for (const name of ["one", "two"]) await writeFile(join(source, name + ".ts"), `import type {ExtensionFactory} from 'nekomimi/extensions'; export default ((api)=>{api.registerCommand('pid',{description:'pid',async handler(a,c){const n=Number(await c.state.get('n',1) ?? 0)+1;await c.state.set('n',1,n);return JSON.stringify({pid:process.pid,resource:c.resourceId,n})}})}) satisfies ExtensionFactory;`);
  const packages = new Packages(workspace, home), host = new CustomizationHost(workspace, home);
  try {
    const candidate = await packages.prepare({ kind: "local", path: source }, "project");
    const receipt = await host.requestPackage(candidate.id, "project", true); await host.reload(receipt);
    expect(receipt.status).toBe("activated");
    const invoke = async (name: string) => {
      const result = await run({ workspace, home, customization: host, session: join(workspace, "session"), apiKey: key, prompt: `/${name}:pid` });
      expect(result.status).toBe("completed"); return JSON.parse(result.text);
    };
    const one = await invoke("one"), two = await invoke("two"), again = await invoke("one");
    expect(one.pid).toBe(two.pid); expect(one.pid).not.toBe(process.pid);
    expect(one.resource).not.toBe(two.resource); expect(one.n).toBe(1); expect(two.n).toBe(1); expect(again.n).toBe(2);
  } finally { await host.close(); }
});
it("shares a package into another workspace with fresh rule bindings and uninstalls only its registrations", async () => {
  const workspace = await temporary(), home = await temporary(), source = await fixture();
  const packages = new Packages(workspace, home);
  const candidate = await packages.prepare({ kind: "local", path: source }, "project", { "typescript-rules": "src" });
  await packages.commit(candidate, await packages.permissions(candidate), 0);
  const exported = await packages.export(candidate.packageId, "shared.tgz");
  const second = await temporary(), secondHome = await temporary(), receiver = new Packages(second, secondHome);
  await expect(receiver.prepare({ kind: "local", path: exported.path }, "project")).rejects.toThrow("target binding");
  const imported = await receiver.prepare({ kind: "local", path: exported.path }, "project", { "typescript-rules": "app" });
  expect(imported.packageId).not.toBe(candidate.packageId);
  expect(imported.grants).toEqual([]);
  expect(imported.ruleBindings["typescript-rules"]?.root).toBe("app");
  const host = new CustomizationHost(second, secondHome);
  try {
    const receipt = await host.requestPackage(imported.id, "project", true); await host.reload(receipt); expect(receipt.status).toBe("activated");
    const result = await run({ workspace: second, home: secondHome, customization: host, session: join(second, "session"), apiKey: key, prompt: "/pack-review" });
    expect(result.text).toBe("package active");
    await writeFile(join(second, "user-owned.txt"), "keep");
    await receiver.uninstall(imported.packageId, await receiver.revision("project"));
    const reload = host.requestReload(); await host.reload(reload);
    expect(host.active!.extensions).toHaveLength(0);
    expect(await readFile(join(second, "user-owned.txt"), "utf8")).toBe("keep");
    expect((await readSession(result.session)).events.some(e => e.type === "resources.activated")).toBe(true);
    expect((await receiver.resources(imported)).length).toBe(3);
  } finally { await host.close(); }
});
it('collects explicitly discarded unused candidates while retaining history and durable workflow pins',async()=>{
 const workspace=await temporary(),home=await temporary(),source=await fixture(),store=new Packages(workspace,home);
 const first=await store.prepare({kind:'local',path:source},'project',{'typescript-rules':'src'});
 await store.commit(first,await store.permissions(first),0);
 await writeFile(join(source,'index.ts'),(await readFile(join(source,'index.ts'),'utf8')).replace('package active','unused candidate'));
 const unused=await store.prepare({kind:'local',path:source},'project',{'typescript-rules':'src'});
 await writeFile(join(source,'index.ts'),(await readFile(join(source,'index.ts'),'utf8')).replace('unused candidate','workflow pinned'));
 const pinned=await store.prepare({kind:'local',path:source},'project',{'typescript-rules':'src'});
 await store.retain(pinned,'durable-fixture');
 await store.uninstall(first.packageId,1);
 const result=await store.collect('project',[first.id,unused.id,pinned.id]);
 expect(result.removed).toEqual([unused.revision]);expect(result.removedCandidates).toEqual([unused.id]);
 expect((await store.resources(first)).length).toBe(3);expect((await store.resources(pinned)).length).toBe(3);
 await expect(store.resources(unused)).rejects.toThrow();
});
