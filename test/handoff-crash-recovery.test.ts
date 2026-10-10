import { it, expect } from "vitest";
import { fork } from "node:child_process";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSession } from "../src/journal.js";
import { temporary, delay } from "./helpers.js";

it.each(["intent", "target", "received", "committed", "create:intent", "create:identity", "create:created", "create:committed"])("recovers the accepted transfer after real SIGKILL at %s with zero task dispatch", async stage => {
  const workspace = await temporary(), home = await temporary(), development = await temporary(), script = join(await temporary(), "handoff-crash.mjs");
  const effects = join(workspace, "MODEL_EFFECT");
  await writeFile(script, `import {Sessions} from ${JSON.stringify(pathToFileURL(resolve("dist/server/sessions.js")).href)};
import {readSession} from ${JSON.stringify(pathToFileURL(resolve("dist/journal.js")).href)};
import {readHandoffPayload} from ${JSON.stringify(pathToFileURL(resolve("dist/session/handoff-transfer.js")).href)};
import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
const recovering=process.argv[2]==='recover';let armed=false,sourceId,targetId;
const barrier=async point=>{if(!recovering&&armed&&point===${JSON.stringify(stage)}){process.send({ready:true,point,sourceId,targetId});await new Promise(()=>{});}};
const service=await Sessions.open({workspace:${JSON.stringify(workspace)},home:${JSON.stringify(home)},naming:false,apiKey:'fixture',lockStaleMs:2000,handoffJournalOptions:{lockStaleMs:2000},
 handoffFault:barrier,creationFault:async point=>barrier('create:'+point),runtime:{fetch:async()=>{await appendFile(${JSON.stringify(effects)},'dispatch');throw Error('model forbidden');}}});
try {
 const source=await service.create('source',{commandId:'source-create',mode:'work'});sourceId=source.id;
 const draft={version:1,goal:'develop /review',summary:'fixed accepted data',target:{title:'target',creation:{commandId:'target-create',mode:'create',target:{kind:'extension',root:${JSON.stringify(development)}}}}};
 if(recovering){
  const before=await service.handoffStates(sourceId);
  const result=await service.recoverHandoff(sourceId,{version:1,commandId:'confirm'});
  const original=(await readSession(join(service.root,sourceId))).events.find(e=>e.type==='handoff.intent');
  const payload=await readHandoffPayload(join(service.root,sourceId),original);
  const repeated=await service.confirmHandoff(sourceId,{version:1,commandId:'confirm',confirmed:true,payloadHash:payload.payloadHash,draft});
  process.send({recovered:true,result,repeated,before,sourceDirectory:join(service.root,sourceId),targetDirectory:join(service.root,result.targetSessionId),sessions:await service.list(0,30)});
 }else{
  const preview=await service.handoffPreview(sourceId,draft);targetId=preview.target.sessionId;armed=true;
  await service.confirmHandoff(sourceId,{version:1,commandId:'confirm',confirmed:true,payloadHash:preview.payloadHash,draft});
 }
}finally{await service.close();}
`);
  const spawn = (mode: string) => {
    const child = fork(script, [mode], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = ""; child.stderr?.on("data", data => stderr += data);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    const message = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`child ${mode} barrier timeout: ${stderr}`)), 10000);
      child.once("message", value => { clearTimeout(timer); resolve(value); });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(Error(`early ${mode} exit ${code}: ${stderr}`)); });
    });
    return { child, exited, message };
  };
  const crashed = spawn("crash"); let recovered: ReturnType<typeof spawn> | undefined;
  try {
    const ready = await crashed.message; expect(ready).toMatchObject({ ready: true, point: stage });
    crashed.child.kill("SIGKILL"); expect((await crashed.exited).signal).toBe("SIGKILL");
    await delay(3300); // Verified killed process; leases expire without removing a live owner's lock.
    recovered = spawn("recover"); const result = await recovered.message;
    expect(result.recovered).toBe(true); expect(result.result).toEqual(result.repeated); expect(result.result.targetSessionId).toBe(ready.targetId);
    expect((await recovered.exited).code).toBe(0);
    const source = (await readSession(result.sourceDirectory)).events, target = (await readSession(result.targetDirectory)).events;
    expect(source.filter(event => event.type === "handoff.intent")).toHaveLength(1); expect(source.filter(event => event.type === "handoff.committed")).toHaveLength(1);
    expect(target.filter(event => event.type === "session.created")).toHaveLength(1); expect(target.filter(event => event.type === "handoff.received")).toHaveLength(1);
    expect(source.filter(event => ["handoff.intent", "handoff.committed"].includes(event.type)).map(event => event.handoffId)).toEqual([result.result.handoffId, result.result.handoffId]);
    expect(target.find(event => event.type === "handoff.received")!.handoffId).toBe(result.result.handoffId);
    expect(result.sessions.sessions).toHaveLength(2); expect(await readdir(join(result.sourceDirectory, ".."))).toHaveLength(2);
    for (const events of [source, target]) expect(events.some(event => ["run.started", "tool.intent", "request.dispatched", "session.naming.started"].includes(event.type))).toBe(false);
    await expect(readFile(effects)).rejects.toThrow();
  } finally {
    for (const process of [crashed, recovered].filter(Boolean) as ReturnType<typeof spawn>[]) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill("SIGKILL"); await process.exited; }
  }
}, 25000);
