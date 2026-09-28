import { assetMime } from './asset.js';
import { create as createArchive } from 'tar';
import { mkdir, readdir, lstat, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { Journal, atomicFile, hash, id } from "../journal.js";
import { exists, safePath, LIMITS, type Resource } from "./resources.js";
import { checkManifest } from "./types.js";
import { checkTypes, contentHash, type ValidationReport } from "./validation.js";

export interface Candidate {
  id: string;
  name: string;
  path: string;
  resourceId: string;
  contentHash: string;
  report: ValidationReport;
}
export interface ActiveCandidate {
  name: string;
  resourceId: string;
  revision: string;
  previous?: string;
  grantedCapabilities: string[];
}
interface Pointer { version: 1; revision: number; entries: Record<string, ActiveCandidate> }
const validName = (name: string) => /^[a-z][a-z0-9-]{0,47}$/.test(name);
export async function snapshotFiles(root: string): Promise<{ version: 2; files: Record<string, string>; binaryFiles: Record<string, Buffer>; fileHashes: Record<string, string> }> {
  root = realpathSync.native(root);
  const files: Record<string, string> = {};
  const binaryFiles: Record<string, Buffer> = {}, fileHashes: Record<string, string> = {};
  let bytes = 0;
  const walk = async (directory: string, depth: number) => {
    if (depth > 12) throw new Error("Candidate directory depth limit");
    for (const name of (await readdir(directory)).sort()) {
      if (["node_modules", ".git", ".candidate-snapshot.json"].includes(name)) continue;
      const path = await safePath(root, join(directory, name));
      const st = await lstat(path);
      if (st.isSymbolicLink()) throw new Error("Candidate symlinks are not supported");
      if (st.isDirectory()) await walk(path, depth + 1);
      else {
        if (!st.isFile() || st.size > LIMITS.file) throw new Error("Candidate file limit");
        const data = await readFile(path);
        bytes += data.length;
        if (bytes > LIMITS.package || Object.keys(fileHashes).length >= 256) throw new Error("Candidate package limit");
        const key = relative(root, path).split('\\').join('/');
        fileHashes[key] = hash(data);
        if (/\.(woff2?|png|jpe?g|webp)$/.test(key)) { assetMime(key,data); binaryFiles[key] = data; }
        else {
          const text = data.toString('utf8');
          if (!Buffer.from(text).equals(data)) throw new Error(`Unsupported binary candidate file: ${key}`);
          files[key] = text;
        }
      }
    }
  };
  await walk(root, 0);
  return { version: 2, files, binaryFiles, fileHashes };
}
/** Content-addressed code and a single atomic active-pointer/lock document.
 * Recovery changes metadata only; it never imports an extension. */
export class Candidates {
  readonly base: string;
  constructor(readonly workspace: string, private fault?: (phase: string) => Promise<void>) {
    this.workspace = realpathSync.native(workspace);
    this.base = join(this.workspace, ".nekomimi");
  }
  private resource(name: string, root: string, snapshot: Awaited<ReturnType<typeof snapshotFiles>>): Resource {
    const { files, binaryFiles, fileHashes } = snapshot;
    const text = files["extension.json"] ?? "";
    const manifest = checkManifest(JSON.parse(text));
    if (manifest.name !== name) throw new Error("Candidate manifest name must match logical identity");
    if (!files[manifest.entry]) throw new Error("Candidate entry missing");
    const source = join(this.base, "managed", name, "extension.json");
    return { id: `extension:${hash(source).slice(0, 20)}`, kind: "extension", scope: "project", name, root, source, path: join(root, "extension.json"), text, files, binaryFiles, fileHashes, manifest, hash: contentHash(files, binaryFiles), status: "untrusted" };
  }
  async scaffold(name: string, template: string = "command"): Promise<{ id: string; path: string }> {
    if (!validName(name)) throw new Error("Invalid candidate name");
    if(!["command","theme","panel","view"].includes(template))throw new Error("Unknown candidate template");
    const candidateId = `${name}-${id()}`;
    const path = await safePath(this.workspace, join(this.base, "candidates", candidateId));
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "extension.json"), JSON.stringify({ name, sdkVersion: 2, entry: "index.ts", requiredCapabilities: ["commands"] }, null, 2));
    await writeFile(join(path, "index.ts"), `import type { ExtensionFactory } from "nekomimi/extensions";\nexport default ((api) => {\n  api.registerCommand("${name}", { description: "${name}", async handler(args, ctx) { return args || "Ready"; } });\n}) satisfies ExtensionFactory;\n`);
    if(template!=='command') {
      const theme=template==='theme',view=template==='view';
      const capabilities=theme?['themes']:view?['views']:['panels','commands','ui'];
      await writeFile(join(path,'extension.json'),JSON.stringify({name,sdkVersion:2,entry:'index.ts',requiredCapabilities:capabilities},null,2));
      const registration=theme?`api.registerTheme({id:'${name}',title:'我的风格',typography:{fallback:'sans-serif',size:15,lineHeight:1.7},colors:{accent:'#9256a6'},spacing:{scale:.9},radii:{bubble:20},bubbles:{style:'tail'},motion:{preset:'fade',duration:250},density:'compact'});`:
        `api.${view?'registerView':'registerPanel'}({id:'${name}',title:'我的内容',uiVersion:1,entry:'panel.ts',slot:'${view?'sidebar-widget':'result'}',propsSchema:{type:'object'},actions:[],fallback:'内容已保存。'});${view?'':`api.registerCommand('${name}',{description:'显示内容',async handler(_args,ctx){await ctx.ui({kind:'panel',panelId:'${name}',title:'我的内容',summary:'你好，世界',props:{text:'你好，世界'}});}});`}`;
      await writeFile(join(path,'index.ts'),`import type {ExtensionFactory} from 'nekomimi/extensions';\nexport default ((api)=>{${registration}}) satisfies ExtensionFactory;\n`);
      if(!theme)await writeFile(join(path,'panel.ts'),`import type {PanelModule} from 'nekomimi/extensions';\nexport default {mount(root,ctx){root.textContent=String((ctx.props as {text?:string}).text??'我的内容');return()=>root.replaceChildren();}} satisfies PanelModule;\n`);
    }
    return { id: candidateId, path };
  }
  async read(candidateId: string): Promise<Resource> {
    if (!/^[a-z0-9-]{1,100}$/.test(candidateId)) throw new Error("Invalid candidate ID");
    const path = await safePath(this.workspace, join(this.base, "candidates", candidateId));
    const files = await snapshotFiles(path);
    const name = checkManifest(JSON.parse(files.files["extension.json"] ?? "")).name;
    return this.resource(name, path, files);
  }
  async inspect(candidateId: string): Promise<{ candidate: Candidate; resource: Resource }> {
    const resource = await this.read(candidateId);
    const {name, root:path} = resource;
    const report = checkTypes(resource);
    return { resource, candidate: { id: candidateId, name, path, resourceId: resource.id, contentHash: report.contentHash, report } };
  }
  async list(): Promise<string[]> {
    const path = await safePath(this.workspace, join(this.base, "candidates"));
    return await exists(path) ? (await readdir(path)).sort() : [];
  }
  async preview(candidateId: string) {
    const { candidate, resource } = await this.inspect(candidateId);
    const active = (await this.active()).find(a => a.resourceId === resource.id);
    const beforeResource = active ? await this.load(active) : undefined;
    const previous = { ...beforeResource?.files, ...Object.fromEntries(Object.entries(beforeResource?.binaryFiles ?? {}).map(([name,bytes]) => [name, `[binary ${bytes.length} bytes; sha256 ${hash(bytes)}]`])) };
    const next = { ...resource.files, ...Object.fromEntries(Object.entries(resource.binaryFiles ?? {}).map(([name,bytes]) => [name, `[binary ${bytes.length} bytes; sha256 ${hash(bytes)}]`])) };
    const files = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort().filter(name => previous[name] !== next[name]).map(name => ({
      name, change: previous[name] === undefined ? "added" : next[name] === undefined ? "removed" : "modified",
      before: previous[name]?.slice(0, 4000), after: next[name]?.slice(0, 4000),
      truncated: (previous[name]?.length ?? 0) > 4000 || (next[name]?.length ?? 0) > 4000,
    }));
    return { ...candidate, previousRevision: active?.revision, requestedCapabilities: resource.manifest!.requiredCapabilities ?? [], addedCapabilities: (resource.manifest!.requiredCapabilities ?? []).filter(c => !active?.grantedCapabilities.includes(c)), files };
  }
  private async pointer(): Promise<Pointer> {
    const path = await safePath(this.workspace, join(this.base, "active-customizations.json"));
    if (!(await exists(path))) return { version: 1, revision: 0, entries: {} };
    const pointer = JSON.parse(await readFile(path, "utf8"));
    if (pointer.version !== 1 || !Number.isSafeInteger(pointer.revision) || pointer.revision < 0 || !pointer.entries || typeof pointer.entries !== "object") throw new Error("Invalid active customization pointer");
    for (const [name, value] of Object.entries(pointer.entries) as Array<[string, ActiveCandidate]>) {
      if (!validName(name) || value.name !== name || !/^[a-f0-9]{64}$/.test(value.revision) || !Array.isArray(value.grantedCapabilities)) throw new Error("Invalid active customization entry");
    }
    return pointer;
  }
  async active(): Promise<ActiveCandidate[]> { return Object.values((await this.pointer()).entries); }
  async load(active: ActiveCandidate): Promise<Resource> {
    if (!validName(active.name) || !/^[a-f0-9]{64}$/.test(active.revision)) throw new Error("Invalid content identity");
    const root = await safePath(this.workspace, join(this.base, "content", active.revision));
    const files = await snapshotFiles(root);
    if (contentHash(files.files, files.binaryFiles) !== active.revision) throw new Error("Immutable content integrity mismatch");
    const manifestPath = join(root, '.candidate-snapshot.json');
    if (await exists(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.version !== 2 || !Array.isArray(manifest.files) || manifest.files.length !== Object.keys(files.fileHashes).length || manifest.files.some((f: {path: string; sha256: string; bytes: number; kind: string}) => files.fileHashes[f.path] !== f.sha256 || f.bytes !== Buffer.byteLength(files.binaryFiles[f.path] ?? files.files[f.path] ?? '') || f.kind !== (files.binaryFiles[f.path] ? 'binary' : 'text'))) throw new Error('Candidate manifest integrity mismatch');
    }
    const resource = this.resource(active.name, root, files);
    if (resource.id !== active.resourceId) throw new Error("Active resource identity mismatch");
    return resource;
  }
  async prepare(candidateId: string, expectedHash: string): Promise<{ candidate: Candidate; resource: Resource }> {
    const inspected = await this.inspect(candidateId);
    if (inspected.candidate.contentHash !== expectedHash) throw new Error("Candidate changed since validation; inspect again");
    if (!inspected.candidate.report.passed) throw new Error("Candidate type validation failed");
    const root = await safePath(this.workspace, join(this.base, "content", expectedHash));
    if (!(await exists(root))) {
      const staging = await safePath(this.workspace, join(this.base, "content", `.staging-${id()}`));
      await mkdir(staging, { recursive: true });
      try {
        for (const [name, text] of Object.entries({ ...inspected.resource.files, ...inspected.resource.binaryFiles })) {
          const path = await safePath(staging, name);
          await mkdir(resolve(path, ".."), { recursive: true });
          await writeFile(path, text, { flag: "wx", mode: 0o444 });
        }
        const manifest = Object.entries(inspected.resource.fileHashes!).sort(([a],[b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256, kind: inspected.resource.binaryFiles?.[path] ? 'binary' : 'text', bytes: Buffer.byteLength(inspected.resource.binaryFiles?.[path] ?? inspected.resource.files![path]!) }));
        await writeFile(join(staging, '.candidate-snapshot.json'), JSON.stringify({ version: 2, files: manifest }), { flag: 'wx', mode: 0o444 });
        await rename(staging, root);
      } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
    }
    return { candidate: inspected.candidate, resource: await this.load({ name: inspected.candidate.name, resourceId: inspected.resource.id, revision: expectedHash, grantedCapabilities: [] }) };
  }
  async export(candidateId: string, expectedHash: string, output: string) {
    const { resource } = await this.prepare(candidateId, expectedHash);
    const target = await safePath(this.workspace, output);
    if (await exists(target)) throw new Error('Export target already exists');
    const temporary = `${target}.${id()}.tmp`;
    try {
      await createArchive({cwd:resource.root,file:temporary,gzip:true,portable:true},Object.keys(resource.fileHashes!).sort());
      // Exclusive publication prevents a concurrent export overwriting a user's file.
      const { link } = await import('node:fs/promises');
      await link(temporary,target);
      return {path:target,contentHash:expectedHash};
    } finally { await rm(temporary,{force:true}); }
  }
  private async transaction<T>(fn: (journal: Journal) => Promise<T>) {
    const directory = await safePath(this.workspace, join(this.base, "customization-journal"));
    const journal = await Journal.open(directory);
    try {
      const intent = journal.events.findLast(e => e.type === "customization.commit.intent");
      if (intent && !journal.events.some(e => e.type === "customization.commit.completed" && (e.payload as any).intentId === intent.eventId)) {
        const p = intent.payload as { before: Pointer; after: Pointer };
        const current = await this.pointer();
        const committed = JSON.stringify(current) === JSON.stringify(p.after);
        if (!committed && JSON.stringify(current) !== JSON.stringify(p.before)) throw new Error("Customization recovery conflict");
        await journal.append("customization.commit.completed", { intentId: intent.eventId, recovered: true, committed });
      }
      return await fn(journal);
    } finally { await journal.close(); }
  }
  async recover() {
    if (await exists(join(this.base, "customization-journal"))) await this.transaction(async () => {});
  }
  async commit(resource: Resource, grants: string[], expectedRevision: number) {
    return this.transaction(async journal => {
      const before = await this.pointer();
      if (before.revision !== expectedRevision) throw new Error("Active customization revision conflict");
      const required = resource.manifest!.requiredCapabilities ?? [];
      if (required.some(c => !grants.includes(c))) throw new Error("Additional capability authorization required");
      await this.load({ name: resource.name, resourceId: resource.id, revision: resource.hash, grantedCapabilities: grants });
      const entry: ActiveCandidate = { name: resource.name, resourceId: resource.id, revision: resource.hash, previous: before.entries[resource.name]?.revision, grantedCapabilities: [...grants] };
      const after: Pointer = { version: 1, revision: before.revision + 1, entries: { ...before.entries, [resource.name]: entry } };
      const intent = await journal.append("customization.commit.intent", { before, after });
      await this.fault?.("after-intent");
      await atomicFile(await safePath(this.workspace, join(this.base, "active-customizations.json")), JSON.stringify(after));
      await this.fault?.("after-pointer");
      await journal.append("customization.commit.completed", { intentId: intent.eventId, committed: true });
      await this.fault?.("after-completion");
      return { revision: after.revision, entry };
    });
  }
  async revision() { return (await this.pointer()).revision; }
  async previous(name: string): Promise<Resource> {
    const entry = (await this.pointer()).entries[name];
    if (!entry?.previous) throw new Error("No previous customization revision");
    return this.load({ ...entry, revision: entry.previous });
  }
}
