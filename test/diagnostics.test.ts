import { expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { Journal, readSession, hash } from "../src/journal.js";
import { diagnostic, readDiagnostics, saveDiagnostic } from "../src/diagnostics.js";
import { startWeb } from "../src/server/app.js";
import { temporary, key, response, textItem } from "./helpers.js";

it.each(["watermark.open", "watermark.write", "watermark.sync", "watermark.rename", "watermark.directory-sync"])("identifies %s failure without leaking error content", async operation => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  let fail = false;
  const dir = await temporary();
  // Keep the periodic flush from racing the explicitly faulted append under parallel test load.
  const j = await Journal.open(dir, { flushMs: 60000, beforeIO: async stage => { if(fail && stage === operation) throw Object.assign(new Error(`secret ${key} body`), {code:"EPERM",syscall:"rename"}); } });
  try {
    await j.append("run.started", {}, {runId:"r"}); fail = true;
    await expect(j.append("context.add", {}, {runId:"r"})).rejects.toThrow("Operation failed");
    await j.close();
    const values = await readDiagnostics(dir);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({operation, code:"EPERM", syscall:"rename", runId:"r", seq:2, durableSeq:1});
    expect(JSON.stringify(values)).not.toContain(key);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(key);
    const snapshot = await readSession(dir);
    // Directory sync fails after replacement: durable marker can already be readable.
    expect(snapshot.events.some(event => event.type === "run.finished")).toBe(false);
    expect(j.failure.signal.aborted).toBe(true);
  } finally { stderr.mockRestore(); }
});

it("falls back to stderr when auxiliary storage fails", async () => {
  const stderr = vi.spyOn(process.stderr,"write").mockImplementation(() => true);
  try {
    const dir = await temporary(); await writeFile(join(dir,"diagnostics"), "not a directory");
    const value = diagnostic(new Error(key), {runId:"r"});
    await expect(saveDiagnostic(dir,value)).resolves.toBeUndefined();
    const output=JSON.stringify(stderr.mock.calls);
    expect(output).toContain("nekomimiDiagnosticWriteFailed"); expect(output).not.toContain(key);
  } finally { stderr.mockRestore(); }
});

it("retains accepted-task storage failures in Web and across service restarts", async () => {
  const stderr = vi.spyOn(process.stderr,"write").mockImplementation(() => true);
  const workspace=await temporary(); const home=join(workspace,"home");
  let armed=false;
  let app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve("dist/web-dist"),runtime:{fetch:async()=>{armed=true;return response([textItem()]);},journalOptions:{beforeIO:async stage=>{if(stage==="watermark.rename" && armed){armed=false;throw Object.assign(new Error(key),{code:"EPERM",syscall:"rename"});}}}}});
  try {
    const session=await app.sessions.create("diagnose");
    await app.sessions.submit(session.id,{version:1,commandId:"test",prompt:"hi"});
    await app.sessions.active?.done;
    let entry=await app.sessions.entry(session.id);
    expect(app.sessions.info(session.id,entry).diagnostic).toMatchObject({code:"EPERM",operation:"watermark.rename"});
    const request=()=>fetch(`${app.origin}/api/v1/sessions/${session.id}/diagnostics`,{headers:{authorization:`Bearer ${app.token}`}});
    const result=await request(); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({authoritative:false,diagnostics:[{code:"EPERM"}]});
    await app.close();
    app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve("dist/web-dist")});
    entry=await app.sessions.entry(session.id);
    expect(app.sessions.info(session.id,entry).diagnostic?.code).toBe("EPERM");
  } finally { await app.close(); stderr.mockRestore(); }
});

it("shares a single Entry during concurrent first access", async () => {
  const workspace = await temporary();
  const app = await startWeb({workspace, home:join(workspace,"home"), naming:false, staticDir:resolve("dist/web-dist")});
  try {
    const session = await app.sessions.create("concurrent");
    app.sessions.entries.delete(session.id);
    const entries = await Promise.all(Array.from({length:8}, () => app.sessions.entry(session.id)));
    expect(new Set(entries).size).toBe(1);
    const value=diagnostic(new Error("fixture"),{sessionId:session.id});
    entries[0]!.diagnostics.push(value);
    expect((await app.sessions.entry(session.id)).diagnostics).toContain(value);
  } finally { await app.close(); }
});

it("downloads diagnostics with a damaged watermark while enforcing auth and workspace identity", async () => {
  const stderr=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);
  const workspace = await temporary();
  const home=join(workspace,"home");
  let app=await startWeb({workspace,home,naming:false,staticDir:resolve("dist/web-dist")});
  try {
    const session=await app.sessions.create("damaged");
    const entry=await app.sessions.entry(session.id);
    await saveDiagnostic(entry.directory,diagnostic(new Error("fixture"),{sessionId:session.id}));
    await writeFile(join(entry.directory,"durable.json"),"{");
    await app.close();
    app=await startWeb({workspace,home,naming:false,staticDir:resolve("dist/web-dist")});
    const url=`${app.origin}/api/v1/sessions/${session.id}/diagnostics`;
    expect((await fetch(url)).status).toBe(401);
    const headers={authorization:`Bearer ${app.token}`};
    const response=await fetch(url,{headers});
    expect(response.status).toBe(200);
    expect((await response.json()).diagnostics).toHaveLength(1);
    expect((await fetch(url.replace("/diagnostics","/snapshot"),{headers})).status).toBe(500);
    const first=JSON.parse((await readFile(join(entry.directory,"journal.jsonl"),"utf8")).split("\n")[0]!);
    first.payload.workspace="another-workspace";
    const {hash:_,...body}=first;
    first.hash=hash(JSON.stringify(body));
    await writeFile(join(entry.directory,"journal.jsonl"),JSON.stringify(first)+"\n");
    expect((await fetch(url,{headers})).status).toBe(403);
  } finally {await app.close();stderr.mockRestore();}
});
