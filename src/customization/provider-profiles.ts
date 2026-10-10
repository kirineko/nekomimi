import { ApiError } from "../shared/protocol.js";
import { join } from "node:path";
import { chmod } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { atomicFile } from "../journal.js";
import { inspectDataHome, prepareDataHome, requireNewContract, DATA_FORMAT_VERSION } from "../storage/format.js";
import { safePath, boundedRead, exists } from "./resources.js";
import { assertPhysicalRouting } from "../model-routing.js";
import { ConfigStore } from "../config/store.js";
export const PROVIDER_PURPOSES = ["main","auxiliary","naming","work","create","compaction","session-title","handoff","classifier","image"] as const;
export type ProviderPurpose = typeof PROVIDER_PURPOSES[number];
export type ProfileOperation = "chat" | "classifier" | "image";
export interface ProviderProfile { routing?: "physical"; operation?: ProfileOperation; id: string; providerId: string; resourceId: string; model: string; baseUrl: string; paths: string[]; credentialRef?: string }
export interface Profiles { version: 2; formatVersion: 2; revision: number; entries: Record<string, ProviderProfile>; selection: Partial<Record<ProviderPurpose,string>> }
interface Credentials { version: 2; formatVersion: 2; entries: Record<string, string> }
export class ProviderProfiles {
  constructor(readonly home: string) {}
  private async file(name: string) { return safePath(this.home, name); }
  private async read<T>(name: string, fallback: T): Promise<T> {
    const state = await inspectDataHome(this.home);
    if (state === "missing" || state === "empty") return fallback;
    const file = await this.file(name);
    if (!(await exists(file))) return fallback;
    const value = JSON.parse(await boundedRead(file)); requireNewContract(value, "config", file); return value;
  }
  async list(): Promise<Profiles> {
    const profiles = await this.read<Profiles>("provider-profiles.json", { version: 2, formatVersion: DATA_FORMAT_VERSION, revision: 0, entries: {}, selection: {} });
    if (profiles.version !== 2 || !Number.isSafeInteger(profiles.revision) || !profiles.entries || !profiles.selection || Object.keys(profiles.entries).length > 128) throw new Error("Invalid Provider profiles");
    Object.values(profiles.entries).forEach(p => this.validate(p));
    return profiles;
  }
  private validate(profile: ProviderProfile) {
    assertPhysicalRouting(profile?.routing);
    if (!profile || !/^[a-z][a-z0-9-]{0,47}$/.test(profile.id) || !/^[a-z][a-z0-9-]{0,47}$/.test(profile.providerId) || typeof profile.resourceId !== "string" || !profile.resourceId || typeof profile.model !== "string" || !profile.model || profile.model.length > 128 || !Array.isArray(profile.paths) || !profile.paths.length || profile.paths.length > 16 || profile.paths.some(p => typeof p !== "string" || !/^\/[a-zA-Z0-9/_-]+$/.test(p) || p.startsWith("//")) || (profile.credentialRef !== undefined && !/^[a-z][a-z0-9-]{0,47}$/.test(profile.credentialRef))) throw new Error("Invalid Provider profile");
    if(profile.operation!==undefined && !["chat","classifier","image"].includes(profile.operation))throw new Error("Invalid Provider model operation");
    const url = new URL(profile.baseUrl);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Invalid Provider base URL");
  }
  async save(profile: ProviderProfile, expectedRevision: number) {
    this.validate(profile);
    const clean: ProviderProfile = { ...(profile.routing ? {routing:profile.routing} : {}), id: profile.id, providerId: profile.providerId, resourceId: profile.resourceId, model: profile.model, baseUrl: profile.baseUrl, paths: [...profile.paths], ...(profile.operation?{operation:profile.operation}:{}), ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}) };
    return this.update(expectedRevision, p => { p.entries[profile.id] = clean; });
  }
  async select(purpose: ProviderPurpose, profileId: string | undefined, expectedRevision: number) {
    if (!PROVIDER_PURPOSES.includes(purpose)) throw new Error("Invalid Provider selection purpose");
    return this.update(expectedRevision, p => { if (profileId && !p.entries[profileId]) throw new Error("Unknown Provider profile"); if(profileId && (p.entries[profileId]!.operation??"chat")!==operationForPurpose(purpose))throw new Error("Model operation does not match purpose"); p.selection[purpose] = profileId; });
  }
  private async update(expected: number, change: (profiles: Profiles) => void) {
    await this.list(); await this.credentials();
    const home = await prepareDataHome(this.home), release = await lockfile.lock(home, { retries: { retries: 10, minTimeout: 20, maxTimeout: 100 } });
    try { const profiles = await this.list(); if (profiles.revision !== expected) throw new Error("Provider profile revision conflict"); change(profiles); profiles.revision++; await atomicFile(await this.file("provider-profiles.json"), JSON.stringify(profiles)); return profiles; }
    finally { await release(); }
  }
  async credentials(): Promise<Credentials> {
    const value = await this.read<Credentials>("provider-auth.json", { version: 2, formatVersion: DATA_FORMAT_VERSION, entries: {} });
    if (value.version !== 2 || !value.entries || Object.values(value.entries).some(v => typeof v !== "string" || !v || v.length > 16384)) throw new Error("Invalid Provider credential store");
    return value;
  }
  async saveCredential(ref: string, secret: string | null) {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(ref) || (secret !== null && (typeof secret !== "string" || !secret || secret.length > 16384))) throw new Error("Invalid Provider credential");
    await this.list(); await this.credentials();
    const home = await prepareDataHome(this.home), release = await lockfile.lock(home, { retries: { retries: 10, minTimeout: 20, maxTimeout: 100 } });
    try {
      const credentials = await this.credentials(); if (secret === null) delete credentials.entries[ref]; else credentials.entries[ref] = secret;
      const file = await this.file("provider-auth.json"); await atomicFile(file, JSON.stringify(credentials)); await chmod(file, 0o600);
    } finally { await release(); }
  }
  async resolve(purpose: ProviderPurpose, explicit?: string) {
    const profiles = await this.list(); const fallback = ["work","create","compaction","handoff"].includes(purpose)?"main":purpose==="session-title"?"naming":undefined;
    const id = explicit ?? profiles.selection[purpose] ?? (fallback?profiles.selection[fallback]:undefined);
    if (!id || id === "deepseek") return undefined;
    const profile = profiles.entries[id]; if (!profile) throw new Error("Selected Provider profile unavailable");
    if((profile.operation??"chat")!==operationForPurpose(purpose))throw new Error("Model operation does not match purpose");
    const key = profile.credentialRef ? (await this.credentials()).entries[profile.credentialRef] : undefined;
    if (profile.credentialRef && !key) throw new Error("Provider credential reference unavailable");
    return { profile, apiKey: key, revision: profiles.revision };
  }
  async migrateLegacy(expectedRevision: number, fault?: (stage: string) => void | Promise<void>) {
    const current = await this.list();
    if (current.revision !== expectedRevision || current.entries["legacy-deepseek"]) throw new ApiError(409, "provider_migration_conflict", "Provider migration conflict or already migrated");
    const legacy = await new ConfigStore(this.home).snapshot();
    const backup = await this.file("provider-migration-backup.json");
    if (!(await exists(backup))) { await atomicFile(backup, JSON.stringify({ version: 1, settings: legacy })); await chmod(backup, 0o600); }
    await fault?.("backup-written");
    if (legacy.apiKey) await this.saveCredential("legacy-deepseek", legacy.apiKey);
    await fault?.("credential-written");
    // Existing settings/auth remain usable if the final profile commit fails.
    return this.update(expectedRevision, profiles => {
      profiles.entries["legacy-deepseek"] = { id: "legacy-deepseek", providerId: "deepseek", resourceId: "builtin:deepseek", model: legacy.model, baseUrl: legacy.baseUrl, paths: ["/responses"], ...(legacy.apiKey ? { credentialRef: "legacy-deepseek" } : {}) };
      profiles.selection = { main: "legacy-deepseek", auxiliary: "legacy-deepseek", naming: "legacy-deepseek", ...profiles.selection };
    });
  }
}

export function operationForPurpose(purpose:ProviderPurpose):ProfileOperation { return purpose==="classifier"||purpose==="image"?purpose:"chat"; }
