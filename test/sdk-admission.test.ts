import { it, expect } from "vitest";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CustomizationHost } from "../src/customization/host.js";
import { Candidates } from "../src/customization/candidates.js";
import { temporary } from "./helpers.js";
import { Journal, hash } from "../src/journal.js";
import { run } from "../src/runtime.js";
import { exportSession, importBundle } from "../src/export.js";
import { prepareDataHome } from "../src/storage/format.js";

async function treeDigest(directory: string): Promise<string> {
  const files: [string, string][] = [];
  async function walk(root: string, prefix = ""): Promise<void> {
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(root, entry.name), relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, relative + "/");
      else files.push([relative, hash(await readFile(path))]);
    }
  }
  await walk(directory); return hash(JSON.stringify(files));
}

it("refuses an old session before loading an authorized factory or importing into a new destination", async () => {
  const workspace = await temporary(), home = await temporary(), session = join(workspace, "old-session");
  const root = join(workspace, ".nekomimi", "extensions", "current");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "current", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["commands"] }));
  await writeFile(join(root, "index.ts"), `import {writeFileSync} from 'node:fs';export default (api:import('nekomimi/extensions').ExtensionAPI)=>{writeFileSync(${JSON.stringify(join(workspace, "factory-ran"))},'bad');api.registerCommand('ok',{description:'ok',async handler(){return 'ok'}})};`);
  const host = new CustomizationHost(workspace, home);
  const resource = (await host.catalog.discover()).find(r => r.kind === "extension")!;
  await host.catalog.decide(resource.id, true, true, 0);
  const legacy = await Journal.open(session);
  await legacy.append("session.created", { workspace, model: "old" }); await legacy.close();
  const before = await treeDigest(session); let calls = 0;
  try {
    await expect(run({ workspace, home, session, customization: host, prompt: "new input", apiKey: "fixture",
      fetch: async () => { calls++; throw new Error("Must not dispatch"); },
    })).rejects.toThrow("Unsupported session format");
    expect(calls).toBe(0);
    await expect(readFile(join(workspace, "factory-ran"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await treeDigest(session)).toBe(before);
    const bundle = join(workspace, "old-bundle"), destination = join(workspace, "new-import");
    await exportSession(session, { output: bundle, format: "bundle" });
    const exported = await treeDigest(bundle);
    await expect(importBundle(bundle, destination)).rejects.toThrow("Unsupported session format");
    await expect(readdir(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await treeDigest(session)).toBe(before); expect(await treeDigest(bundle)).toBe(exported);
  } finally { await host.close(); }
});

it.each([1, 2])("rejects SDK %s before authorization writes or factory execution", async sdkVersion => {
  const workspace = await temporary(), home = await temporary();
  const root = join(workspace, ".nekomimi", "extensions", "old");
  await mkdir(root, { recursive: true });
  const manifest = JSON.stringify({ name: "old", sdkVersion, entry: "index.ts", requiredCapabilities: ["commands"] });
  const source = `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(workspace, "factory-ran"))},'bad');export default ()=>{};`;
  await writeFile(join(root, "extension.json"), manifest); await writeFile(join(root, "index.ts"), source);
  const host = new CustomizationHost(workspace, home);
  try {
    const resource = (await host.catalog.discover()).find(r => r.kind === "extension")!;
    expect(resource.error).toContain("sdkVersion");
    await expect(host.catalog.decide(resource.id, true, true, 0)).rejects.toThrow("sdkVersion");
    await expect(host.acquire()).rejects.toThrow("sdkVersion");
    expect(await readdir(home)).toEqual([]);
    await expect(readFile(join(workspace, "factory-ran"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "extension.json"), "utf8")).toBe(manifest);
    expect(await readFile(join(root, "index.ts"), "utf8")).toBe(source);
  } finally { await host.close(); }
});

it("creates candidates in an independent partition without adopting the old pointer or candidates", async () => {
  const workspace = await temporary(); const old = join(workspace, ".nekomimi");
  await mkdir(join(old, "candidates", "old"), { recursive: true });
  const pointer = '{"version":1,"revision":9,"entries":{}}';
  await writeFile(join(old, "active-customizations.json"), pointer);
  const store = new Candidates(workspace);
  const created = await store.scaffold("new");
  expect(created.path).toContain(join(".nekomimi", "v2", "candidates"));
  expect(await store.list()).toEqual([created.id]);
  expect(await store.active()).toEqual([]);
  expect(await readFile(join(old, "active-customizations.json"), "utf8")).toBe(pointer);
  expect(await readdir(join(old, "candidates"))).toEqual(["old"]);
  expect((await store.read(created.id)).manifest?.sdkVersion).toBe(3);
});

it("refuses copied old candidate recovery records without a writer or metadata replay", async () => {
  const store = new Candidates(await temporary()); await prepareDataHome(store.base);
  const directory = join(store.base, "customization-journal");
  const journal = await Journal.open(directory);
  await journal.append("customization.commit.intent", { before: { version: 1, revision: 0, entries: {} }, after: { version: 1, revision: 1, entries: {} } });
  await journal.close();
  const before = await treeDigest(store.base);
  await expect(store.recover()).rejects.toThrow("格式不受支持");
  expect(await treeDigest(store.base)).toBe(before);
});
