import { join } from "node:path";
import { Journal, id, readArtifact, type JournalOptions } from "../journal.js";
import { safePath } from "./resources.js";
import type { Json } from "./types.js";
interface StateWrite { resourceId: string; key: string; schemaVersion: number; expectedRevision: number; value: Json; fromSchemaVersion?: number }
export class WorkspaceState {
  constructor(readonly workspace: string, private options: JournalOptions = {}) {}
  private validate(key: string, version: number) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(key) || !Number.isSafeInteger(version) || version < 1) throw new Error("Invalid workspace state key/schema");
  }
  private async open() {
    const path = await safePath(this.workspace, ".nekomimi/workspace-state");
    for (let attempt = 0; ; attempt++) {
      try { return await Journal.open(path, this.options); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || attempt >= 100) throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
    }
  }
  async get(resourceId: string, key: string, schemaVersion: number) {
    this.validate(key, schemaVersion); const journal = await this.open();
    try {
      const found = journal.events.findLast(e => e.type === "workspace.state.updated" && e.resourceId === resourceId && (e.payload as any).key === key);
      if (!found) return undefined;
      const p = found.payload as any;
      if (p.schemaVersion !== schemaVersion) throw new Error("Workspace state schema incompatible; explicit migration required");
      return { revision: p.revision as number, value: JSON.parse((await readArtifact(journal.directory, p.value)).toString()) as Json };
    } finally { await journal.close(); }
  }
  private async apply(messageId: string, write: StateWrite) {
    this.validate(write.key, write.schemaVersion);
    if (!Number.isSafeInteger(write.expectedRevision) || write.expectedRevision < 0 || Buffer.byteLength(JSON.stringify(write.value)) > 1024 * 1024) throw new Error("Workspace state value/revision limit");
    const journal = await this.open();
    try {
      const duplicate = journal.events.find(e => e.type === "workspace.state.updated" && (e.payload as any).messageId === messageId);
      if (duplicate) return (duplicate.payload as any).revision as number;
      const old = journal.events.findLast(e => e.type === "workspace.state.updated" && e.resourceId === write.resourceId && (e.payload as any).key === write.key)?.payload as any;
      if ((old?.revision ?? 0) !== write.expectedRevision) throw new Error("Workspace state CAS conflict");
      if (old && old.schemaVersion !== (write.fromSchemaVersion ?? write.schemaVersion)) throw new Error("Workspace state schema incompatible; explicit migration required");
      const revision = write.expectedRevision + 1;
      await journal.append("workspace.state.updated", { messageId, key: write.key, schemaVersion: write.schemaVersion, revision, value: await journal.artifact(JSON.stringify(write.value)), ...(write.fromSchemaVersion ? { migration: { from: write.fromSchemaVersion, previous: old?.value } } : {}) }, { resourceId: write.resourceId });
      return revision;
    } finally { await journal.close(); }
  }
  async set(source: Journal, write: StateWrite, fault?: (stage: string) => void | Promise<void>) {
    const messageId = id();
    // The origin journal owns the outbox; the destination deduplicates by this ID.
    await source.append("state.outbox.enqueued", { messageId, operation: await source.artifact(JSON.stringify(write)) }, { resourceId: write.resourceId });
    await fault?.("outbox-written");
    return this.deliver(source, messageId, fault);
  }
  private async deliver(source: Journal, messageId: string, fault?: (stage: string) => void | Promise<void>) {
    const completed = source.events.find(e => e.type === "state.outbox.delivered" && (e.payload as any).messageId === messageId);
    if (completed) return (completed.payload as any).revision as number;
    const event = source.events.find(e => e.type === "state.outbox.enqueued" && (e.payload as any).messageId === messageId)!;
    const write = JSON.parse((await readArtifact(source.directory, (event.payload as any).operation)).toString()) as StateWrite;
    let revision: number;
    try { revision = await this.apply(messageId, write); }
    catch (error) {
      if (/Workspace state (CAS conflict|schema incompatible|value\/revision limit)|Invalid workspace state key\/schema/.test(String(error))) await source.append("state.outbox.rejected", { messageId, reason: String(error) }, { resourceId: write.resourceId });
      throw error;
    }
    await fault?.("state-written");
    await source.append("state.outbox.delivered", { messageId, revision }, { resourceId: write.resourceId }); await fault?.("outbox-delivered");
    return revision;
  }
  async recover(source: Journal) {
    const delivered = new Set(source.events.filter(e => ["state.outbox.delivered", "state.outbox.rejected"].includes(e.type)).map(e => (e.payload as any).messageId));
    for (const event of source.events.filter(e => e.type === "state.outbox.enqueued" && !delivered.has((e.payload as any).messageId))) await this.deliver(source, (event.payload as any).messageId);
  }
  async migrate(source: Journal, write: StateWrite & { fromSchemaVersion: number }) {
    if (!Number.isSafeInteger(write.fromSchemaVersion) || write.fromSchemaVersion < 1 || write.fromSchemaVersion === write.schemaVersion) throw new Error("Invalid explicit state migration");
    return this.set(source, write);
  }
}
