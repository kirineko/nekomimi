import { ExtensionProcess } from "./process.js";
import { PROCESS_LIMITS } from "./rpc.js";
import { checkTypes } from "./validation.js";
import { Candidates } from "./candidates.js";
import { Packages, type PackageCandidate } from "./packages.js";
import { McpOAuth } from "./mcp-oauth.js";
import { ProviderRegistry, type RegisteredProvider } from "./provider-registry.js";
import { ProviderProfiles } from "./provider-profiles.js";
import type { RegisteredWorkflow } from "./workflow-contract.js";
import { Panels } from "./panels.js";
import type { BuiltPanel } from "./panel-build.js";
import { Workflows } from "./workflows.js";
import ts from "typescript";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, id } from "../journal.js";
import {
  Resources,
  resolveResourcePrecedence,
  describe,
  safePath,
  exists,
  LIMITS,
  type Resource,
} from "./resources.js";
import { McpConnection } from "./mcp.js";
import type {
  ExtensionAPI,
  ExtensionTool,
  ExtensionCommand,
  Hook,
  HookEvent,
  ExtensionContext,
  ResourceSnapshot,
} from "./types.js";
export interface LoadedExtension {
  providers: RegisteredProvider[];
  workflows: RegisteredWorkflow[];
  panels: BuiltPanel[];
  resource: Resource;
  unavailable?: () => boolean;
  tools: ExtensionTool[];
  commands: Map<string, ExtensionCommand>;
  hooks: Map<
    Hook,
    ((
      e: HookEvent,
      ctx: ExtensionContext,
    ) => Promise<void | { block: string }>)[]
  >;
  dispose: (() => void | Promise<void>)[];
}
export interface Activation {
  revision: string;
  resources: Resource[];
  extensions: LoadedExtension[];
  mcp: McpConnection[];
  snapshot: ResourceSnapshot;
}
export interface ReloadReceipt {
  id: string;
  status: "pending" | "activated" | "failed";
  revision?: string;
  error?: string;
}
export async function deadline<T>(promise: Promise<T>, ms = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Extension operation timed out")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function validateExtension(r: Resource): Promise<string[]> {
  if (!r.manifest || !r.files) return [r.error ?? "Missing extension manifest"];
  const errors: string[] = [];
  const require = createRequire(join(r.root, "extension.json"));
  for (const [name, source] of Object.entries(r.files)) {
    if (!/\.[cm]?[jt]s$/.test(name)) continue;
    const parsed = ts.transpileModule(source, {
      fileName: name,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    });
    for (const d of parsed.diagnostics ?? [])
      if (d.category === ts.DiagnosticCategory.Error)
        errors.push(
          `${name}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
        );
    const info = ts.preProcessFile(source);
    for (const imp of info.importedFiles) {
      if (
        imp.fileName === "nekomimi/extensions" ||
        imp.fileName.startsWith("node:")
      )
        continue;
      try {
        if (imp.fileName.startsWith(".")) {
          await safePath(
            r.root,
            join(dirname(join(r.root, name)), imp.fileName),
          );
          const rel = join(dirname(name), imp.fileName);
          if (
            ![
              rel,
              rel + ".ts",
              rel.replace(/\.js$/, ".ts"),
              join(rel, "index.ts"),
            ].some((p) => r.files![p] !== undefined)
          )
            throw new Error("Local import missing");
        } else require.resolve(imp.fileName);
      } catch {
        errors.push(`${name}: Missing or invalid import ${imp.fileName}`);
      }
    }
  }
  if (!errors.length) errors.push(...checkTypes(r).diagnostics.map(d => `${d.file ?? r.source}:${d.line ?? 0}:${d.column ?? 0}: ${d.stage} ${d.code}: ${d.message}`));
  return errors;
}
export class CustomizationHost {
  readonly catalog: Resources;
  readonly oauth: McpOAuth;
  readonly workflows: Workflows;
  readonly panels = new Panels(this);
  active?: Activation;
  busy = false;
  degraded?: string;
  receipts: ReloadReceipt[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private candidateCommits = new Map<string, { resource: Resource; grants: string[]; expectedRevision: number }>();
  private packageCommits = new Map<string, { candidate: PackageCandidate; grants: string[]; expectedRevision: number }>();
  private packageRemovals = new Map<string, { packageId: string; expectedRevision: number }>();
  private pinned = false;
  constructor(workspace: string, home?: string) {
    this.catalog = new Resources(workspace, home);
    this.oauth = new McpOAuth(this.catalog.home);
    this.workflows = new Workflows(this, { apiKey: "" });
  }
  private exclusive<T>(fn: () => Promise<T>) {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => {});
    return p;
  }
  private nextReloadId = id();
  reserveReloadId(): string {
    return this.receipts.find(r => r.status === "pending")?.id ?? this.nextReloadId;
  }
  requestReload(): ReloadReceipt {
    const pending = this.receipts.find((r) => r.status === "pending");
    if (pending) return pending;
    const receipt: ReloadReceipt = { id: this.nextReloadId, status: "pending" };
    this.nextReloadId = id();
    this.receipts.push(receipt);
    this.receipts = this.receipts.slice(-30);
    if (!this.busy) void this.reload(receipt);
    return receipt;
  }
  async requestCandidate(candidateId: string, expectedHash: string, authorize = false): Promise<ReloadReceipt> {
    const store = new Candidates(this.catalog.workspace);
    const { resource } = await store.prepare(candidateId, expectedHash);
    return this.queueCandidate(resource, authorize);
  }
  async requestRollback(name: string, authorize = false) {
    return this.queueCandidate(await new Candidates(this.catalog.workspace).previous(name), authorize);
  }
  async requestPackage(candidateId: string, scope: "project" | "user", authorize = false) {
    return this.exclusive(async () => {
      if (this.receipts.some(r => r.status === "pending")) throw new Error("Another customization change is pending");
      const packages = new Packages(this.catalog.workspace, this.catalog.home);
      const candidate = await packages.candidate(scope, candidateId);
      const previous = (await packages.list()).find(p => p.packageId === candidate.packageId);
      const grants = await packages.permissions(candidate);
      if (!authorize && (!previous?.trusted || grants.some(g => !previous.grants.includes(g)))) throw new Error("Package requires authorization for source, capabilities or targets");
      const receipt: ReloadReceipt = { id: this.nextReloadId, status: "pending" };
      this.nextReloadId = id();
      this.packageCommits.set(receipt.id, { candidate, grants, expectedRevision: await packages.revision(scope) });
      this.receipts.push(receipt); this.receipts = this.receipts.slice(-30);
      if (!this.busy) void this.reload(receipt);
      return receipt;
    });
  }
  async removePackage(packageId: string) {
    return this.exclusive(async () => {
      if (this.receipts.some(r => r.status === "pending")) throw new Error("Another customization change is pending");
      const packages = new Packages(this.catalog.workspace, this.catalog.home);
      const candidate = (await packages.list()).find(p => p.packageId === packageId);
      if (!candidate) throw new Error("Unknown installed package");
      const receipt: ReloadReceipt = { id: this.nextReloadId, status: "pending" };
      this.nextReloadId = id();
      this.packageRemovals.set(receipt.id, { packageId, expectedRevision: await packages.revision(candidate.scope) });
      this.receipts.push(receipt); this.receipts = this.receipts.slice(-30);
      if (!this.busy) void this.reload(receipt);
      return receipt;
    });
  }
  private async queueCandidate(resource: Resource, authorize: boolean): Promise<ReloadReceipt> {
    return this.exclusive(async () => {
    if (this.receipts.some(r => r.status === "pending")) throw new Error("Another customization change is pending");
    const settings = await this.catalog.decisions();
    const prior = settings.entries[resource.id];
    const store = new Candidates(this.catalog.workspace);
    const active = (await store.active()).find(r => r.resourceId === resource.id);
    const required = resource.manifest?.requiredCapabilities ?? [];
    const expanded = required.some(c => !(prior?.capabilities ?? active?.grantedCapabilities ?? []).includes(c));
    if (!authorize && (!prior?.enabled || !prior.trusted || expanded)) throw new Error("Candidate requires explicit authorization for code and capabilities");
    if (authorize) await this.catalog.decide(resource.id, true, true, settings.revision, resource);
    resource.status = "enabled";
    const receipt: ReloadReceipt = { id: this.nextReloadId, status: "pending" };
    this.nextReloadId = id();
    this.candidateCommits.set(receipt.id, { resource, grants: required, expectedRevision: await store.revision() });
    this.receipts.push(receipt);
    this.receipts = this.receipts.slice(-30);
    if (!this.busy) void this.reload(receipt);
    return receipt;
    });
  }
  async describe() {
    const resources = await this.catalog.discover();
    return {
      version: 1,
      resources: resources.map(describe),
      settingsRevision: (await this.catalog.decisions()).revision,
      userWrites: (await this.catalog.decisions()).userWrites ?? false,
      oauth: await Promise.all(resources.filter(r => r.kind === "mcp" && r.config?.oauth).map(async r => {
        try { return await this.oauth.describe(r); } catch { return { server: r.id, status: "invalid_configuration" }; }
      })),
      mcp:
        this.active?.mcp.map((m) => ({
          id: m.resource.id,
          diagnostics: m.diagnostic,
          toolErrors: m.toolErrors,
          content: m.catalog(),
        })) ?? [],
      activeRevision: this.active?.revision,
      activeResources: this.active?.snapshot.resources ?? [],
      busy: this.busy,
      degraded: this.degraded,
      receipts: this.receipts,
      candidates: await new Candidates(this.catalog.workspace).list(),
      managed: await new Candidates(this.catalog.workspace).active(),
      packages: await new Packages(this.catalog.workspace, this.catalog.home).list(),
      packageCandidates: await new Packages(this.catalog.workspace, this.catalog.home).drafts(),
      providers: new ProviderRegistry(this.active?.extensions.flatMap(e => e.providers) ?? []).catalog(),
      providerProfiles: await new ProviderProfiles(this.catalog.home).list(),
      panels: this.panels.catalog(),
      workflowDefinitions: this.active?.extensions.flatMap(e => e.workflows.map(w => ({ resourceId: e.resource.id, resourceName: e.resource.name, id: w.id, revision: e.resource.hash, schemaVersion: w.schemaVersion, entry: w.entry, steps: Object.keys(w.steps), inputSchema: w.inputSchema }))) ?? [],
      workflows: (await this.workflows.list()).slice(-100).map(({ input, output, snapshot, ...state }) => ({ ...state, outputPreview: output === undefined ? undefined : JSON.stringify(output).slice(0, 2000) })),
    };
  }
  async acquire() {
    return this.exclusive(async () => {
      if (this.busy) throw new Error("Customization runtime busy");
      if (this.degraded) throw new Error(this.degraded);
      await new Candidates(this.catalog.workspace).recover();
      await new Packages(this.catalog.workspace, this.catalog.home).recover();
      if (!this.active || this.active.mcp.some((m) => m.changed || m.stale) || this.active.extensions.some(e => e.unavailable?.()))
        await this.activate();
      this.busy = true;
      return this.active!;
    });
  }
  async release() {
    await this.exclusive(async () => {
    this.busy = false;
    if (this.pinned) {
      this.pinned = false;
      this.requestReload();
    }
    if (this.active?.mcp.some((m) => m.changed)) this.requestReload();
    });
    const pending = this.receipts.find((r) => r.status === "pending");
    if (pending) await this.reload(pending);
    if (!this.workflows.busy) await this.workflows.drain();
  }
  async acquirePinned(pinned: Resource[]) {
    return this.exclusive(async () => {
      if (this.busy) throw new Error("Customization runtime busy");
      if (this.degraded) throw new Error(this.degraded);
      for (const resource of pinned.filter(r => !!r.manifest)) {
        const grant = await this.catalog.grant(resource);
        if (!grant?.enabled || !grant.trusted || resource.manifest!.requiredCapabilities?.some(c => !grant.capabilities?.includes(c))) throw new Error("Pinned workflow authorization revoked or package uninstalled");
      }
      const ids = new Set(pinned.map(r => r.id)), packages = new Set(pinned.map(r => r.packageId).filter(Boolean));
      const resources = (await this.catalog.discover()).filter(r => !ids.has(r.id) && (!r.packageId || !packages.has(r.packageId)) && !pinned.some(p => p.kind !== "rule" && p.kind === r.kind && p.name === r.name));
      await this.activate([...resources, ...pinned]);
      this.pinned = true; this.busy = true;
      return this.active!;
    });
  }
  async reload(receipt: ReloadReceipt) {
    return this.exclusive(async () => {
      if (this.busy || receipt.status !== "pending") return;
      try {
        const pending = this.candidateCommits.get(receipt.id);
        const packagePending = this.packageCommits.get(receipt.id);
        const removal = this.packageRemovals.get(receipt.id);
        if (removal) {
          const resources = (await this.catalog.discover()).filter(r => r.packageId !== removal.packageId);
          await this.activate(resources, () => new Packages(this.catalog.workspace, this.catalog.home).uninstall(removal.packageId, removal.expectedRevision));
        } else if (packagePending) {
          const packages = new Packages(this.catalog.workspace, this.catalog.home);
          const resources = (await this.catalog.discover()).filter(r => r.packageId !== packagePending.candidate.packageId);
          const added = await packages.resources(packagePending.candidate);
          for (const resource of added) if (resource.kind !== "rule" && resources.some(r => r.kind === resource.kind && r.scope === resource.scope && r.name === resource.name)) throw new Error("Duplicate package resource name in the same scope");
          resources.push(...added);
          await this.activate(resources, async () => { await packages.commit(packagePending.candidate, packagePending.grants, packagePending.expectedRevision); });
        } else if (pending) {
          const resources = (await this.catalog.discover()).filter(r => r.id !== pending.resource.id);
          if (resources.some(r => r.kind === pending.resource.kind && r.scope === pending.resource.scope && r.name === pending.resource.name)) throw new Error("Duplicate resource name in the same scope");
          resources.push(pending.resource);
          await this.activate(resources, async () => {
            await new Candidates(this.catalog.workspace).commit(pending.resource, pending.grants, pending.expectedRevision);
          });
        } else await this.activate();
        receipt.status = "activated";
        receipt.revision = this.active!.revision;
      } catch (e) {
        receipt.status = "failed";
        receipt.error = String(e);
      } finally {
        this.candidateCommits.delete(receipt.id);
        this.packageCommits.delete(receipt.id);
        this.packageRemovals.delete(receipt.id);
      }
    });
  }
  private async dispose(a: Activation) {
    const failures: unknown[] = [];
    for (const e of [...a.extensions].reverse())
      for (const handler of [...e.dispose].reverse())
        try {
          await deadline(Promise.resolve().then(handler), 6500);
        } catch (err) {
          failures.push(err);
        }
    for (const m of a.mcp)
      try {
        await deadline(m.close(), 8000);
      } catch (err) {
        failures.push(err);
      }
    if (failures.length)
      throw new Error("Extension cleanup failed; restart required");
  }
  async trial(resourceId: string, candidate?: Resource) {
    if (this.busy || this.active)
      throw new Error("Trial requires a fresh host");
    const resource = candidate ?? (await this.catalog.discover()).find(
      (r) => r.id === resourceId,
    );
    if (
      !resource ||
      resource.kind !== "extension" ||
      resource.status !== "enabled"
    )
      throw new Error("Trial requires an explicitly enabled trusted extension");
    const grant = (await this.catalog.decisions()).entries[resourceId];
    if (!grant?.enabled || !grant.trusted || resource.id !== resourceId) throw new Error("Trial resource not authorized");
    await this.activate([resource]);
  }
  private async activate(selected?: Resource[], beforeSwitch?: () => Promise<void>) {
    const resources = resolveResourcePrecedence(selected ?? (await this.catalog.discover()));
    const invalid = resources.filter((r) => r.status === "error");
    if (invalid.length)
      throw new Error(invalid.map((r) => `${r.source}: ${r.error}`).join("\n"));
    const snapshot = this.catalog.snapshot(resources);
    const candidate: Activation = {
      resources,
      extensions: [],
      mcp: [],
      snapshot,
      revision: snapshot.revision,
    };
    try {
      const groups = new Map<string, Resource[]>();
      for (const resource of resources.filter(r => r.status === "enabled" && ["extension", "provider", "workflow", "panel"].includes(r.kind))) {
        const group = resource.packageId ?? resource.id;
        groups.set(group, [...(groups.get(group) ?? []), resource]);
      }
      if (groups.size > PROCESS_LIMITS.processes) throw new Error("Active extension process budget exceeded");
      for (const group of groups.values()) {
        for (const resource of group) {
          const errors = await validateExtension(resource);
          if (errors.length) throw new Error(`${resource.source}: ${errors.join("\n")}`);
        }
        candidate.extensions.push(...await new ExtensionProcess(group[0]!, this.catalog, group.slice(1)).start());
      }
      new ProviderRegistry(candidate.extensions.flatMap(e => e.providers));
      const panelIds = candidate.extensions.flatMap(e => e.panels.map(p => `${e.resource.id}:${p.id}`));
      if (new Set(panelIds).size !== panelIds.length) throw new Error("Duplicate panel identity");
      const workflowIds = candidate.extensions.flatMap(e => e.workflows.map(w => `${e.resource.id}:${w.id}`));
      if (new Set(workflowIds).size !== workflowIds.length) throw new Error("Duplicate workflow definition identity");
      for (const r of resources.filter(
        (r) => r.status === "enabled" && r.kind === "mcp",
      )) {
        const m = new McpConnection(r, this.catalog.workspace, this.oauth);
        candidate.mcp.push(m);
        try { await m.connect(); }
        catch (e) { throw new Error(`${r.source}: ${String(e)}`); }
      }
      const schemas = candidate.mcp.map((m) => ({
        id: m.resource.id,
        server: m.serverInfo,
        tools: m.tools,
        resources: m.resources, templates: m.templates, prompts: m.prompts,
      }));
      candidate.revision = hash(JSON.stringify({ snapshot, schemas }));
      candidate.snapshot = { ...snapshot, revision: candidate.revision };
      await beforeSwitch?.();
    } catch (e) {
      try {
        await this.dispose(candidate);
      } catch (cleanup) {
        this.degraded = String(cleanup);
      }
      throw e;
    }
    if (this.active)
      try {
        await this.dispose(this.active);
      } catch (e) {
        await this.dispose(candidate).catch(() => {});
        this.degraded = String(e);
        throw e;
      }
    this.active = candidate;
  }
  async close() {
    this.oauth.close();
    this.panels.close();
    await this.workflows.close();
    await this.tail;
    if (this.active) await this.dispose(this.active);
    this.active = undefined;
  }
}
