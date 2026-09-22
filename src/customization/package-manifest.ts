import { isAbsolute } from "node:path";
import type { PackageManifest } from "./contracts.js";
import { requireCapabilities } from "./contracts.js";
import { CAPABILITIES } from "./types.js";

export function packagePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === ".." || /[:\x00-\x1f]/.test(p))) throw new Error("Invalid package-relative path");
  if (path.split("/").includes("provider-migration-backup.json")) throw new Error("Package cannot include private migration backups");
  if (path.split("/").some(p => [".git", ".nekomimi", "node_modules", "mcp-auth"].includes(p) || /^\.env(?:\.|$)/i.test(p) || /^(?:.*-)?(auth|credentials|settings|journal|durable|profiles)\.json(?:l)?$/i.test(p))) throw new Error("Package cannot include private configuration, state or dependencies as source files");
}
export function checkPackageManifest(value: unknown, available: readonly string[] = CAPABILITIES): PackageManifest {
  const m = value as PackageManifest;
  if (!m || m.manifestVersion !== 1 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z][a-z0-9._-]{0,63}$/.test(m.name) || typeof m.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version) || ![1, 2].includes(m.sdkVersion) || !Array.isArray(m.resources) || m.resources.length < 1 || m.resources.length > 128 || !Array.isArray(m.requiredCapabilities)) throw new Error("Invalid package manifest or unsupported version");
  requireCapabilities(m.requiredCapabilities, available);
  const names = new Set<string>();
  for (const r of m.resources) {
    if (!r || !/^[a-z][a-z0-9-]{0,47}$/.test(r.name) || !["extension", "skill", "rule", "mcp", "provider", "workflow", "panel"].includes(r.kind)) throw new Error("Invalid package resource");
    const key = `${r.kind}:${r.name}`;
    if (names.has(key)) throw new Error("Duplicate package resource");
    names.add(key); packagePath(r.entry);
    const capability = { provider: "providers", workflow: "workflows", panel: "panels" }[r.kind as "provider"];
    if (capability && !m.requiredCapabilities.includes(capability as any)) throw new Error("Resource capability must be declared");
    if (r.kind === "rule") {
      if (!r.ruleScope || typeof r.ruleScope.root !== "string" || !Array.isArray(r.ruleScope.include) || !r.ruleScope.include.length || r.ruleScope.include.some(p => typeof p !== "string" || isAbsolute(p) || p.includes("..") || p.includes("\\"))) throw new Error("Package rules require an explicit target scope");
      if (r.ruleScope.root !== ".") packagePath(r.ruleScope.root);
    } else if (r.ruleScope) throw new Error("Only rules may declare a rule scope");
  }
  if (m.files !== undefined && (!Array.isArray(m.files) || m.files.length > 256)) throw new Error("Invalid package file list");
  m.files?.forEach(packagePath);
  if (!m.dependencies || Array.isArray(m.dependencies) || typeof m.dependencies !== "object" || Object.entries(m.dependencies).some(([name, range]) => !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || typeof range !== "string" || range.length > 100 || /(?:https?:|git|file:|workspace:|npm:)/.test(range))) throw new Error("Only registry semver dependencies are supported");
  return m;
}
