import { describe, it, expect } from "vitest";
import { appendFile, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createSession, defineDoc, type ConversationId, type EntryId, type StorageWrite } from "@earendil-works/pi-durable";
import { openJournalStorage } from "../src/pi/journal-storage.js";
import { Journal, readSession } from "../src/journal.js";
import { temporary } from "./helpers.js";

const cid = (n: number) => n as ConversationId;
const eid = (n: number) => n as EntryId;
const conversation = (n: number): StorageWrite => ({ type: "conversation", value: { id: cid(n) } });
const entry = (id: number, text = "original"): StorageWrite => ({ type: "entry", value: { id: eid(id), conversationId: cid(1), kind: "fixture", data: { text } } });
const stateDoc = defineDoc({ kind: "fixture.state", version: 1, scope: "conversation", history: "rewindable", fork: "asOf", initial: () => ({ count: 0 }) });

describe("Durable Journal Storage", () => {
  it("reconstructs atomic conversation/entry/document commits after discarding all memory", async () => {
    const directory = await temporary();
    const handle = await openJournalStorage(directory, context);
    const session = createSession(handle.storage);
    const root = await session.commit(async tx => {
      const root = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await tx.appendEntry(root.id, { kind: "fixture", data: "initial" });
      (await tx.doc(stateDoc, root.id)).count = 1;
      return root;
    }, context);
    const original = await handle.storage.scanEntries({ conversationId: root.id }, 20, undefined, context);
    const firstEntry = original.items[0]!.id;
    await session.commit(async tx => { (await tx.doc(stateDoc, root.id)).count = 2; }, context);
    expect(await session.snapshotAsOf(stateDoc, root.id, firstEntry, context)).toEqual({ count: 1 });
    const branch = await session.commit(tx => tx.forkConversation(root.id, firstEntry, { ownership: { kind: "ownerless" } }), context);
    expect(await session.snapshot(stateDoc, branch.id, context)).toEqual({ count: 1 });
    await session.commit(async tx => { (await tx.doc(stateDoc, branch.id)).count = 3; }, context);
    const before = handle.mappings();
    await session.close(context);
    const restored = await openJournalStorage(directory, context);
    try {
      const session = createSession(restored.storage);
      expect(await session.snapshot(stateDoc, root.id, context)).toEqual({ count: 2 });
      expect(await session.snapshot(stateDoc, branch.id, context)).toEqual({ count: 3 });
      expect(await session.snapshotAsOf(stateDoc, root.id, firstEntry, context)).toEqual({ count: 1 });
      expect(await restored.storage.scanEntries({ conversationId: root.id }, 20, undefined, context)).toEqual(original);
      expect(restored.mappings()).toEqual(before);
      expect((await readdir(directory)).filter(name => name.endsWith(".jsonl"))).toEqual(["journal.jsonl"]);
    } finally { await restored.storage.close(context); }
  });

  it("isolates a partially written unconfirmed batch when rebuilding from the reliable watermark", async () => {
    const directory = await temporary();
    const original = await openJournalStorage(directory, context);
    await original.storage.commit([conversation(1)], context);
    const reliable = original.journal.durableSeq;
    await original.storage.close(context);
    await appendFile(join(directory, "journal.jsonl"), '{"type":"durable.commit","payload":{"writes":');
    const restored = await openJournalStorage(directory, context);
    try {
      expect(await restored.storage.conversation(cid(1), context)).toEqual({ id: 1 });
      expect(restored.journal.events.filter(event => event.seq <= reliable)).toHaveLength(reliable);
      expect(restored.mappings()).toHaveLength(1);
      expect(await restored.storage.entry(eid(2), context)).toBeUndefined();
      await restored.storage.commit([entry(2)], context);
      expect(await restored.storage.entry(eid(2), context)).toBeDefined();
    } finally { await restored.storage.close(context); }
  });

  it("publishes no reliable state before fsync/watermark and detaches queued input", async () => {
    let block = false;
    let entered!: () => void;
    let release!: () => void;
    const barrier = new Promise<void>(r => entered = r);
    const resumed = new Promise<void>(r => release = r);
    const handle = await openJournalStorage(await temporary(), context, { beforeIO: async op => {
      if (block && op === "sync") { entered(); await resumed; }
    } });
    try {
      block = true;
      const first = handle.storage.commit([conversation(1)], context);
      await barrier;
      const queued = [entry(2)];
      const second = handle.storage.commit(queued, context);
      queued[0] = entry(2, "changed");
      expect(await handle.storage.conversation(cid(1), context)).toBeUndefined();
      expect(handle.mappings()).toEqual([]);
      block = false; release();
      const [a, b] = await Promise.all([first, second]);
      expect(b).toBeGreaterThan(a);
      expect((await handle.storage.entry(eid(2), context))!.entry.data).toEqual({ text: "original" });
      const detached = handle.mappings() as unknown as { journalSeq: number }[];
      detached[0]!.journalSeq = -1;
      expect(handle.mappings()[0]!.journalSeq).toBeGreaterThan(0);
    } finally { release(); await handle.storage.close(context); }
  });

  it("drains admitted commits on close and rejects new admission", async () => {
    const directory = await temporary();
    const handle = await openJournalStorage(directory, context);
    const commits = Array.from({ length: 20 }, (_, n) => handle.storage.commit([conversation(n + 1)], context));
    const closed = handle.storage.close(context);
    await expect(handle.storage.commit([conversation(99)], context)).rejects.toThrow("closed");
    await Promise.all(commits); await closed; await handle.storage.close(context);
    const restored = await openJournalStorage(directory, context);
    try { expect((await restored.storage.scanConversations({}, 100, undefined, context)).items).toHaveLength(20); }
    finally { await restored.storage.close(context); }
  });

  it.each(["append", "sync", "watermark.write", "watermark.rename"])("fails closed after %s failure without partially publishing a batch", async failurePoint => {
    let fail = false;
    const directory = await temporary();
    const handle = await openJournalStorage(directory, context, { beforeIO: async op => {
      if (fail && op === failurePoint) throw Object.assign(new Error("fixture ENOSPC"), { code: "ENOSPC" });
    } });
    try {
      await handle.storage.commit([conversation(1)], context);
      fail = true;
      await expect(handle.storage.commit([entry(2), entry(3)], context)).rejects.toThrow("ENOSPC");
      expect(handle.mappings()).toHaveLength(1);
      await expect(handle.storage.commit([entry(4)], context)).rejects.toThrow("poisoned");
      await expect(handle.storage.entry(eid(2), context)).rejects.toThrow("poisoned");
    } finally { fail = false; await handle.storage.close(context); }
    const restored = await openJournalStorage(directory, context);
    try {
      expect(await restored.storage.conversation(cid(1), context)).toEqual({ id: 1 });
      expect(await restored.storage.entry(eid(2), context)).toBeUndefined();
      expect(await restored.storage.entry(eid(3), context)).toBeUndefined();
    } finally { await restored.storage.close(context); }
  });

  it("refuses older Journal format without changing its files", async () => {
    const directory = await temporary(); const old = await Journal.open(directory);
    await old.append("run.started", { legacy: true }); await old.close();
    const before = await readFile(join(directory, "journal.jsonl"));
    const mark = await readFile(join(directory, "durable.json"));
    const files = await readdir(directory);
    await expect(openJournalStorage(directory, context)).rejects.toThrow("Unsupported session format");
    expect(await readFile(join(directory, "journal.jsonl"))).toEqual(before);
    expect(await readFile(join(directory, "durable.json"))).toEqual(mark);
    expect(await readdir(directory)).toEqual(files);
  });

  it("rejects missing artifacts during preflight rather than treating the session as empty", async () => {
    const directory = await temporary(); const handle = await openJournalStorage(directory, context);
    const artifact = await handle.journal.artifact("evidence");
    await handle.journal.append("fixture.evidence", { artifact });
    await handle.storage.close(context);
    await unlink(join(directory, "artifacts", artifact.sha256));
    const before = await readFile(join(directory, "journal.jsonl"));
    await expect(openJournalStorage(directory, context)).rejects.toThrow();
    expect(await readFile(join(directory, "journal.jsonl"))).toEqual(before);
  });

  it("refuses credentials in framework state before any batch is persisted", async () => {
    const directory = await temporary();
    const handle = await openJournalStorage(directory, context, { secrets: ["fixture-secret"] });
    try {
      await handle.storage.commit([conversation(1)], context);
      await expect(handle.storage.commit([entry(2, "fixture-secret")], context)).rejects.toThrow("Credential-bearing");
      await expect(handle.storage.commit([entry(3)], context)).rejects.toThrow("poisoned");
    } finally { await handle.storage.close(context); }
    expect(await readFile(join(directory, "journal.jsonl"), "utf8")).not.toContain("fixture-secret");
    expect((await readSession(directory)).events.filter(event => event.type === "durable.commit")).toHaveLength(1);
  });

  it("refuses invalid record ownership atomically and does not persist non-JSON values", async () => {
    const directory = await temporary(); const handle = await openJournalStorage(directory, context);
    try {
      await expect(handle.storage.commit([conversation(1), conversation(1)], context)).rejects.toThrow();
      expect(handle.mappings()).toEqual([]);
    } finally { await handle.storage.close(context); }
    const second = await openJournalStorage(directory, context);
    try {
      await expect(second.storage.commit([{ type: "entry", value: { id: eid(2), conversationId: cid(1), kind: "fixture", data: NaN } }], context)).rejects.toThrow("JSON");
      expect(second.mappings()).toEqual([]);
    } finally { await second.storage.close(context); }
  });

  it("retains the single-writer lease", async () => {
    const directory = await temporary(); const first = await openJournalStorage(directory, context);
    try {
      await expect(openJournalStorage(directory, context)).rejects.toThrow("busy");
      await first.storage.commit([conversation(1)], context);
    } finally { await first.storage.close(context); }
  });
});
