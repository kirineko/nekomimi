import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, writeFile, readFile, rm, realpath, readdir, lstat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { list, extract } from "tar";
import type { PackageSource } from "./contracts.js";
const semver = createRequire(import.meta.url)("semver") as { maxSatisfying(versions: string[], range: string): string | null; valid(version: string): string | null };
export const PACKAGE_LIMITS = Object.freeze({ download: 16 * 1024 * 1024, expanded: 64 * 1024 * 1024, metadata: 1024 * 1024, files: 4096, file: 8 * 1024 * 1024, dependencies: 64, depth: 8 });
export function registryUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Invalid package registry URL");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}
export async function download(url: URL, signal?: AbortSignal, limit: number = PACKAGE_LIMITS.download): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]), redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`Package download failed: HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new Error("Package download limit"); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit) throw new Error("Package download limit");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, bytes);
}
export function verifyIntegrity(bytes: Buffer, integrity: string) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (!match || createHash("sha512").update(bytes).digest("base64") !== match[1]) throw new Error("Package integrity mismatch or unsupported digest");
}
export async function unpack(bytes: Buffer, destination: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (bytes.length > PACKAGE_LIMITS.download) throw new Error("Package download limit");
  let raw: Buffer;
  try { raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: PACKAGE_LIMITS.expanded }) : bytes; }
  catch { throw new Error("Invalid compressed package or expansion limit exceeded"); }
  if (raw.length > PACKAGE_LIMITS.expanded) throw new Error("Package expansion limit");
  let count = 0, size = 0, invalid: string | undefined;
  const paths = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const parser = list({ strict: true, onReadEntry(entry) {
      const path = entry.path.replace(/\/$/, "");
      const parts = path.split("/");
      // tar normalizes backslashes on Windows before exposing entry.path.
      // Check its unnormalized header too, so rejection is platform independent.
      if (entry.header.path?.includes("\\") || !path || path.includes("\\") || isAbsolute(path) || parts[0] !== "package" || parts.some(p => !p || p === "." || p === ".." || /[:\x00-\x1f]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) invalid = "Unsafe archive path";
      if (!["File", "Directory", "OldFile"].includes(entry.type)) invalid = "Archive links and special files are not supported";
      if (entry.size > PACKAGE_LIMITS.file || ++count > PACKAGE_LIMITS.files || (size += entry.size) > PACKAGE_LIMITS.expanded) invalid = "Archive content limit";
      const key = path.normalize("NFC").toLowerCase();
      if (paths.has(key)) invalid = "Duplicate or ambiguous archive path";
      paths.add(key);
    } });
    parser.on("error", reject); parser.on("end", resolve);
    parser.end(raw);
  });
  if (invalid) throw new Error(invalid);
  signal?.throwIfAborted();
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    const output = extract({ cwd: destination, strip: 1, strict: true, noChmod: true, preserveOwner: false });
    output.on("error", reject); output.on("close", resolve);
    output.end(raw);
  });
  signal?.throwIfAborted();
  return { files: count, expandedBytes: size };
}
export interface RegistryPackage {
  name: string; version: string; dist: { tarball: string; integrity: string };
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>; scripts?: Record<string, string>;
  os?: string[]; cpu?: string[];
}
export interface DependencyLockEntry { name: string; version: string; integrity: string; url: string }
/** Resolve into an isolated tree. No npm process, lifecycle scripts, or host node_modules. */
export async function installDependencies(dependencies: Record<string, string>, destination: string, registry: string, signal?: AbortSignal, locked?: Record<string, DependencyLockEntry>): Promise<Record<string, DependencyLockEntry>> {
  const lock: Record<string, DependencyLockEntry> = {};
  let count = 0, downloaded = 0, expanded = 0;
  const install = async (requested: Record<string, string>, directory: string, ancestors: Array<{ name: string; version: string }>, depth: number) => {
    if (depth > PACKAGE_LIMITS.depth) throw new Error("Dependency depth limit");
    for (const [name, selector] of Object.entries(requested).sort(([a], [b]) => a.localeCompare(b))) {
      signal?.throwIfAborted();
      if (ancestors.some(p => p.name === name && semver.maxSatisfying([p.version], selector))) continue;
      if (++count > PACKAGE_LIMITS.dependencies) throw new Error("Dependency count limit");
      const relativePath = `${directory ? directory + "/" : ""}node_modules/${name}`;
      const prior = locked?.[relativePath];
      const pkg = await resolveNpm(name, prior?.version ?? selector, registry, signal);
      if (prior && (prior.name !== pkg.name || prior.integrity !== pkg.dist.integrity || prior.url !== pkg.dist.tarball)) throw new Error("Locked dependency metadata changed");
      const supported = (values: string[] | undefined, current: string) => !values || (!values.includes(`!${current}`) && (!values.some(v => !v.startsWith("!")) || values.includes(current)));
      if (!supported(pkg.os, process.platform) || !supported(pkg.cpu, process.arch)) throw new Error(`Dependency platform unsupported: ${name}`);
      const target = join(destination, relativePath);
      const fetched = await fetchNpm(pkg, target, signal);
      downloaded += fetched.archive.length;
      expanded += fetched.expandedBytes;
      if (downloaded > PACKAGE_LIMITS.expanded || expanded > PACKAGE_LIMITS.expanded) throw new Error("Dependency aggregate content limit");
      lock[relativePath] = { name, version: pkg.version, integrity: pkg.dist.integrity, url: pkg.dist.tarball };
      const declared = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
      const children = { ...declared.peerDependencies, ...declared.dependencies } as Record<string, string>;
      // Optional modules only enter the tree if their published platform matches.
      for (const [optionalName, range] of Object.entries(declared.optionalDependencies ?? {}) as Array<[string, string]>) {
        const optional = await resolveNpm(optionalName, locked?.[`${relativePath}/node_modules/${optionalName}`]?.version ?? range, registry, signal);
        if (supported(optional.os, process.platform) && supported(optional.cpu, process.arch)) children[optionalName] = range;
      }
      await install(children, relativePath, [...ancestors, { name, version: pkg.version }], depth + 1);
    }
  };
  await install(dependencies, "", [], 0);
  if (locked && JSON.stringify(Object.keys(lock).sort()) !== JSON.stringify(Object.keys(locked).sort())) throw new Error("Dependency lock tree changed");
  return lock;
}
export async function resolveNpm(name: string, selector: string, registry: string, signal?: AbortSignal): Promise<RegistryPackage> {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error("Invalid npm package name");
  const base = registryUrl(registry);
  const metadata = JSON.parse((await download(new URL(encodeURIComponent(name), base), signal, PACKAGE_LIMITS.metadata)).toString("utf8"));
  const version = metadata["dist-tags"]?.[selector] ?? (semver.valid(selector) ? selector : semver.maxSatisfying(Object.keys(metadata.versions ?? {}), selector));
  const pkg = version && metadata.versions?.[version] as RegistryPackage | undefined;
  if (!pkg || pkg.name !== name || pkg.version !== version || !pkg.dist?.integrity) throw new Error("Package version/integrity unavailable");
  const tarball = new URL(pkg.dist.tarball);
  if (tarball.origin !== base.origin || tarball.username || tarball.password || tarball.search || tarball.hash) throw new Error("Package tarball must stay on its registry origin");
  return pkg;
}
export async function fetchNpm(pkg: RegistryPackage, destination: string, signal?: AbortSignal) {
  const bytes = await download(new URL(pkg.dist.tarball), signal);
  verifyIntegrity(bytes, pkg.dist.integrity);
  const unpacked = await unpack(bytes, destination, signal);
  const actual = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  if (actual.name !== pkg.name || actual.version !== pkg.version) throw new Error("Registry and package identity mismatch");
  return { archive: bytes, expandedBytes: unpacked.expandedBytes };
}
/** git archive reads a pinned object; checkout hooks, submodules and package scripts never run. */
export async function fetchGit(source: Extract<PackageSource, { kind: "git" }>, destination: string, signal?: AbortSignal) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(source.commit)) throw new Error("Invalid Git revision");
  const local = isAbsolute(source.url) || !/^[a-z]+:/i.test(source.url);
  const url = local ? await realpath(source.url) : new URL(source.url).href;
  if (!local && (new URL(url).protocol !== "https:" || new URL(url).username || new URL(url).password || new URL(url).search || new URL(url).hash)) throw new Error("Git source must be HTTPS or an explicit local repository");
  const temp = await mkdtemp(join(tmpdir(), "nekomimi-git-"));
  const budget = new AbortController();
  const combined = AbortSignal.any([budget.signal, ...(signal ? [signal] : [])]);
  let scanning: Promise<void> | undefined;
  const checkDisk = async () => {
    let bytes = 0, files = 0;
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 32) throw new Error("Git temporary directory limit");
      for (const name of await readdir(directory)) {
        let entry;try {entry = await lstat(join(directory, name));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
        if (++files > PACKAGE_LIMITS.files * 4 || (bytes += entry.size) > PACKAGE_LIMITS.expanded) throw new Error("Git temporary storage limit");
        if (entry.isDirectory()) await visit(join(directory, name), depth + 1);
      }
    };
    await visit(temp, 0);
  };
  // Includes object history, which is not bounded by the final git archive size.
  const monitor = setInterval(() => {if(!scanning) scanning=checkDisk().catch(error=>budget.abort(error)).finally(()=>{scanning=undefined;});},100);
  try {
    const empty = join(temp, "empty"); await mkdir(empty);
    const config = join(temp, "gitconfig"); await writeFile(config, "");
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: temp, USERPROFILE: temp, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: config, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" };
    const git = async (args: string[], cwd = temp) => {
      try {
        const result = await new Promise<{stdout:Buffer;stderr:Buffer}>((resolve,reject)=>{
          const child=spawn("git", ["-c", `core.hooksPath=${empty}`, "-c", "core.fsmonitor=false", "-c", `protocol.file.allow=${local ? "always" : "never"}`, ...args], { cwd, env, signal:combined, detached:process.platform!=='win32', timeout:60_000, killSignal:'SIGKILL',stdio:['ignore','pipe','pipe'] });
          const out:Buffer[]=[],err:Buffer[]=[];let bytes=0,failure:Error|undefined;
          const kill=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
          const capture=(target:Buffer[],chunk:Buffer)=>{if(failure)return;bytes+=chunk.length;if(bytes>PACKAGE_LIMITS.download){failure=new Error('Git output limit');kill();}else target.push(chunk);};
          child.stdout.on('data',(chunk:Buffer)=>capture(out,chunk));child.stderr.on('data',(chunk:Buffer)=>capture(err,chunk));
          child.on('error',error=>{failure=error;kill();});
          child.on('exit',(code,signal)=>{if(code!==0||signal)kill();});
          child.on('close',(code)=>{if(failure)reject(failure);else if(code!==0)reject(new Error(`Git command failed (${code})`));else resolve({stdout:Buffer.concat(out),stderr:Buffer.concat(err)});});
        });
        await checkDisk();combined.throwIfAborted();return result;
      } catch(error) {if(budget.signal.aborted)throw budget.signal.reason;throw error;}
    };
    await git(["clone", "--no-checkout", "--no-hardlinks", "--no-recurse-submodules", `--template=${empty}`, "--", url, "repo"]);
    const repository = join(temp, "repo");
    const commit = (await git(["rev-parse", "--verify", `${source.commit}^{commit}`], repository)).stdout.toString().trim();
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Git commit resolution failed");
    const archive = (await git(["archive", "--format=tar", "--prefix=package/", commit], repository)).stdout;
    await unpack(archive, destination, signal);
    return { source: { kind: "git" as const, url, commit }, integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}` };
  } finally { clearInterval(monitor);await scanning;await rm(temp, { recursive: true, force: true }); }
}
