import { expect, it } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { temporary } from "./helpers.js";
import { Candidates } from "../src/customization/candidates.js";
import { Resources } from "../src/customization/resources.js";
import { CustomizationHost } from "../src/customization/host.js";
import { run } from "../src/runtime.js";
import { key } from "./helpers.js";

it("scaffolds, checks and commits immutable content while retaining identity on update and rollback", async () => {
  const workspace = await temporary(), home = await temporary();
  const store = new Candidates(workspace);
  const first = await store.scaffold("review");
  const inspected = await store.inspect(first.id);
  expect(inspected.candidate.report.diagnostics).toEqual([]);
  const prepared = await store.prepare(first.id, inspected.candidate.contentHash);
  await store.commit(prepared.resource, ["commands"], 0);
  const r = (await new Resources(workspace, home).discover()).find(r => r.name === "review")!;
  expect(r.id).toBe(inspected.resource.id); expect(r.status).toBe("untrusted");
  await writeFile(join(first.path, "index.ts"), (await readFile(join(first.path, "index.ts"), "utf8")).replace("Ready", "Updated"));
  await expect(store.prepare(first.id, inspected.candidate.contentHash)).rejects.toThrow("changed since validation");
  const updated = await store.inspect(first.id);
  const next = await store.prepare(first.id, updated.candidate.contentHash);
  await store.commit(next.resource, ["commands"], 1);
  expect(next.resource.id).toBe(r.id);
  const previous = await store.previous("review");
  expect(previous.hash).toBe(r.hash);
  await store.commit(previous, ["commands"], 2);
  expect((await store.active())[0]!.revision).toBe(r.hash);
});
it.each(["after-intent", "after-pointer", "after-completion"])("recovers %s using metadata only and never executes the candidate", async phase => {
  const workspace = await temporary();
  const store = new Candidates(workspace, async p => { if (p === phase) throw new Error("injected crash"); });
  const candidate = await store.scaffold("crash");
  await writeFile(join(candidate.path, "index.ts"), `throw Error('MUST NOT EXECUTE'); export default () => {};`);
  const inspected = await store.inspect(candidate.id);
  const prepared = await store.prepare(candidate.id, inspected.candidate.contentHash);
  await expect(store.commit(prepared.resource, ["commands"], 0)).rejects.toThrow("injected crash");
  const recovered = new Candidates(workspace);
  await recovered.recover(); await recovered.recover();
  expect(await recovered.revision()).toBe(phase === "after-intent" ? 0 : 1);
  expect(await recovered.active()).toHaveLength(phase === "after-intent" ? 0 : 1);
});
it("refuses permission expansion, type failures and tampered immutable content", async () => {
  const store = new Candidates(await temporary());
  const candidate = await store.scaffold("check");
  const inspected = await store.inspect(candidate.id);
  const prepared = await store.prepare(candidate.id, inspected.candidate.contentHash);
  await expect(store.commit(prepared.resource, [], 0)).rejects.toThrow("authorization");
  const { chmod } = await import("node:fs/promises");
  const file = join(prepared.resource.root, "index.ts");
  await chmod(file, 0o600); await writeFile(file, "tampered");
  await expect(store.commit(prepared.resource, ["commands"], 0)).rejects.toThrow("integrity");
  await writeFile(join(candidate.path, "index.ts"), "const bad: number = 'string'; export default () => {}; ");
  const bad = await store.inspect(candidate.id);
  await expect(store.prepare(candidate.id, bad.candidate.contentHash)).rejects.toThrow("type validation");
});
it("activates through the host after authorization and keeps the old version when candidate registration fails", async () => {
  const workspace = await temporary(), home = await temporary();
  const store = new Candidates(workspace), host = new CustomizationHost(workspace, home);
  try {
    const candidate = await store.scaffold("review");
    const checked = (await store.inspect(candidate.id)).candidate;
    await expect(host.requestCandidate(candidate.id, checked.contentHash)).rejects.toThrow("authorization");
    const receipt = await host.requestCandidate(candidate.id, checked.contentHash, true);
    await host.reload(receipt); expect(receipt.status).toBe("activated");
    const first = await run({ workspace, home, customization: host, session: join(workspace, "session"), apiKey: key, prompt: "/review" });
    expect(first.text).toBe("Ready");
    await writeFile(join(candidate.path, "index.ts"), `export default () => { throw Error('registration failure') };`);
    const invalid = (await store.inspect(candidate.id)).candidate;
    const failed = await host.requestCandidate(candidate.id, invalid.contentHash);
    await host.reload(failed); expect(failed.status).toBe("failed");
    expect((await store.active())[0]!.revision).toBe(checked.contentHash);
    const second = await run({ workspace, home, customization: host, session: first.session, apiKey: key, prompt: "/review" });
    expect(second.text).toBe("Ready");
  } finally { await host.close(); }
});
