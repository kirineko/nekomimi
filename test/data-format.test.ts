import { it, expect } from "vitest";
import { readFile, readdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { inspectDataHome, prepareDataHome, requireNewContract, newDataHome } from "../src/storage/format.js";
import { temporary } from "./helpers.js";
import { ConfigStore } from "../src/config/store.js";
import { workspacePaths } from "../src/storage/paths.js";
import { ProviderProfiles } from "../src/customization/provider-profiles.js";

it("rejects an old selected directory before adding or changing any file", async () => {
  const path = await temporary();
  const settings = Buffer.from('{"version":1,"model":"old"}\n');
  await writeFile(join(path, "settings.json"), settings);
  await expect(inspectDataHome(path)).rejects.toThrow("独立的新数据目录");
  await expect(prepareDataHome(path)).rejects.toThrow("格式不受支持");
  expect(await readdir(path)).toEqual(["settings.json"]);
  expect(await readFile(join(path, "settings.json"))).toEqual(settings);
});
it("initializes an independent selection and subsequently leaves its contents unchanged", async () => {
  const parent = await temporary(); const path = join(parent, "new-data");
  expect(await inspectDataHome(path)).toBe("missing");
  expect(await readdir(parent)).toEqual([]);
  await prepareDataHome(path);
  const before = await readFile(join(path, "nekomimi-format.json"));
  await writeFile(join(path, "settings.json"), '{"formatVersion":2}');
  await prepareDataHome(path);
  expect(await inspectDataHome(path)).toBe("supported");
  expect(await readFile(join(path, "nekomimi-format.json"))).toEqual(before);
  expect(newDataHome(path)).toBe(path);
  expect(newDataHome()).toMatch(/\.nekomimi\/v2$/);
});
it("serializes concurrent new-directory initializations without adopting unmarked contents", async () => {
  const path = join(await temporary(), "new-data");
  expect(await Promise.all(Array.from({ length: 12 }, () => prepareDataHome(path)))).toEqual(Array(12).fill(path));
  expect(await readdir(path)).toEqual(["nekomimi-format.json"]);
  expect(await inspectDataHome(path)).toBe("supported");
});
it("rejects symlinked roots and markers without changing their targets", async () => {
  const parent = await temporary(); const target = await temporary(); const path = join(parent, "link");
  await symlink(target, path);
  await expect(prepareDataHome(path)).rejects.toThrow("格式不受支持");
  expect(await readdir(target)).toEqual([]);
  await writeFile(join(parent, "marker"), '{"product":"nekomimi","formatVersion":2}');
  await symlink(join(parent, "marker"), join(target, "nekomimi-format.json"));
  await expect(prepareDataHome(target)).rejects.toThrow("格式不受支持");
});
it("rejects old and future config, candidate and SDK contracts before consumers can execute them", () => {
  for (const kind of ["config", "candidate", "extension"] as const) {
    for (const value of [null, {}, { version: 1, sdkVersion: 1 }, { version: 1, sdkVersion: 2 }, { formatVersion: 99, sdkVersion: 99 }])
      expect(() => requireNewContract(value, kind, "fixture")).toThrow("格式不受支持");
    expect(() => requireNewContract(kind === "extension" ? { sdkVersion: 3 } : { formatVersion: 2 }, kind, "fixture")).not.toThrow();
  }
});

it("guards actual configuration and workspace entry points before creating a writer", async () => {
  const home = await temporary(); const workspace = await temporary();
  const old = Buffer.from('{"version":1,"revision":0,"model":"old","baseUrl":"https://api.deepseek.com"}');
  await writeFile(join(home, "settings.json"), old);
  const store = new ConfigStore(home);
  await expect(store.snapshot()).rejects.toThrow("独立的新数据目录");
  await expect(store.save("auth", { revision: 0, apiKey: "fixture" })).rejects.toThrow("独立的新数据目录");
  await expect(workspacePaths(workspace, home)).rejects.toThrow("独立的新数据目录");
  expect(await readdir(home)).toEqual(["settings.json"]);
  expect(await readFile(join(home, "settings.json"))).toEqual(old);
});

it("rejects an old config inside a marked partition before acquiring a lease", async () => {
  const home = await temporary(); await prepareDataHome(home);
  await writeFile(join(home, "auth.json"), '{"version":1,"revision":0,"apiKey":"old"}');
  const before = await readdir(home);
  await expect(new ConfigStore(home).save("settings", { revision: 0, model: "new", baseUrl: "https://api.deepseek.com" })).rejects.toThrow("版本不受支持");
  expect(await readdir(home)).toEqual(before);
  expect(await readFile(join(home, "auth.json"), "utf8")).toContain('"apiKey":"old"');
});

it("reads an empty model catalog without creating a directory and refuses copied old profile stores", async () => {
  const parent = await temporary(), home = join(parent, "missing");
  expect((await new ProviderProfiles(home).list()).entries).toEqual({});
  expect(await readdir(parent)).toEqual([]);
  await prepareDataHome(home);
  const bytes = '{"version":1,"revision":0,"entries":{},"selection":{}}';
  await writeFile(join(home, "provider-profiles.json"), bytes);
  const before = await readdir(home);
  await expect(new ProviderProfiles(home).saveCredential("new", "fixture")).rejects.toThrow("格式不受支持");
  expect(await readdir(home)).toEqual(before);
  expect(await readFile(join(home, "provider-profiles.json"), "utf8")).toBe(bytes);
});
