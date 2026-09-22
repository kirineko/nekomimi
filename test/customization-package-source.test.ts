import { expect, it } from "vitest";
import { mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { create, Header } from "tar";
import { temporary } from "./helpers.js";
import { unpack, resolveNpm, fetchNpm, fetchGit, verifyIntegrity, installDependencies, PACKAGE_LIMITS } from "../src/customization/package-source.js";
import { gzipSync } from "node:zlib";
async function archive(files: Record<string, string>) {
  const root = await temporary(); await mkdir(join(root, "package"));
  for (const [name, value] of Object.entries(files)) { await mkdir(join(root, "package", name, ".."), { recursive: true }); await writeFile(join(root, "package", name), value); }
  const path = join(root, "archive.tgz"); await create({ cwd: root, file: path, gzip: true, portable: true }, ["package"]);
  return readFile(path);
}
it("rejects oversized downloads and compressed expansion before writing package files", async () => {
  const destination = join(await temporary(), "out");
  await expect(unpack(Buffer.alloc(PACKAGE_LIMITS.download + 1), destination)).rejects.toThrow("download limit");
  const bomb = gzipSync(Buffer.alloc(PACKAGE_LIMITS.expanded + 1));
  await expect(unpack(bomb, destination)).rejects.toThrow("expansion limit");
  await expect(readFile(join(destination, "nekomimi.json"))).rejects.toThrow();
});
it("rejects traversal, absolute paths and links before extracting any files", async () => {
  for (const path of ["package/../../escape", "/package/escape", "package/C:evil", "package/a\\b"]) {
    const header = new Header({ path, type: "File", size: 0 }); header.encode();
    const bytes = Buffer.concat([header.block!, Buffer.alloc(1024)]);
    await expect(unpack(bytes, join(await temporary(), "out"))).rejects.toThrow("Unsafe archive path");
  }
  const root = await temporary(); await mkdir(join(root, "package")); await symlink("../../elsewhere", join(root, "package/link"));
  const path = join(root, "links.tgz"); await create({ cwd: root, file: path, gzip: true }, ["package"]);
  await expect(unpack(await readFile(path), join(root, "out"))).rejects.toThrow("links");
});
it("resolves a registry tag to a fixed version and verifies bytes without running lifecycle scripts", async () => {
  const bytes = await archive({ "package.json": JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { postinstall: "node -e \"throw Error('must not execute')\"" } }), "nekomimi.json": "{}" });
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  let url = "";
  const server = createServer((req, res) => {
    if (req.url === "/fixture.tgz") { res.end(bytes); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { name: "fixture", version: "1.0.0", dist: { integrity, tarball: url + "/fixture.tgz" } } } }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const resolved = await resolveNpm("fixture", "latest", url);
    expect(resolved.version).toBe("1.0.0");
    const destination = join(await temporary(), "package");
    await fetchNpm(resolved, destination);
    expect(JSON.parse(await readFile(join(destination, "package.json"), "utf8")).name).toBe("fixture");
    expect(() => verifyIntegrity(Buffer.from("changed"), integrity)).toThrow("integrity");
    const abort = new AbortController(); abort.abort();
    await expect(fetchNpm(resolved, join(await temporary(), "cancelled"), abort.signal)).rejects.toThrow();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
it("replays exact transitive dependency locks after tags move and rejects changed integrity", async () => {
  const archives = new Map<string, Buffer>();
  for (const [name, version, dependencies] of [["parent", "1.0.0", { child: "latest" }], ["child", "1.0.0", {}], ["child", "2.0.0", {}]] as const) {
    archives.set(`${name}-${version}`, await archive({ "package.json": JSON.stringify({ name, version, dependencies, scripts: { install: "exit 99" } }), "index.js": `module.exports=${JSON.stringify(version)};` }));
  }
  let url = "", latest = "1.0.0", tamper = false;
  const server = createServer((req, res) => {
    const path = req.url!.slice(1);
    if (path.endsWith(".tgz")) { res.end(archives.get(path.slice(0, -4))); return; }
    const versions = Object.fromEntries([...archives].filter(([id]) => id.startsWith(path + "-")).map(([id, bytes]) => {
      const version = id.slice(path.length + 1);
      return [version, { name: path, version, dist: { tarball: `${url}/${id}.tgz`, integrity: `sha512-${createHash("sha512").update(tamper ? Buffer.from("tampered") : bytes).digest("base64")}` } }];
    }));
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ "dist-tags": { latest: path === "child" ? latest : "1.0.0" }, versions }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const lock = await installDependencies({ parent: "latest" }, await temporary(), url);
    expect(lock["node_modules/parent/node_modules/child"]!.version).toBe("1.0.0");
    latest = "2.0.0";
    const replay = await temporary();
    expect(await installDependencies({ parent: "latest" }, replay, url, undefined, lock)).toEqual(lock);
    expect(await readFile(join(replay, "node_modules/parent/node_modules/child/index.js"), "utf8")).toContain('"1.0.0"');
    expect((await installDependencies({ parent: "latest" }, await temporary(), url))["node_modules/parent/node_modules/child"]!.version).toBe("2.0.0");
    tamper = true;
    await expect(installDependencies({ parent: "latest" }, await temporary(), url, undefined, lock)).rejects.toThrow("metadata changed");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
it("pins a Git branch to an exact commit and never invokes hooks or submodules", async () => {
  const repo = await temporary();
  const git = (args: string[]) => promisify(execFile)("git", args, { cwd: repo });
  await git(["init", "-b", "main"]);
  await writeFile(join(repo, "nekomimi.json"), "{}");
  await writeFile(join(repo, ".gitmodules"), '[submodule "never"]\npath=never\nurl=https://invalid.example/never\n');
  await git(["add", "nekomimi.json", ".gitmodules"]);
  await git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  await writeFile(join(repo, ".git/hooks/post-checkout"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const destination = join(await temporary(), "imported");
  const fetched = await fetchGit({ kind: "git", url: repo, commit: "main" }, destination);
  expect(fetched.source.commit).toBe((await git(["rev-parse", "HEAD"])).stdout.trim());
  expect(await readFile(join(destination, "nekomimi.json"), "utf8")).toBe("{}");
  await expect(readFile(join(destination, "never"))).rejects.toThrow();
  await writeFile(join(repo,'nekomimi.json'),'{"updated":true}');await git(['add','nekomimi.json']);await git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','update']);
  const changed=await fetchGit({kind:'git',url:repo,commit:'main'},join(await temporary(),'new'));expect(changed.source.commit).not.toBe(fetched.source.commit);expect(await readFile(join(destination,'nekomimi.json'),'utf8')).toBe('{}');
});
it('bounds Git object history even when the selected commit has a tiny working tree',async()=>{
 const repo=await temporary(),git=(args:string[])=>promisify(execFile)('git',args,{cwd:repo});await git(['init','-b','main']);
 await writeFile(join(repo,'old.bin'),randomBytes(PACKAGE_LIMITS.expanded+1024));await writeFile(join(repo,'nekomimi.json'),'{}');await git(['add','.']);
 const commit=['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','gc.auto=0','commit','-m'];await git([...commit,'large history']);await rm(join(repo,'old.bin'));await git(['add','-u']);await git([...commit,'tiny head']);
 const destination=join(await temporary(),'import');await expect(fetchGit({kind:'git',url:repo,commit:'main'},destination)).rejects.toThrow('storage limit');await expect(readFile(join(destination,'nekomimi.json'))).rejects.toThrow();
},30000);
