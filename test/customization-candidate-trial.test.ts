import { expect, it } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Candidates } from "../src/customization/candidates.js";
import { trialCandidate } from "../src/customization/trial.js";
import { CustomizationHost } from "../src/customization/host.js";
import { readSession } from "../src/journal.js";
import { run } from "../src/runtime.js";
import { temporary, key, response, textItem } from "./helpers.js";
it("keeps mock trials separate from explicitly activated real tool execution", async () => {
  const workspace = await temporary(), home = await temporary();
  const store = new Candidates(workspace), candidate = await store.scaffold("trial");
  await writeFile(join(candidate.path, "extension.json"), JSON.stringify({ name: "trial", sdkVersion: 2, entry: "index.ts", requiredCapabilities: ["commands", "tools", "model"] }));
  await writeFile(join(candidate.path, "index.ts"), `import type {ExtensionFactory} from 'nekomimi/extensions'; export default ((api)=>{api.registerCommand('trial',{description:'trial',async handler(a,c){await c.callTool('write',{path:'effect.txt',content:'real'});return c.model('review')}})}) satisfies ExtensionFactory;`);
  const checked = (await store.inspect(candidate.id)).candidate;
  const trial = await trialCandidate(workspace, home, candidate.id, checked.contentHash, "/trial", true, { model: "mock answer", mockResults: { write: { content: [{ type: "text", text: "mock write" }] } } });
  expect(trial.simulated).toBe(true); expect(trial.text).toBe("mock answer");
  expect(await store.active()).toEqual([]);
  await expect(readFile(join(workspace, "effect.txt"))).rejects.toThrow();
  const trialEvents = (await readSession(trial.session)).events;
  expect(trialEvents.some(e => e.type === "trial.started" && (e.payload as any).simulated)).toBe(true);
  expect(trialEvents.some(e => e.type === "trial.model")).toBe(true);
  const host = new CustomizationHost(workspace, home);
  try {
    const receipt = await host.requestCandidate(candidate.id, checked.contentHash);
    await host.reload(receipt); expect(receipt.status).toBe("activated");
    const result = await run({ workspace, home, customization: host, session: join(workspace, "real-session"), apiKey: key, prompt: "/trial", fetch: async () => response([textItem()]) });
    expect(result.status).toBe("completed");
    expect(await readFile(join(workspace, "effect.txt"), "utf8")).toBe("real");
    expect((await readSession(result.session)).events.some(e => e.type === "tool.intent")).toBe(true);
    expect(result.session).not.toBe(trial.session);
  } finally { await host.close(); }
});
it("cancels a trial without changing active pointers and refuses newly requested grants", async () => {
  const workspace = await temporary(), home = await temporary();
  const store = new Candidates(workspace), candidate = await store.scaffold("loop");
  await writeFile(join(candidate.path, "index.ts"), `import type {ExtensionFactory} from 'nekomimi/extensions'; export default ((api)=>{api.registerCommand('loop',{description:'loop',async handler(){while(true){} }})}) satisfies ExtensionFactory;`);
  const checked = (await store.inspect(candidate.id)).candidate;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try { await expect(trialCandidate(workspace, home, candidate.id, checked.contentHash, "/loop", true, { signal: controller.signal })).rejects.toThrow(); }
  finally { clearTimeout(timer); }
  expect(await store.active()).toEqual([]);
  await writeFile(join(candidate.path, "extension.json"), JSON.stringify({ name: "loop", sdkVersion: 2, entry: "index.ts", requiredCapabilities: ["commands", "state"] }));
  const changed = (await store.inspect(candidate.id)).candidate;
  await expect(trialCandidate(workspace, home, candidate.id, changed.contentHash, "/loop")).rejects.toThrow("authorization");
});
