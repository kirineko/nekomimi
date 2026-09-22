import { realpathSync, existsSync } from "node:fs";
import { readFile, readdir, realpath, lstat, mkdir } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import lockfile from "proper-lockfile";
import { Candidates } from "./candidates.js";
import { Packages } from "./packages.js";
import { atomicFile, hash } from "../journal.js";
import { userHome } from "../storage/paths.js";
import {
  checkManifest,
  type ExtensionManifest,
  type ResourceDescriptor,
  type ResourceSnapshot,
} from "./types.js";
export const LIMITS = {
  resources: 256,
  file: 1024 * 1024,
  package: 8 * 1024 * 1024,
  result: 4 * 1024 * 1024,
  projection: 24000,
  operations: 128,
};
export const inside = (root: string, path: string) => {
  const p = relative(root, path);
  return !isAbsolute(p) && p !== ".." && !p.startsWith(".." + sep);
};
export async function safePath(root: string, path: string): Promise<string> {
  const lexical = resolve(root);
  const requested = resolve(root, path);
  const base = await realpath(root);
  if (!inside(lexical, requested) && !inside(base, requested))
    throw new Error("Resource path outside authorized root");
  const target = inside(base, requested)
    ? requested
    : resolve(base, relative(lexical, requested));
  if (!inside(base, target))
    throw new Error("Resource path outside authorized root");
  let ancestor = target;
  for (;;) {
    try {
      if (!inside(base, await realpath(ancestor)))
        throw new Error("Resource symlink escapes root");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const next = dirname(ancestor);
      if (next === ancestor) throw e;
      ancestor = next;
    }
  }
  return target;
}
export async function boundedRead(path: string): Promise<string> {
  if ((await lstat(path)).size > LIMITS.file)
    throw new Error("Resource file byte limit exceeded");
  const data = await readFile(path, "utf8");
  if (Buffer.byteLength(data) > LIMITS.file)
    throw new Error("Resource file byte limit exceeded");
  return data;
}
export async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export interface Resource extends ResourceDescriptor {
  fileHashes?: Record<string, string>;
  precedenceBase?: { status: ResourceDescriptor["status"]; error?: string };
  packageId?: string;
  packageRevision?: string;
  ruleBinding?: { workspace: string; root: string; include: string[] };
  root: string;
  path: string;
  text: string;
  manifest?: ExtensionManifest;
  files?: Record<string, string>;
  config?: McpConfig;
}
export interface McpConfig {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  credentialEnv?: string;
  oauth?: import("./mcp-oauth.js").McpOAuthConfig;
}
interface Decisions {
  version: 1;
  revision: number;
  userWrites?: boolean;
  entries: Record<string, { enabled: boolean; trusted: boolean; capabilities?: string[] }>;
}
export class Resources {
  readonly home: string;
  readonly decisionsPath: string;
  constructor(
    readonly workspace: string,
    home?: string,
  ) {
    this.workspace = realpathSync.native(workspace);
    const configuredHome = userHome(home);
    this.home = existsSync(configuredHome)
      ? realpathSync.native(configuredHome)
      : configuredHome;
    this.decisionsPath = join(
      this.home,
      "customization",
      hash(this.workspace) + ".json",
    );
  }
  async decisions(): Promise<Decisions> {
    if (!(await exists(this.decisionsPath)))
      return { version: 1, revision: 0, entries: {} };
    const path = await safePath(this.home, this.decisionsPath);
    const data = JSON.parse(await boundedRead(path));
    if (
      data.version !== 1 ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0 ||
      !data.entries ||
      Array.isArray(data.entries) ||
      typeof data.entries !== "object"
    )
      throw new Error("Invalid customization settings");
    return data;
  }
  async decide(
    id: string,
    enabled: boolean,
    trusted: boolean,
    revision: number,
    candidate?: Resource,
  ) {
    const resources = await this.discover();
    if (!resources.some((r) => r.id === id) && !(candidate?.id === id && candidate.source === join(this.workspace, ".nekomimi", "managed", candidate.name, "extension.json")))
      throw new Error("Unknown resource");
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.home, { retries: 3 });
    try {
      const settings = await this.decisions();
      if (settings.revision !== revision)
        throw new Error("Resource settings conflict; reload");
      const target = candidate ?? resources.find(r => r.id === id)!;
      settings.entries[id] = { enabled, trusted, ...(target.manifest?.sdkVersion === 2 ? { capabilities: target.manifest.requiredCapabilities ?? [] } : {}) };
      settings.revision++;
      const folder = await safePath(this.home, dirname(this.decisionsPath));
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await atomicFile(
        await safePath(this.home, this.decisionsPath),
        JSON.stringify(settings),
      );
      return settings.revision;
    } finally {
      await release();
    }
  }
  async allowUserWrites(enabled: boolean, revision: number) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.home, { retries: 3 });
    try {
      const settings = await this.decisions();
      if (settings.revision !== revision)
        throw new Error("Resource settings conflict; reload");
      settings.userWrites = enabled;
      settings.revision++;
      const folder = await safePath(this.home, dirname(this.decisionsPath));
      await mkdir(folder, { recursive: true });
      await atomicFile(
        await safePath(this.home, this.decisionsPath),
        JSON.stringify(settings),
      );
    } finally {
      await release();
    }
  }
  async grant(resource: Resource) {
    const explicit = (await this.decisions()).entries[resource.id];
    if (explicit && (!explicit.enabled || !explicit.trusted)) return explicit;
    if (resource.packageId) {
      const pkg = (await new Packages(this.workspace, this.home).list()).find(p => p.packageId === resource.packageId);
      return pkg?.trusted ? { enabled: true, trusted: true, capabilities: pkg.grants } : undefined;
    }
    return explicit;
  }
  async discover(): Promise<Resource[]> {
    const settings = await this.decisions();
    const output: Resource[] = [];
    const add = (
      kind: Resource["kind"],
      scope: Resource["scope"],
      root: string,
      path: string,
      name: string,
      text: string,
      extra: Partial<Resource> = {},
    ) => {
      if (output.length >= LIMITS.resources)
        throw new Error("Resource count limit exceeded");
      const id = `${kind}:${hash(path).slice(0, 20)}`;
      const decision = settings.entries[id];
      const executable = kind === "extension" || kind === "mcp";
      output.push({
        id,
        kind,
        scope,
        root,
        path,
        source: path,
        name,
        text,
        hash: hash(text),
        status:
          decision?.enabled === false
            ? "disabled"
            : executable && !decision?.trusted
              ? "untrusted"
              : "enabled",
        ...extra,
      });
    };
    const roots = [
      {
        scope: "user" as const,
        root: this.home,
        skills:
          this.home === userHome()
            ? join(homedir(), ".agents", "skills")
            : join(this.home, "skills"),
      },
      {
        scope: "project" as const,
        root: this.workspace,
        skills: join(this.workspace, ".agents", "skills"),
      },
    ];
    for (const { scope, root, skills } of roots) {
      const base = scope === "project" ? join(root, ".nekomimi") : root;
      const extensions = join(base, "extensions");
      if (await exists(extensions)) {
        await safePath(root, extensions);
        for (const entry of (await readdir(extensions)).sort()) {
          const directory = join(extensions, entry);
          let text = "";
          try {
            await safePath(root, directory);
            if (!(await lstat(directory)).isDirectory()) continue;
            const path = await safePath(directory, "extension.json");
            text = await boundedRead(path);
            const manifest = checkManifest(JSON.parse(text));
            const files: Record<string, string> = {};
            let bytes = 0;
            const walk = async (dir: string, depth: number) => {
              if (depth > 12)
                throw new Error("Extension directory depth limit");
              for (const name of (await readdir(dir)).sort()) {
                if (name === "node_modules" || name === ".git") continue;
                const target = await safePath(directory, join(dir, name));
                const st = await lstat(target);
                if (st.isSymbolicLink())
                  throw new Error("Extension symlinks are not supported");
                if (st.isDirectory()) await walk(target, depth + 1);
                else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|svg)$/.test(name)) {
                  const value = await boundedRead(target);
                  bytes += Buffer.byteLength(value);
                  if (
                    bytes > LIMITS.package ||
                    Object.keys(files).length >= 256
                  )
                    throw new Error("Extension package limit");
                  files[relative(directory, target).split(sep).join("/")] = value;
                }
              }
            };
            await walk(directory, 0);
            await safePath(directory, manifest.entry);
            if (!files[manifest.entry])
              throw new Error("Extension entry missing or unsupported");
            add("extension", scope, directory, path, manifest.name, text, {
              manifest,
              files,
              hash: hash(JSON.stringify(files)),
            });
          } catch (e) {
            add(
              "extension",
              scope,
              root,
              join(directory, "extension.json"),
              entry,
              text,
              { status: "error", error: String(e) },
            );
          }
        }
      }
      if (await exists(skills)) {
        // The explicitly selected skills root is the authority, but a symlink root is not.
        if ((await lstat(skills)).isSymbolicLink())
          throw new Error("Skills root symlink rejected");
        const walk = async (dir: string, depth: number) => {
          if (depth > 12) throw new Error("Skill directory depth limit");
          for (const name of (await readdir(dir)).sort()) {
            const path = await safePath(skills, join(dir, name));
            const st = await lstat(path);
            if (st.isSymbolicLink()) throw new Error("Skill symlink rejected");
            if (st.isDirectory()) await walk(path, depth + 1);
            else if (name === "SKILL.md") {
              let text = "";
              try {
                text = await boundedRead(path);
                const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
                  text,
                );
                const meta = header && parse(header[1]!);
                if (
                  !meta ||
                  typeof meta.name !== "string" ||
                  !/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta.name) ||
                  typeof meta.description !== "string" ||
                  !meta.description.trim()
                )
                  throw new Error("Invalid SKILL.md name/description");
                add("skill", scope, skills, path, meta.name, text, {
                  description: meta.description,
                });
              } catch (e) {
                add(
                  "skill",
                  scope,
                  skills,
                  path,
                  relative(skills, path),
                  text,
                  { status: "error", error: String(e) },
                );
              }
            }
          }
        };
        await walk(skills, 0);
      }
      const rule = join(root, "AGENTS.md");
      if (await exists(rule)) {
        const path = await safePath(root, rule);
        add("rule", scope, root, path, "AGENTS.md", await boundedRead(path));
      }
      const mcp = join(base, "mcp.json");
      if (await exists(mcp)) {
        let text = "";
        try {
          text = await boundedRead(await safePath(root, mcp));
          const data = JSON.parse(text);
          if (
            data.version !== 1 ||
            !data.servers ||
            typeof data.servers !== "object"
          )
            throw new Error("Invalid MCP configuration");
          for (const [name, config] of Object.entries(data.servers)) {
            if (!/^[a-z][a-z0-9-]{0,47}$/.test(name))
              throw new Error("Invalid MCP server name");
            add(
              "mcp",
              scope,
              root,
              mcp + "#" + name,
              name,
              JSON.stringify(config),
              { config: config as McpConfig, files: { 'mcp.json': text } },
            );
          }
        } catch (e) {
          add("mcp", scope, root, mcp, "mcp", text, {
            status: "error",
            error: String(e),
          });
        }
      }
    }
    const managed = new Candidates(this.workspace);
    for (const active of await managed.active()) {
      const resource = await managed.load(active);
      const decision = settings.entries[resource.id];
      resource.status = decision?.enabled === false ? "disabled" : decision?.trusted ? "enabled" : "untrusted";
      output.push(resource);
    }
    const packages = new Packages(this.workspace, this.home);
    for (const pkg of await packages.list()) for (const resource of await packages.resources(pkg)) {
      const decision = settings.entries[resource.id];
      if (decision?.enabled === false) resource.status = "disabled";
      else if ((!pkg.trusted || decision?.trusted === false) && ["extension", "mcp", "provider", "workflow", "panel"].includes(resource.kind)) resource.status = "untrusted";
      if (output.length >= LIMITS.resources) throw new Error("Resource count limit exceeded");
      output.push(resource);
    }
    const docs = fileURLToPath(
      new URL("../../extension-docs/", import.meta.url),
    );
    if (await exists(docs))
      for (const name of (await readdir(docs)).sort())
        if (/\.(md|ts|json)$/.test(name)) {
          const path = await safePath(docs, name);
          add("doc", "builtin", docs, path, name, await boundedRead(path));
        }
    return resolveResourcePrecedence(output);
  }
  snapshot(resources: Resource[]): ResourceSnapshot {
    const descriptions = resources
      .filter((r) => r.status === "enabled")
      .map(describe);
    return {
      version: 1,
      revision: hash(JSON.stringify(descriptions)),
      resources: descriptions,
    };
  }
  async read(resource: Resource) {
    if (!["skill", "rule", "doc"].includes(resource.kind))
      throw new Error("Resource is not readable documentation");
    return boundedRead(await safePath(resource.root, resource.path));
  }
  async write(
    kind: "extension" | "skill" | "rule" | "mcp",
    name: string,
    file: string,
    text: string,
    previousHash: string | null,
  ) {
    if (
      !/^[a-z][a-z0-9-]{0,47}$/.test(name) ||
      Buffer.byteLength(text) > LIMITS.file
    )
      throw new Error("Invalid resource write");
    if (!(await this.decisions()).userWrites)
      throw new Error(
        "User resource writing is not authorized; enable it in customization settings",
      );
    const roots = {
      extension: join(this.home, "extensions", name),
      skill:
        this.home === userHome()
          ? join(homedir(), ".agents", "skills", name)
          : join(this.home, "skills", name),
      rule: this.home,
      mcp: this.home,
    };
    if (
      (kind === "rule" && file !== "AGENTS.md") ||
      (kind === "mcp" && file !== "mcp.json")
    )
      throw new Error("Invalid resource filename");
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.home, { retries: 3 });
    try {
      const root = roots[kind];
      await safePath(
        kind === "skill" && this.home === userHome() ? homedir() : this.home,
        root,
      );
      await mkdir(root, { recursive: true });
      const path = await safePath(root, file);
      const old = (await exists(path)) ? await boundedRead(path) : null;
      if ((old === null ? null : hash(old)) !== previousHash)
        throw new Error("Resource changed; read again");
      await mkdir(dirname(path), { recursive: true });
      await atomicFile(path, text);
      return { path, hash: hash(text) };
    } finally {
      await release();
    }
  }
}
export function describe(r: Resource): ResourceDescriptor {
  const {
    id,
    kind,
    name,
    source,
    scope,
    hash,
    status,
    description,
    error,
    shadowedBy,
  } = r;
  return {
    id,
    kind,
    name,
    source,
    scope,
    hash,
    status,
    description,
    error,
    shadowedBy,
  };
}

export function resolveResourcePrecedence(output: Resource[]): Resource[] {
  for (const r of output) {
    r.precedenceBase ??= { status: r.status, error: r.error };
    r.status = r.precedenceBase.status; r.error = r.precedenceBase.error; delete r.shadowedBy;
  }
    const groups = new Map<string, Resource[]>();
    for (const r of output.filter(
      (r) => r.kind !== "rule" && r.kind !== "doc",
    )) {
      const k = r.kind + ":" + r.name;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const group of groups.values()) {
      const project = group.filter((r) => r.scope === "project");
      const selected = project.length ? project : group;
      if (selected.length > 1)
        for (const r of selected) {
          r.status = "error";
          r.error = "Duplicate resource name in the same scope";
        }
      if (project.length)
        for (const r of group.filter((r) => r.scope === "user")) {
          r.status = "shadowed";
          r.shadowedBy = project[0]!.id;
        }
    }
  return output;
}
