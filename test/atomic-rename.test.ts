import { afterEach, expect, it, vi } from "vitest";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicRename } from "../src/atomic-rename.js";
import { Journal, readSession } from "../src/journal.js";
import { temporary } from "./helpers.js";

vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
  vi.mocked(rename).mockReset().mockImplementation(fs.rename);
  Object.defineProperty(process, "platform", platform);
  vi.useRealTimers();
});
async function files() {
  const dir = await temporary(), source = join(dir, "next.tmp"), target = join(dir, "durable.json");
  await writeFile(source, "next"); await writeFile(target, "previous");
  return { source, target };
}
it.each(["EPERM", "EACCES", "EBUSY"])("replaces after transient Windows %s without removing the old value", async code => {
  const { source, target } = await files();
  let attempts = 0;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    expect(await readFile(target, "utf8")).toBe("previous");
    if (++attempts <= 2) throw Object.assign(new Error("temporarily locked"), { code });
    return fs.rename(from, to);
  });
  await atomicRename(source, target, "win32");
  expect(await readFile(target, "utf8")).toBe("next");
  await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
});
it("bounds persistent Windows contention and retains both the old value and synced candidate", async () => {
  const { source, target } = await files();
  const failure = Object.assign(new Error("still locked"), { code: "EPERM" });
  vi.mocked(rename).mockRejectedValue(failure);
  vi.useFakeTimers();
  const result = expect(atomicRename(source, target, "win32")).rejects.toBe(failure);
  await vi.runAllTimersAsync(); await result;
  expect(rename).toHaveBeenCalled();
  expect(vi.mocked(rename).mock.calls.length).toBeLessThanOrEqual(21);
  expect(await readFile(target, "utf8")).toBe("previous");
  expect(await readFile(source, "utf8")).toBe("next");
});
it.each([["win32", "ENOSPC"], ["win32", "ENOENT"], ["darwin", "EPERM"], ["linux", "EACCES"]] as const)("fails immediately for %s %s", async (os, code) => {
  const failure = Object.assign(new Error("permanent failure"), { code });
  vi.mocked(rename).mockRejectedValue(failure);
  await expect(atomicRename("source", "target", os)).rejects.toBe(failure);
  expect(rename).toHaveBeenCalledTimes(1);
});
it("publishes a new Journal watermark only after the locked replacement succeeds, without duplicating intent", async () => {
  const dir = await temporary(), journal = await Journal.open(dir, { flushMs: 60_000 });
  try {
    await journal.append("ready", {});
    const previous = await readFile(join(dir, "durable.json"), "utf8");
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    let locked = true;
    vi.mocked(rename).mockImplementation(async (source, target) => {
      if (target === join(journal.directory, "durable.json") && locked) {
        locked = false;
        expect(journal.durableSeq).toBe(1);
        expect(await readFile(target, "utf8")).toBe(previous);
        throw Object.assign(new Error("reader holds watermark"), { code: "EPERM" });
      }
      return fs.rename(source, target);
    });
    await journal.append("tool.intent", { name: "write" }, { toolCallId: "one" });
    expect(locked).toBe(false);
    expect(journal.failure.signal.aborted).toBe(false);
    expect(journal.durableSeq).toBe(2);
    const snapshot = await readSession(dir);
    expect(snapshot.durableSeq).toBe(2);
    expect(snapshot.events.filter(e => e.type === "tool.intent")).toHaveLength(1);
  } finally { await journal.close(); }
});
it("fails the Journal closed when Windows replacement remains locked", async () => {
  const dir = await temporary(), journal = await Journal.open(dir, { flushMs: 60_000 });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await journal.append("ready", {});
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    vi.mocked(rename).mockImplementation(async (source, target) => {
      if (target === join(journal.directory, "durable.json")) throw Object.assign(new Error("still locked"), { code: "EPERM", syscall: "rename" });
      return fs.rename(source, target);
    });
    await expect(journal.append("tool.intent", {}, { toolCallId: "unknown" })).rejects.toMatchObject({ operation: "watermark.rename" });
    expect(journal.failure.signal.aborted).toBe(true);
    expect(journal.durableSeq).toBe(1);
    await expect(journal.append("tool.completed", {}, { toolCallId: "unknown" })).rejects.toThrow();
    const snapshot = await readSession(dir);
    expect(snapshot.durableSeq).toBe(1);
    expect(snapshot.events.some(e => e.type === "tool.completed")).toBe(false);
  } finally { await journal.close(); stderr.mockRestore(); }
});
