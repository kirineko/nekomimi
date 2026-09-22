import { Packages } from "./packages.js";
import type { CustomizationHost } from "./host.js";
import type { PackageSource } from "./contracts.js";
import { safePath } from "./resources.js";

export function packageSource(value: unknown): PackageSource {
  if (!value || typeof value !== "object") throw new Error("Package source must be an object");
  const v = value as Record<string, unknown>;
  if (v.kind === "local" && typeof v.path === "string") return { kind: "local", path: v.path };
  if (v.kind === "npm" && typeof v.name === "string" && typeof v.version === "string" && typeof v.registry === "string") return { kind: "npm", name: v.name, version: v.version, registry: v.registry };
  if (v.kind === "git" && typeof v.url === "string" && typeof v.commit === "string") return { kind: "git", url: v.url, commit: v.commit };
  throw new Error("Invalid package source");
}
/** Model requests cannot grant themselves authorization or read arbitrary local sources. */
export async function packageAction(host: CustomizationHost, value: Record<string, unknown>, options: { user: boolean; signal?: AbortSignal }) {
  const store = new Packages(host.catalog.workspace, host.catalog.home);
  const scope = value.scope === undefined ? "project" : value.scope;
  if (scope !== "project" && scope !== "user") throw new Error("Invalid package scope");
  const action = value.action, id = String(value.id ?? "");
  if (action === "list") return { installed: await store.list(), candidates: await store.drafts() };
  if (action === "inspect") return store.preview(scope, id);
  if (!options.user && scope === "user" && !(await host.catalog.decisions()).userWrites) throw new Error("User resource writing requires authorization");
  if (action === "collect") {
    if (!options.user) throw new Error("Package cache collection requires an explicit user operation");
    if (host.busy) throw new Error("Package cache collection requires an idle runtime");
    if (!Array.isArray(value.discardCandidates ?? []) || (value.discardCandidates as unknown[] | undefined)?.some(v=>typeof v!=="string")) throw new Error("Invalid candidate cleanup list");
    return store.collect(scope, (value.discardCandidates ?? []) as string[], host.active?.resources.map(r=>r.packageRevision).filter((r):r is string=>!!r));
  }
  if (action === "prepare") {
    const source = packageSource(value.source);
    if (!options.user && source.kind === "local") source.path = await safePath(host.catalog.workspace, source.path);
    if (!options.user && source.kind === "git" && !source.url.startsWith("https://")) source.url = await safePath(host.catalog.workspace, source.url);
    const bindings = value.bindings ?? {};
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings) || Object.values(bindings).some(v => typeof v !== "string")) throw new Error("Rule bindings must map names to workspace paths");
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
    return store.prepare(source, scope, bindings as Record<string, string>, signal);
  }
  if (action === "activate") return host.requestPackage(id, scope, options.user && value.authorize === true);
  const installed = (await store.list()).find(p => p.packageId === id);
  if (!installed) throw new Error("Unknown installed package");
  if (!options.user && installed.scope === "user" && !(await host.catalog.decisions()).userWrites) throw new Error("User resource writing requires authorization");
  if (action === "rollback") { const previous = await store.previous(id); return host.requestPackage(previous.id, previous.scope, options.user && value.authorize === true); }
  if (action === "export") return store.export(id, String(value.output ?? ""));
  if (action === "uninstall") return host.removePackage(id);
  throw new Error("Unknown package action");
}
