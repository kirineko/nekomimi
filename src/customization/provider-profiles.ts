import { join } from "node:path";
import { chmod } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { atomicFile } from "../journal.js";
import { directory } from "../storage/paths.js";
import { safePath, boundedRead, exists } from "./resources.js";
import { ConfigStore } from "../config/store.js";
export interface ProviderProfile { id: string; providerId: string; resourceId: string; model: string; baseUrl: string; paths: string[]; credentialRef?: string }
export interface Profiles { version: 1; revision: number; entries: Record<string, ProviderProfile>; selection: { main?: string; auxiliary?: string; naming?: string } }
interface Credentials { version: 1; entries: Record<string, string> }
export class ProviderProfiles {
  constructor(readonly home: string) {}
  private async file(name: string) { return safePath(await directory(this.home), name); }
  private async read<T>(name: string, fallback: T): Promise<T> { const file = await this.file(name); return await exists(file) ? JSON.parse(await boundedRead(file)) : fallback; }
  async list(): Promise<Profiles> {
    const profiles = await this.read<Profiles>("provider-profiles.json", { version: 1, revision: 0, entries: {}, selection: {} });
    if (profiles.version !== 1 || !Number.isSafeInteger(profiles.revision) || !profiles.entries || !profiles.selection || Object.keys(profiles.entries).length > 128) throw new Error("Invalid Provider profiles");
    Object.values(profiles.entries).forEach(p => this.validate(p));
    return profiles;
  }
  private validate(profile: ProviderProfile) {
    if (!profile || !/^[a-z][a-z0-9-]{0,47}$/.test(profile.id) || !/^[a-z][a-z0-9-]{0,47}$/.test(profile.providerId) || typeof profile.resourceId !== "string" || !profile.resourceId || typeof profile.model !== "string" || !profile.model || profile.model.length > 128 || !Array.isArray(profile.paths) || !profile.paths.length || profile.paths.length > 16 || profile.paths.some(p => typeof p !== "string" || !/^\/[a-zA-Z0-9/_-]+$/.test(p) || p.startsWith("//")) || (profile.credentialRef !== undefined && !/^[a-z][a-z0-9-]{0,47}$/.test(profile.credentialRef))) throw new Error("Invalid Provider profile");
    const url = new URL(profile.baseUrl);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Invalid Provider base URL");
  }
  async save(profile: ProviderProfile, expectedRevision: number) {
    this.validate(profile);
    const clean: ProviderProfile = { id: profile.id, providerId: profile.providerId, resourceId: profile.resourceId, model: profile.model, baseUrl: profile.baseUrl, paths: [...profile.paths], ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}) };
    return this.update(expectedRevision, p => { p.entries[profile.id] = clean; });
  }
  async select(purpose: "main" | "auxiliary" | "naming", profileId: string | undefined, expectedRevision: number) {
    if (!["main", "auxiliary", "naming"].includes(purpose)) throw new Error("Invalid Provider selection purpose");
    return this.update(expectedRevision, p => { if (profileId && !p.entries[profileId]) throw new Error("Unknown Provider profile"); p.selection[purpose] = profileId; });
  }
  private async update(expected: number, change: (profiles: Profiles) => void) {
    const home = await directory(this.home), release = await lockfile.lock(home, { retries: { retries: 10, minTimeout: 20, maxTimeout: 100 } });
    try { const profiles = await this.list(); if (profiles.revision !== expected) throw new Error("Provider profile revision conflict"); change(profiles); profiles.revision++; await atomicFile(await this.file("provider-profiles.json"), JSON.stringify(profiles)); return profiles; }
    finally { await release(); }
  }
  async credentials(): Promise<Credentials> {
    const value = await this.read<Credentials>("provider-auth.json", { version: 1, entries: {} });
    if (value.version !== 1 || !value.entries || Object.values(value.entries).some(v => typeof v !== "string" || !v || v.length > 16384)) throw new Error("Invalid Provider credential store");
    return value;
  }
  async saveCredential(ref: string, secret: string | null) {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(ref) || (secret !== null && (typeof secret !== "string" || !secret || secret.length > 16384))) throw new Error("Invalid Provider credential");
    const home = await directory(this.home), release = await lockfile.lock(home, { retries: { retries: 10, minTimeout: 20, maxTimeout: 100 } });
    try {
      const credentials = await this.credentials(); if (secret === null) delete credentials.entries[ref]; else credentials.entries[ref] = secret;
      const file = await this.file("provider-auth.json"); await atomicFile(file, JSON.stringify(credentials)); await chmod(file, 0o600);
    } finally { await release(); }
  }
  async resolve(purpose: "main" | "auxiliary" | "naming", explicit?: string) {
    const profiles = await this.list(); const id = explicit ?? profiles.selection[purpose];
    if (!id || id === "deepseek") return undefined;
    const profile = profiles.entries[id]; if (!profile) throw new Error("Selected Provider profile unavailable");
    const key = profile.credentialRef ? (await this.credentials()).entries[profile.credentialRef] : undefined;
    if (profile.credentialRef && !key) throw new Error("Provider credential reference unavailable");
    return { profile, apiKey: key, revision: profiles.revision };
  }
  async migrateLegacy(expectedRevision: number, fault?: (stage: string) => void | Promise<void>) {
    const current = await this.list();
    if (current.revision !== expectedRevision || current.entries["legacy-deepseek"]) throw new Error("Provider migration conflict or already migrated");
    const legacy = await new ConfigStore(this.home).snapshot();
    const backup = await this.file("provider-migration-backup.json");
    if (!(await exists(backup))) { await atomicFile(backup, JSON.stringify({ version: 1, settings: legacy })); await chmod(backup, 0o600); }
    await fault?.("backup-written");
    if (legacy.apiKey) await this.saveCredential("legacy-deepseek", legacy.apiKey);
    await fault?.("credential-written");
    // Existing settings/auth remain usable if the final profile commit fails.
    return this.update(expectedRevision, profiles => {
      profiles.entries["legacy-deepseek"] = { id: "legacy-deepseek", providerId: "deepseek", resourceId: "builtin:deepseek", model: legacy.model, baseUrl: legacy.baseUrl, paths: ["/responses"], ...(legacy.apiKey ? { credentialRef: "legacy-deepseek" } : {}) };
      profiles.selection = { main: "legacy-deepseek", auxiliary: "legacy-deepseek", naming: "legacy-deepseek" };
    });
  }
}
