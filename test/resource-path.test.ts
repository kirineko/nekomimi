import { describe, it, expect } from "vitest";
import { win32, posix, join } from "node:path";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isResourceWithin, resolveResource } from "../src/server/resource-path.js";

describe.each([win32, posix])("resource boundaries ($sep)", (paths) => {
  const root = paths.resolve("/app/中文 assets");
  it("accepts index and nested assets", () => {
    expect(isResourceWithin(root, paths.join(root, "index.html"), paths)).toBe(true);
    expect(isResourceWithin(root, paths.join(root, "assets/app.js"), paths)).toBe(true);
  });
  it("rejects root, parent and prefix siblings", () => {
    for (const target of [root, paths.dirname(root), root + "-outside/secret"])
      expect(isResourceWithin(root, target, paths)).toBe(false);
  });
});
it("rejects a different Windows drive", () => {
  expect(isResourceWithin("C:\\app", "D:\\app\\index.html", win32)).toBe(false);
});
it("resolves links before enforcing the resource boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "resource-boundary-"));
  try {
    const assets = join(root, "assets");
    await mkdir(assets);
    await writeFile(join(assets, "index.html"), "ok");
    await writeFile(join(root, "secret"), "private");
    await symlink(join(root, "secret"), join(assets, "escaped"));
    expect(await resolveResource(assets, join(assets, "index.html"))).toBeTruthy();
    expect(await resolveResource(assets, join(assets, "escaped"))).toBeUndefined();
  } finally { await rm(root, {recursive: true, force: true}); }
});
