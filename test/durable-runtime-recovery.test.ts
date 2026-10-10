import { it, expect } from "vitest";
import { fork } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "../src/runtime.js";
import { readSession } from "../src/journal.js";
import { temporary, response, callItem, textItem, key, delay, encode, events } from "./helpers.js";

it.each(["append", "sync", "watermark.write", "watermark.rename"])("rejects a product tool intent %s failure before the actual executor", async operation => {
  const workspace = await temporary(), home = await temporary(), session = join(workspace, "session");
  let injected = false;
  const result = await run({ workspace, home, session, prompt: "write", tools: ["write"], apiKey: key,
    journalOptions: { beforeIO: async point => {
      if (injected || point !== operation) return;
      const current = await readFile(join(session, "journal.jsonl"), "utf8").catch(() => "");
      const last = current.trim().split("\n").at(-1);
      const type = last ? JSON.parse(last).type : undefined;
      if (type === (point === "append" ? "tool.requested" : "tool.intent")) { injected = true; throw new Error(`intent fixture ${operation}`); }
    } }, fetch: async () => response([callItem("write", { path: "forbidden", content: "effect" })]),
  });
  expect(injected).toBe(true);
  expect(result.status).toBe("failed");
  await expect(readFile(join(workspace, "forbidden"))).rejects.toThrow();
  const snapshot = await readSession(session);
  expect(snapshot.events.some(event => event.type === "tool.completed")).toBe(false);
});

it("does not repeat an unknown native tool after a real runtime SIGKILL and explicit continuation", async () => {
  const workspace = await temporary(), home = await temporary(), session = join(workspace, "session");
  const effect = join(workspace, "effects.txt"), childFile = join(workspace, "crash.mjs");
  const body = encode(events([callItem("bash", { command: "printf effect >> effects.txt" }, "original-effect")]));
  await writeFile(childFile, `import {run} from ${JSON.stringify(pathToFileURL(resolve("dist/runtime.js")).href)};
import {existsSync} from 'node:fs';
await run({workspace:${JSON.stringify(workspace)},home:${JSON.stringify(home)},session:${JSON.stringify(session)},prompt:'effect',apiKey:'fixture',tools:['bash'],
 journalOptions:{lockStaleMs:2000,beforeIO:async point=>{if(point==='append'&&existsSync(${JSON.stringify(effect)})){process.send({ready:true});await new Promise(()=>{});}}},
 fetch:async()=>new Response(${JSON.stringify(body)},{headers:{'content-type':'text/event-stream'}})});
`);
  const child = fork(childFile, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stderr = ""; child.stderr?.on("data", chunk => { stderr += chunk; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`effect barrier timeout: ${stderr}`)), 10000);
      child.once("message", message => { clearTimeout(timer); expect(message).toEqual({ ready: true }); resolve(); });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`early exit: ${stderr}`)); });
    });
    expect(await readFile(effect, "utf8")).toBe("effect");
    child.kill("SIGKILL"); expect((await exited).signal).toBe("SIGKILL");
    const before = await readSession(session);
    expect(before.events.some(event => event.type === "tool.intent")).toBe(true);
    expect(before.events.some(event => event.type === "tool.completed")).toBe(false);
    await delay(3300);
    let requests = 0;
    const result = await run({ workspace, home, session, apiKey: key, prompt: "continue explicitly", tools: ["bash"], journalOptions: { lockStaleMs: 2000 }, fetch: async () => { requests++; return response([textItem("continued")]); } });
    expect(result.status).toBe("completed"); expect(requests).toBe(1);
    expect(await readFile(effect, "utf8")).toBe("effect");
    const recovered = await readSession(session);
    const unknown = recovered.events.find(event => event.type === "tool.unknown" && typeof (event.payload as {frameworkTaskId?:number}).frameworkTaskId === "number")!;
    expect(unknown).toBeDefined();
    const intent = before.events.find(event => event.type === "tool.intent")!;
    expect(unknown.frameworkTaskId).toBe(intent.frameworkTaskId);
    expect(unknown.modelCallId).toBe(intent.modelCallId);
    expect(unknown.attemptId).toBe(intent.attemptId);
    expect(unknown.runId).toBe(intent.runId);
    expect(recovered.events.filter(event => event.type === "tool.intent")).toHaveLength(1);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
}, 20000);
