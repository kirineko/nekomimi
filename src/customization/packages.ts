import { mkdir, readdir, lstat, readFile, writeFile, copyFile, rename, rm, realpath } from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { create as createArchive } from "tar";
import { Journal, atomicFile, hash, id } from "../journal.js";
import { packageIdentity, type PackageManifest, type PackageSource, type PackageLock } from "./contracts.js";
import { checkPackageManifest, packagePath } from "./package-manifest.js";
import { fetchNpm, resolveNpm, fetchGit, unpack, installDependencies, PACKAGE_LIMITS, type DependencyLockEntry } from "./package-source.js";
import { safePath, exists, boundedRead, type Resource, type McpConfig } from "./resources.js";
import { userHome } from "../storage/paths.js";
import { checkTypes } from "./validation.js";

export interface PackageCandidate extends PackageLock {}
interface PackagePointer { version: 1; revision: number; entries: Record<string, PackageCandidate> }
async function treeFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let size = 0;
  const walk = async (directory: string, depth: number) => {
    if (depth > 64) throw new Error("Package directory depth limit");
    for (const name of (await readdir(directory)).sort()) {
      const path = await safePath(root, join(directory, name)), st = await lstat(path);
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw new Error("Package links and special files are not supported");
      if (st.isDirectory()) await walk(path, depth + 1);
      else {
        size += st.size;
        if (st.size > PACKAGE_LIMITS.file || size > PACKAGE_LIMITS.expanded || Object.keys(files).length >= PACKAGE_LIMITS.files) throw new Error("Package content limit");
        files[relative(root, path).split("\\").join("/")] = hash(await readFile(path));
      }
    }
  };
  await walk(root, 0);
  return files;
}
function sourceIdentity(source: PackageSource) {
  if (source.kind === "npm") return `npm:${new URL(source.registry).href}:${source.name}`;
  if (source.kind === "git") return `git:${source.url}`;
  return `local:${source.path}`;
}
export class Packages {
  constructor(readonly workspace: string, readonly home = userHome()) {
    this.workspace = realpathSync(workspace);
    this.home = existsSync(home) ? realpathSync(home) : resolve(home);
  }
  private base(scope: "project" | "user") { return scope === "project" ? join(this.workspace, ".nekomimi") : this.home; }
  private identity(candidate: Pick<PackageCandidate, "scope" | "manifest" | "source">, resource: string, revision: string) {
    return packageIdentity(`${this.base(candidate.scope)}:${sourceIdentity(candidate.source)}`, candidate.manifest.name, resource, revision);
  }
  private async pointer(scope: "project" | "user"): Promise<PackagePointer> {
    const path = join(this.base(scope), "packages.json");
    if (!(await exists(path))) return { version: 1, revision: 0, entries: {} };
    const value = JSON.parse(await boundedRead(await safePath(this.base(scope), path)));
    if (value.version !== 1 || !Number.isSafeInteger(value.revision) || !value.entries || typeof value.entries !== "object") throw new Error("Invalid package pointer");
    return value;
  }
  async list(): Promise<PackageCandidate[]> { return [...Object.values((await this.pointer("user")).entries), ...Object.values((await this.pointer("project")).entries)]; }
  async drafts() {
    const result: Array<{ id: string; scope: "project" | "user"; name: string; revision: string }> = [];
    for (const scope of ["project", "user"] as const) {
      const directory = join(this.base(scope), "package-candidates");
      if (!(await exists(directory))) continue;
      for (const file of (await readdir(await safePath(this.base(scope), directory))).sort().slice(-128)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
        const candidate = JSON.parse(await boundedRead(await safePath(directory, file))) as PackageCandidate;
        result.push({ id: candidate.id, scope, name: candidate.manifest.name, revision: candidate.revision });
      }
    }
    return result;
  }
  async preview(scope: "project" | "user", candidateId: string) {
    const candidate = await this.candidate(scope, candidateId);
    const old = (await this.list()).find(p => p.packageId === candidate.packageId);
    const permissions = await this.permissions(candidate), resources = await this.resources(candidate);
    const checks = resources.filter(r => !!r.manifest).map(checkTypes);
    const changed = [...new Set([...Object.keys(old?.files ?? {}), ...Object.keys(candidate.files)])].filter(path => old?.files[path] !== candidate.files[path]);
    const root = join(this.base(scope), "package-content", candidate.revision);
    const files = await Promise.all(changed.filter(path => !path.startsWith("node_modules/")).slice(0, 64).map(async name => ({ name, previousHash: old?.files[name], hash: candidate.files[name], preview: candidate.files[name] && /\.(?:[cm]?[jt]sx?|json|md|css|html)$/.test(name) ? (await readFile(await safePath(root, name), "utf8")).slice(0, 4000) : undefined })));
    return { candidate, checks, passed: checks.every(c => c.passed), permissions, addedPermissions: permissions.filter(p => !old?.grants.includes(p)), files, changedFiles: changed.length, previousRevision: old?.revision };
  }
  async prepare(source: PackageSource, scope: "project" | "user", bindings: Record<string, string> = {}, signal?: AbortSignal): Promise<PackageCandidate> {
    if (!["project", "user"].includes(scope)) throw new Error("Invalid installation scope");
    const base = this.base(scope); await mkdir(base, { recursive: true });
    const staging = await safePath(base, join(base, "package-staging", id()));
    const incoming = join(staging, "incoming"), content = join(staging, "content");
    await mkdir(content, { recursive: true, mode: 0o700 });
    try {
      let root: string, pinned = source, integrity = "";
      let imported: { lockVersion: number; dependencies: Record<string, DependencyLockEntry>; files: Record<string, string> } | undefined;
      if (source.kind === "local") {
        root = await realpath(source.path); pinned = { kind: "local", path: root };
        if ((await lstat(root)).isFile()) {
          if ((await lstat(root)).size > PACKAGE_LIMITS.download) throw new Error("Package bundle size limit");
          const bytes = await readFile(root); integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
          await unpack(bytes, incoming, signal); root = incoming;
          imported = JSON.parse(await boundedRead(await safePath(root, "nekomimi.lock.json")));
          const actual = await treeFiles(root); delete actual["nekomimi.lock.json"];
          if (imported?.lockVersion !== 1 || JSON.stringify(actual) !== JSON.stringify(imported.files)) throw new Error("Package bundle lock/content mismatch");
        }
      }
      else if (source.kind === "npm") {
        const pkg = await resolveNpm(source.name, source.version, source.registry, signal);
        await fetchNpm(pkg, incoming, signal); root = incoming;
        pinned = { ...source, registry: new URL(source.registry).href, version: pkg.version }; integrity = pkg.dist.integrity;
      } else if (source.kind === "git") {
        const git = await fetchGit(source, incoming, signal); root = incoming; pinned = git.source; integrity = git.integrity;
      } else throw new Error("Unsupported package source");
      const manifest = checkPackageManifest(JSON.parse(await boundedRead(await safePath(root, "nekomimi.json"))));
      const selected = [...new Set(["nekomimi.json", ...manifest.resources.map(r => r.entry), ...(manifest.files ?? [])])];
      let copied = 0, bytes = 0;
      const copy = async (name: string, depth: number) => {
        if (depth > 12) throw new Error("Package source depth limit");
        packagePath(name);
        const from = await safePath(root, name), to = await safePath(content, name), st = await lstat(from);
        if (st.isSymbolicLink()) throw new Error("Package source symlink rejected");
        if (st.isDirectory()) { await mkdir(to, { recursive: true }); for (const child of (await readdir(from)).sort()) await copy(`${name}/${child}`, depth + 1); }
        else {
          if (!st.isFile() || st.size > PACKAGE_LIMITS.file || (bytes += st.size) > PACKAGE_LIMITS.expanded || ++copied > PACKAGE_LIMITS.files) throw new Error("Package source limit");
          await mkdir(dirname(to), { recursive: true }); await copyFile(from, to);
        }
      };
      for (const name of selected) { signal?.throwIfAborted(); await copy(name, 0); }
      let dependencies: Record<string, DependencyLockEntry>;
      if (imported) {
        dependencies = imported.dependencies;
        for (const name of Object.keys(imported.files).filter(name => name.startsWith("node_modules/"))) {
          const from = await safePath(root, name), to = await safePath(content, name);
          await mkdir(dirname(to), { recursive: true }); await copyFile(from, to);
        }
        for (const [path, dependency] of Object.entries(dependencies)) {
          if (!path.startsWith("node_modules/")) throw new Error("Invalid bundled dependency path");
          const pkg = JSON.parse(await boundedRead(await safePath(content, join(path, "package.json"))));
          if (pkg.name !== dependency.name || pkg.version !== dependency.version) throw new Error("Bundled dependency identity mismatch");
        }
      } else dependencies = await installDependencies(manifest.dependencies, content, source.kind === "npm" ? source.registry : "https://registry.npmjs.org/", signal);
      const files = await treeFiles(content);
      const ruleBindings: PackageCandidate["ruleBindings"] = {};
      for (const resource of manifest.resources.filter(r => r.kind === "rule")) {
        if (bindings[resource.name] === undefined) throw new Error(`Rule ${resource.name} requires an explicit project target binding`);
        const target = await safePath(this.workspace, join(bindings[resource.name]!, resource.ruleScope!.root));
        ruleBindings[resource.name] = { workspace: this.workspace, root: relative(this.workspace, target) || ".", include: resource.ruleScope!.include };
      }
      const revision = hash(JSON.stringify({ manifest, files, dependencies, ruleBindings }));
      const identity = this.identity({ scope, manifest, source: pinned }, "package", revision);
      const candidate: PackageCandidate = { version: 1, lockVersion: 1, id: id(), scope, packageId: identity.packageId!, revision, manifest, source: pinned, integrity: integrity || `sha512-${createHash("sha512").update(JSON.stringify(files)).digest("base64")}`, dependencies, files, ruleBindings, grants: [] };
      if (Buffer.byteLength(JSON.stringify(candidate)) > PACKAGE_LIMITS.metadata) throw new Error("Package lock metadata limit");
      const publishing = await Journal.open(await safePath(base, join(base, 'package-journal')));
      try {
        signal?.throwIfAborted();
        const destination = await safePath(base, join(base, "package-content", revision));
        await mkdir(dirname(destination), { recursive: true });
        if (!(await exists(destination))) await rename(content, destination);
        else if (JSON.stringify(await treeFiles(destination)) !== JSON.stringify(files)) throw new Error("Package content collision or tampering");
        const candidatePath = await safePath(base, join(base, "package-candidates", candidate.id + ".json"));
        await mkdir(dirname(candidatePath), { recursive: true }); await atomicFile(candidatePath, JSON.stringify(candidate));
      } finally { await publishing.close(); }
      return candidate;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async candidate(scope: "project" | "user", candidateId: string): Promise<PackageCandidate> {
    if (!/^[a-f0-9-]{36}$/.test(candidateId)) throw new Error("Invalid package candidate ID");
    const base = this.base(scope);
    const candidate = JSON.parse(await boundedRead(await safePath(base, join(base, "package-candidates", candidateId + ".json")))) as PackageCandidate;
    if (candidate.scope !== scope || candidate.id !== candidateId) throw new Error("Package candidate identity mismatch");
    await this.resources(candidate);
    return candidate;
  }
  async resources(candidate: PackageCandidate): Promise<Resource[]> {
    if (candidate.version !== 1 || candidate.lockVersion !== 1) throw new Error("Unsupported package lock version");
    const manifest = checkPackageManifest(candidate.manifest);
    if (!/^[a-f0-9]{64}$/.test(candidate.revision) || !["project", "user"].includes(candidate.scope)) throw new Error("Invalid package lock");
    if (this.identity(candidate, "package", candidate.revision).packageId !== candidate.packageId) throw new Error("Package source identity mismatch");
    const base = this.base(candidate.scope), root = await safePath(base, join(base, "package-content", candidate.revision));
    const actualFiles = await treeFiles(root);
    if (JSON.stringify(actualFiles) !== JSON.stringify(candidate.files) || hash(JSON.stringify({ manifest, files: actualFiles, dependencies: candidate.dependencies, ruleBindings: candidate.ruleBindings })) !== candidate.revision) throw new Error("Package immutable content integrity mismatch");
    const files: Record<string, string> = {};
    for (const name of Object.keys(actualFiles).filter(name => !name.startsWith("node_modules/") && /\.(?:[cm]?[jt]sx?|json|md)$/.test(name))) files[name] = await readFile(join(root, name), "utf8");
    return Promise.all(manifest.resources.map(async resource => {
      if (!["extension", "skill", "rule", "mcp", "provider", "workflow", "panel"].includes(resource.kind)) throw new Error(`Resource runtime unavailable: ${resource.kind}`);
      const identity = this.identity(candidate, `${resource.kind}:${resource.name}`, candidate.revision);
      const path = await safePath(root, resource.entry), text = await boundedRead(path);
      const result: Resource = { fileHashes: actualFiles, id: identity.resourceId, packageId: candidate.packageId, packageRevision: candidate.revision, name: resource.name, kind: resource.kind as Resource["kind"], scope: candidate.scope, root, path, source: `package:${candidate.packageId}/${resource.entry}`, text, hash: candidate.revision, status: "enabled" };
      if (["extension", "provider", "workflow", "panel"].includes(resource.kind)) Object.assign(result, { files, manifest: { name: resource.name, sdkVersion: manifest.sdkVersion, entry: resource.entry, requiredCapabilities: manifest.requiredCapabilities } });
      if (resource.kind === "skill") {
        const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text), meta = header && parse(header[1]!);
        if (!meta || meta.name !== resource.name || typeof meta.description !== "string" || !meta.description) throw new Error("Package Skill metadata mismatch");
        result.description = meta.description;
      }
      if (resource.kind === "rule") {
        const binding = candidate.ruleBindings[resource.name];
        if (!binding) throw new Error("Package Rule missing target binding");
        result.ruleBinding = binding;
        if (binding.workspace !== this.workspace) result.status = "disabled";
      }
      if (resource.kind === "mcp") result.config = JSON.parse(text) as McpConfig;
      return result;
    }));
  }
  async commit(candidate: PackageCandidate, grants: string[], expectedRevision: number) {
    await this.resources(candidate);
    if ((await this.permissions(candidate)).some(c => !grants.includes(c))) throw new Error("Package permission expansion requires authorization");
    const base = this.base(candidate.scope), journalPath = await safePath(base, join(base, "package-journal"));
    const journal = await Journal.open(journalPath);
    try {
      await this.recoverJournal(journal, candidate.scope);
      await this.resources(candidate);
      const before = await this.pointer(candidate.scope);
      if (before.revision !== expectedRevision) throw new Error("Package installation conflict");
      const current = before.entries[candidate.packageId];
      const entry = { ...candidate, trusted: true, grants: [...grants], previous: current?.revision };
      const after = { version: 1, revision: before.revision + 1, entries: { ...before.entries, [entry.packageId]: entry } };
      if (Buffer.byteLength(JSON.stringify(after)) > PACKAGE_LIMITS.metadata) throw new Error("Package registry metadata limit");
      const intent = await journal.append("package.commit.intent", { before, after });
      await atomicFile(await safePath(base, join(base, "packages.json")), JSON.stringify(after));
      await journal.append("package.commit.completed", { intentId: intent.eventId, committed: true });
      return entry;
    } finally { await journal.close(); }
  }
  private async recoverJournal(journal: Journal, scope: "project" | "user") {
    const intent = journal.events.findLast(e => e.type === "package.commit.intent");
    if (!intent || journal.events.some(e => e.type === "package.commit.completed" && (e.payload as any).intentId === intent.eventId)) return;
    const p = intent.payload as { before: PackagePointer; after: PackagePointer };
    const current = await this.pointer(scope), committed = JSON.stringify(current) === JSON.stringify(p.after);
    if (!committed && JSON.stringify(current) !== JSON.stringify(p.before)) throw new Error("Package recovery conflict");
    await journal.append("package.commit.completed", { intentId: intent.eventId, recovered: true, committed });
  }
  async revision(scope: "project" | "user") { return (await this.pointer(scope)).revision; }
  async permissions(candidate: PackageCandidate): Promise<string[]> {
    const resources = await this.resources(candidate);
    return [...candidate.manifest.requiredCapabilities, ...[...new Set([...Object.keys(candidate.manifest.dependencies), ...Object.values(candidate.dependencies).map(d => d.name)])].sort().map(name => `dependency:${name}`), ...resources.flatMap(r => {
      if (r.kind === "mcp") return [`mcp:${JSON.stringify(r.config)}`];
      if (r.kind === "rule") return [`rule:${JSON.stringify(r.ruleBinding)}`];
      return [];
    })];
  }
  async export(packageId: string, output: string) {
    const candidate = (await this.list()).find(p => p.packageId === packageId);
    if (!candidate) throw new Error("Unknown installed package");
    await this.resources(candidate);
    const base = this.base(candidate.scope), root = await safePath(base, join(base, "package-content", candidate.revision));
    const destination = await safePath(this.workspace, output);
    if (await exists(destination)) throw new Error("Package export destination already exists");
    const staging = await safePath(base, join(base, "package-staging", id()));
    await mkdir(staging, { recursive: true });
    try {
      for (const name of Object.keys(candidate.files)) {
        const target = await safePath(staging, name); await mkdir(dirname(target), { recursive: true }); await copyFile(await safePath(root, name), target);
      }
      // Never export grants, target bindings, credentials, state, or host configuration.
      await writeFile(join(staging, "nekomimi.lock.json"), JSON.stringify({ lockVersion: 1, dependencies: candidate.dependencies, files: candidate.files }));
      await mkdir(dirname(destination), { recursive: true });
      const temporary = destination + "." + id() + ".tmp";
      try {
        await createArchive({ cwd: staging, file: temporary, gzip: true, portable: true, prefix: "package/" }, [...Object.keys(candidate.files), "nekomimi.lock.json"]);
        if ((await lstat(temporary)).size > PACKAGE_LIMITS.download) throw new Error("Package export size limit");
        await rename(temporary, destination);
      } finally { await rm(temporary, { force: true }); }
      return { path: destination, integrity: `sha512-${createHash("sha512").update(await readFile(destination)).digest("base64")}`, revision: candidate.revision };
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async uninstall(packageId: string, expectedRevision: number) {
    const candidate = (await this.list()).find(p => p.packageId === packageId);
    if (!candidate) throw new Error("Unknown installed package");
    const base = this.base(candidate.scope), journal = await Journal.open(await safePath(base, join(base, "package-journal")));
    try {
      await this.recoverJournal(journal, candidate.scope);
      await this.resources(candidate);
      const before = await this.pointer(candidate.scope);
      if (before.revision !== expectedRevision) throw new Error("Package uninstall conflict");
      const entries = { ...before.entries }; delete entries[packageId];
      const after = { version: 1, revision: before.revision + 1, entries };
      const intent = await journal.append("package.commit.intent", { before, after, operation: "uninstall" });
      await atomicFile(await safePath(base, join(base, "packages.json")), JSON.stringify(after));
      await journal.append("package.commit.completed", { intentId: intent.eventId, committed: true });
      // Immutable revisions and all user/session/workflow state remain available.
    } finally { await journal.close(); }
  }
  /** Durable code pins precede workflow/outbox publication; uncertain pins are retained. */
  async retain(candidate: PackageCandidate, workflowId: string) {
    const base=this.base(candidate.scope), journal=await Journal.open(await safePath(base,join(base,'package-journal')));
    try {
      await this.resources(candidate);
      if(!journal.events.some(e=>e.type==='package.pin' && (e.payload as any).workflowId===workflowId && (e.payload as any).workspace===this.workspace && (e.payload as any).revision===candidate.revision))
        await journal.append('package.pin',{workflowId,workspace:this.workspace,revision:candidate.revision,packageId:candidate.packageId});
    } finally {await journal.close();}
  }
  /** Explicit cache collection never deletes journals, workflow state or referenced code. */
  async collect(scope: 'project'|'user', discardCandidates: string[] = [], liveRevisions: string[] = []) {
    if(discardCandidates.length>128 || discardCandidates.some(value=>!/^[a-f0-9-]{36}$/.test(value))) throw new Error('Invalid candidate cleanup selection');
    const base=this.base(scope),journal=await Journal.open(await safePath(base,join(base,'package-journal')));
    try {
      await this.recoverJournal(journal,scope);
      const retained=new Set(liveRevisions),pointer=await this.pointer(scope);
      for(const pkg of Object.values(pointer.entries)){retained.add(pkg.revision);if(pkg.previous)retained.add(pkg.previous);}
      for(const event of journal.events.filter(e=>e.type==='package.commit.intent')) for(const pointer of [(event.payload as any).before,(event.payload as any).after]) for(const pkg of Object.values(pointer.entries) as PackageCandidate[]) retained.add(pkg.revision);
      for(const event of journal.events.filter(e=>e.type==='package.pin')) retained.add((event.payload as any).revision);
      const candidates=await safePath(base,join(base,'package-candidates'));
      const locks: Array<{path:string;candidate:PackageCandidate}>=[];
      if(await exists(candidates))for(const file of await readdir(candidates))if(/^[a-f0-9-]{36}\.json$/.test(file)){
        const path=await safePath(candidates,file),candidate=JSON.parse(await boundedRead(path)) as PackageCandidate;
        locks.push({path,candidate});if(!discardCandidates.includes(candidate.id))retained.add(candidate.revision);
      }
      // Keep lock records needed for active rollback and workflow version audit.
      const removedCandidates:string[]=[];
      for(const {path,candidate} of locks)if(discardCandidates.includes(candidate.id)&&!retained.has(candidate.revision)){await rm(path);removedCandidates.push(candidate.id);}
      const root=await safePath(base,join(base,'package-content')), removed:string[]=[];
      if(await exists(root))for(const revision of await readdir(root))if(/^[a-f0-9]{64}$/.test(revision)&&!retained.has(revision)){
        await journal.append('package.gc.intent',{revision});await rm(await safePath(root,revision),{recursive:true,force:true});removed.push(revision);await journal.append('package.gc.completed',{revision});
      }
      return {removed,removedCandidates,retained:[...retained],policy:'Active, rollback, candidate and all historical/workflow journal references retained'};
    }finally{await journal.close();}
  }
  async previous(packageId: string): Promise<PackageCandidate> {
    const active = (await this.list()).find(p => p.packageId === packageId);
    if (!active?.previous) throw new Error("No previous package revision");
    const directory = await safePath(this.base(active.scope), join(this.base(active.scope), "package-candidates"));
    for (const file of (await readdir(directory)).sort()) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
      const candidate = JSON.parse(await boundedRead(await safePath(directory, file))) as PackageCandidate;
      if (candidate.packageId === packageId && candidate.revision === active.previous) { await this.resources(candidate); return candidate; }
    }
    throw new Error("Previous package lock missing");
  }
  async recover() {
    for (const scope of ["project", "user"] as const) {
      const base = this.base(scope), path = join(base, "package-journal");
      if (!(await exists(path))) continue;
      const journal = await Journal.open(await safePath(base, path));
      try { await this.recoverJournal(journal, scope); } finally { await journal.close(); }
    }
  }
}
