import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { RpcPeer, PROCESS_LIMITS } from "../src/customization/rpc.js";
import { Journal, readSession, readArtifact } from "../src/journal.js";
import { temporary } from "./helpers.js";
const identity = { protocolVersion: 1 as const, instanceId: "instance", resourceId: "resource", revision: "revision" };
function pair() {
  const a = new PassThrough(), b = new PassThrough();
  return { left: new RpcPeer(a, b, identity), right: new RpcPeer(b, a, identity), a, b };
}
it("bounds slow consumers without replenishing request credits early", async () => {
  const { left, right } = pair();
  let release!: () => void;
  const waiting = new Promise<void>(r => { release = r; });
  right.handle = async () => { await waiting; return "saved"; };
  try {
    const pending = Array.from({ length: PROCESS_LIMITS.pendingCalls }, () => left.request("store", null));
    await expect(left.request("overflow", null)).rejects.toThrow("credit limit");
    release();
    expect(await Promise.all(pending)).toEqual(Array(PROCESS_LIMITS.pendingCalls).fill("saved"));
    expect(await left.request("after-ack", null)).toBe("saved");
  } finally { left.fail(new Error("closed")); right.fail(new Error("closed")); }
});
it("rejects forged process identity before invoking a service", async () => {
  const { left, right, a } = pair();
  let calls = 0;
  left.handle = async () => { calls++; };
  const failed = new Promise<Error>(resolve => { left.onFailure = resolve; });
  a.write(JSON.stringify({ ...identity, instanceId: "forged", sequence: 1, callId: "one", kind: "request", method: "tool" }) + "\n");
  expect((await failed).message).toContain("identity"); expect(calls).toBe(0);
  right.fail(new Error("closed"));
});
it("rejects oversized frames with explicit evidence-limit failure", async () => {
  const { left, right } = pair();
  await expect(left.request("huge", "x".repeat(PROCESS_LIMITS.frameBytes))).rejects.toThrow("evidence");
  right.fail(new Error("closed"));
});
it("refuses a result attributed to another run", async () => {
  const input = new PassThrough(), output = new PassThrough();
  const peer = new RpcPeer(input, output, identity);
  const pending = peer.request("invoke", null, undefined, 1000, "known-call", { runId: "run-one" });
  input.write(JSON.stringify({ ...identity, runId: "run-two", sequence: 1, callId: "known-call", kind: "response", value: "forged" }) + "\n");
  await expect(pending).rejects.toThrow("run identity");
});
it("preserves old events and new correlation fields and never invents missing artifacts", async () => {
  const directory = await temporary();
  const journal = await Journal.open(directory);
  await journal.append("old.event", { text: "legacy" });
  await journal.append("extension.rpc.intent", { method: "state.set" }, { packageId: "p", instanceId: "i", rpcCallId: "r", workflowId: "w", stepId: "s", definitionRevision: "d" });
  await journal.close();
  const { events } = await readSession(directory);
  expect(events[0]!.payload).toEqual({ text: "legacy" });
  expect(events[1]).toMatchObject({ packageId: "p", instanceId: "i", rpcCallId: "r", workflowId: "w", stepId: "s", definitionRevision: "d" });
  await expect(readArtifact(directory, { kind: "artifact", sha256: "f".repeat(64), bytes: 1 })).rejects.toThrow();
});
it("keeps RPC credits occupied until a slow Journal write is durable", async () => {
  let release!: () => void;
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let slow = false;
  const journal = await Journal.open(await temporary(), { beforeIO: async operation => { if (slow && operation === "append") { entered(); await blocked; } } });
  const { left, right } = pair();
  right.handle = async (_method, value) => { await journal.append("fixture.saved", value); return "durable"; };
  try {
    slow = true;
    const calls = Array.from({ length: PROCESS_LIMITS.pendingCalls }, (_, index) => left.request("save", { index }));
    await writing;
    expect(journal.events).toHaveLength(0);
    await expect(left.request("save", {})).rejects.toThrow("credit limit");
    release();
    expect(await Promise.all(calls)).toEqual(Array(PROCESS_LIMITS.pendingCalls).fill("durable"));
    expect(journal.durableSeq).toBe(PROCESS_LIMITS.pendingCalls);
  } finally { release(); left.fail(new Error("closed")); right.fail(new Error("closed")); await journal.close(); }
});
