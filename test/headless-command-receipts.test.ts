import { expect, it } from "vitest";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { run } from "../src/runtime.js";
import { CustomizationHost } from "../src/customization/host.js";
import { Journal, hash, id, readSession } from "../src/journal.js";
import { key, temporary, response, textItem } from "./helpers.js";

it("returns a completed headless receipt before acquiring factories or a writer, and rejects changed content", async () => {
  const workspace = await temporary(), home = await temporary(), session = join(await temporary(), "session"), marker = join(workspace, "FACTORY");
  const extension = join(workspace, ".nekomimi/extensions/receipt"); await mkdir(extension, { recursive: true });
  await writeFile(join(extension, "extension.json"), JSON.stringify({ name: "receipt", sdkVersion: 3, entry: "index.ts", requiredCapabilities: ["commands"] }));
  await writeFile(join(extension, "index.ts"), `import {appendFileSync} from 'node:fs'; import type {ExtensionFactory} from 'nekomimi/extensions'; export default ((api)=>{appendFileSync(${JSON.stringify(marker)},'factory');api.registerCommand('receipt',{description:'receipt',async handler(){return 'ok'}});}) satisfies ExtensionFactory;`);
  const host = new CustomizationHost(workspace, home); let requests = 0, accepted: string[] = [];
  try {
    const resource = (await host.catalog.discover()).find(resource => resource.name === "receipt")!;
    await host.catalog.decide(resource.id, true, true, (await host.catalog.decisions()).revision);
    const command = (prompt: string) => ({ id: "once", runId: id(), payloadHash: hash(JSON.stringify({ prompt })), onAccepted: (runId: string) => { accepted.push(runId); } });
    const options = { workspace, home, session, apiKey: key, prompt: "hello", customization: host, fetch: async () => { requests++; return response([textItem("original result")]); } };
    const first = await run({ ...options, command: command("hello") }); expect(first.status).toBe("completed"); expect(await readFile(marker, "utf8")).toBe("factory");
    await host.close();
    const writer = await Journal.open(session); // A receipt remains observable while another writer owns the journal.
    try {
      const before = await readFile(join(session, "journal.jsonl"));
      const replay = await run({ ...options, customization: undefined, command: command("hello") });
      expect(replay).toMatchObject({ replayed: true, runId: first.runId, status: first.status, text: first.text, durableSeq: first.durableSeq });
      expect(accepted).toEqual([first.runId, first.runId]); expect(requests).toBe(1); expect(await readFile(marker, "utf8")).toBe("factory");
      expect(await readFile(join(session, "journal.jsonl"))).toEqual(before);
      await expect(run({ ...options, customization: undefined, prompt: "different", command: command("different") })).rejects.toMatchObject({ code: "command_conflict" });
      expect(await readFile(join(session, "journal.jsonl"))).toEqual(before); expect(requests).toBe(1);
    } finally { await writer.close(); }
  } finally { await host.close(); }
});
it("observes an interrupted accepted command without repairing, scheduling or rerunning unknown tools", async () => {
  const workspace = await temporary(), home = await temporary(), session = join(await temporary(), "session"); let requests = 0;
  await run({ workspace, home, session, apiKey: key, prompt: "seed", fetch: async () => { requests++; return response([textItem()]); } });
  const journal = await Journal.open(session), runId = id(), payloadHash = hash(JSON.stringify({ prompt: "unknown" }));
  await journal.append("command.accepted", { commandId: "interrupted", payloadHash }, { runId });
  await journal.append("tool.intent", { name: "write", args: { path: "unknown", content: "external outcome unknown" } }, { runId, toolCallId: "old-tool" }); await journal.close();
  const before = await readFile(join(session, "journal.jsonl"));
  const result = await run({ workspace, home, session, apiKey: key, prompt: "unknown", fetch: async () => { requests++; throw new Error("must not dispatch"); }, command: { id: "interrupted", runId: id(), payloadHash, onAccepted: accepted => expect(accepted).toBe(runId) } });
  expect(result).toMatchObject({ replayed: true, runId, status: "interrupted", text: "" }); expect(requests).toBe(1);
  expect(await readFile(join(session, "journal.jsonl"))).toEqual(before); await expect(readFile(join(workspace, "unknown"))).rejects.toThrow();
  expect((await readSession(session)).events.some(event => event.runId === runId && ["tool.completed", "tool.failed", "run.finished"].includes(event.type))).toBe(false);
});

it('replays an SDK command receipt without repeating its effect or acquiring a factory', async () => {
  const workspace = await temporary(), home = await temporary(), session = join(workspace, 'session');
  const root = join(workspace, '.nekomimi/extensions/once'); await mkdir(root, { recursive: true });
  await writeFile(join(root, 'extension.json'), JSON.stringify({ name: 'once', sdkVersion: 3, entry: 'index.ts', requiredCapabilities: ['commands','tools'] }));
  await writeFile(join(root, 'index.ts'), `import {appendFileSync} from 'node:fs';export default (api:import('nekomimi/extensions').ExtensionAPI)=>{appendFileSync('factory-count','loaded\\n');api.registerCommand('once',{description:'once',async handler(a,c){await c.callTool('write',{path:'command-effect.txt',content:'once'});return 'command completed'}})}`);
  const host = new CustomizationHost(workspace, home);
  const resource = (await host.catalog.discover()).find(r => r.kind === 'extension')!; await host.catalog.decide(resource.id, true, true, 0);
  try {
    const options = { workspace, home, session, customization: host, apiKey: key, prompt: '/once', command: { id: 'same-sdk-command', runId: id(), payloadHash: hash('/once'), onAccepted() {} } };
    const first = await run(options); expect(first.status, first.error).toBe('completed');
    expect(first.text).toBe('command completed'); await host.close();
    const before = await readFile(join(session, 'journal.jsonl'));
    const second = await run({ ...options, customization: undefined, command: { ...options.command, runId: id() } });
    expect(second).toMatchObject({ replayed: true, runId: first.runId, text: first.text });
    expect(await readFile(join(workspace, 'factory-count'), 'utf8')).toBe('loaded\n');
    expect(await readFile(join(session, 'journal.jsonl'))).toEqual(before);
    expect((await readSession(session)).events.filter(e => e.type === 'tool.intent')).toHaveLength(1);
    expect(await readFile(join(workspace, 'command-effect.txt'), 'utf8')).toBe('once');
  } finally { await host.close(); }
});
