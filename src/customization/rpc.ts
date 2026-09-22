import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { RpcIdentity } from "./contracts.js";

export const PROCESS_LIMITS = Object.freeze({
  processes: 16,
  frameBytes: 5 * 1024 * 1024, pendingCalls: 32, queuedBytes: 10 * 1024 * 1024,
  logBytes: 64 * 1024, registrationCount: 256, startupMs: 10_000,
  callMs: 300_000, cancelGraceMs: 250, terminateMs: 1000, exitMs: 2000,
});
interface Frame extends RpcIdentity {
  runId?: string;
  workflowId?: string;
  stepId?: string;
  sequence: number;
  callId: string;
  kind: "request" | "response";
  method?: string;
  parentCallId?: string;
  value?: unknown;
  error?: string;
}
/** Dedicated length-bounded channel. Each response acknowledges its request;
 * credits are not replenished until the receiving handler actually completes. */
export class RpcPeer {
  private sequence = 0;
  private received = 0;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; runId?: string; resourceId: string; workflowId?: string; stepId?: string }>();
  private incoming = 0;
  private buffer = Buffer.alloc(0);
  private outboundBytes = 0;
  private tail = Promise.resolve();
  private closed?: Error;
  onFailure?: (error: Error) => void;
  handle?: (method: string, value: any, callId: string, parentCallId?: string, runId?: string, resourceId?: string, workflowId?: string, stepId?: string) => Promise<unknown>;
  constructor(private input: Readable, private output: Writable, readonly identity: RpcIdentity, private resources: readonly string[] = [identity.resourceId]) {
    input.on("data", (chunk: Buffer) => this.accept(chunk));
    input.on("error", e => this.fail(e));
    output.on("error", e => this.fail(e));
    input.on("end", () => this.fail(new Error("Extension RPC disconnected; result unknown")));
  }
  private accept(chunk: Buffer) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (!this.closed) {
      const end = this.buffer.indexOf(10);
      if (end < 0) break;
      if (end > PROCESS_LIMITS.frameBytes) return this.fail(new Error("RPC frame evidence limit exceeded"));
      const line = this.buffer.subarray(0, end);
      this.buffer = this.buffer.subarray(end + 1);
      try {
        const frame = JSON.parse(line.toString("utf8")) as Frame;
        if (!frame || typeof frame !== "object" || !Number.isSafeInteger(frame.sequence) || frame.sequence !== this.received + 1 ||
          typeof frame.callId !== "string" || frame.callId.length > 128 ||
          frame.protocolVersion !== this.identity.protocolVersion || frame.instanceId !== this.identity.instanceId ||
          !this.resources.includes(frame.resourceId) || frame.revision !== this.identity.revision || frame.packageId !== this.identity.packageId)
          throw new Error("Invalid or stale RPC identity/sequence");
        this.received = frame.sequence;
        if (frame.kind === "response") {
          const p = this.pending.get(frame.callId);
          if (!p) throw new Error("Unsolicited RPC response");
          if (p.runId !== frame.runId) throw new Error("RPC response run identity mismatch");
          if (p.resourceId !== frame.resourceId) throw new Error("RPC response resource identity mismatch");
          if (p.workflowId !== frame.workflowId || p.stepId !== frame.stepId) throw new Error("RPC response workflow/step identity mismatch");
          this.pending.delete(frame.callId); clearTimeout(p.timer);
          if (frame.error !== undefined) p.reject(new Error(String(frame.error).slice(0, 2000)));
          else p.resolve(frame.value);
        } else if (frame.kind === "request" && typeof frame.method === "string") {
          if (++this.incoming > PROCESS_LIMITS.pendingCalls) throw new Error("RPC inbound credit limit exceeded");
          void this.dispatch(frame);
        } else throw new Error("Invalid RPC frame");
      } catch (e) { this.fail(e instanceof Error ? e : new Error(String(e))); }
    }
    if (this.buffer.length > PROCESS_LIMITS.frameBytes) this.fail(new Error("RPC frame evidence limit exceeded"));
  }
  private async dispatch(frame: Frame) {
    try {
      if (!this.handle) throw new Error("RPC handler unavailable");
      const value = await this.handle(frame.method!, frame.value, frame.callId, frame.parentCallId, frame.runId, frame.resourceId, frame.workflowId, frame.stepId);
      await this.send({ callId: frame.callId, resourceId: frame.resourceId, runId: frame.runId, workflowId: frame.workflowId, stepId: frame.stepId, kind: "response", value });
    } catch (e) {
      await this.send({ callId: frame.callId, resourceId: frame.resourceId, runId: frame.runId, workflowId: frame.workflowId, stepId: frame.stepId, kind: "response", error: String(e).slice(0, 2000) }).catch(() => {});
    } finally { this.incoming--; }
  }
  private send(frame: Omit<Frame, keyof RpcIdentity | "sequence"> & { resourceId?: string }): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    let bytes: Buffer;
    try { bytes = Buffer.from(JSON.stringify({ ...this.identity, ...frame, sequence: this.sequence + 1 }) + "\n"); }
    catch (e) { this.fail(new Error("Non-serializable RPC payload")); return Promise.reject(this.closed); }
    if (bytes.length > PROCESS_LIMITS.frameBytes) return Promise.reject(new Error("RPC result evidence limit exceeded; result not retained"));
    if (this.outboundBytes + bytes.length > PROCESS_LIMITS.queuedBytes) {
      this.fail(new Error("RPC output evidence/queue limit exceeded")); return Promise.reject(this.closed);
    }
    this.sequence++;
    this.outboundBytes += bytes.length;
    const sent = this.tail.then(() => new Promise<void>((resolve, reject) => {
      if (this.closed) { reject(this.closed); return; }
      this.output.write(bytes, error => error ? reject(error) : resolve());
    })).finally(() => { this.outboundBytes -= bytes.length; });
    this.tail = sent.catch(e => { this.fail(e); });
    return sent;
  }
  request<T = unknown>(method: string, value: unknown, parentCallId?: string, timeout: number = PROCESS_LIMITS.callMs, callId: string = randomUUID(), correlation: { resourceId?: string; runId?: string; workflowId?: string; stepId?: string } = {}): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    if (this.pending.size >= PROCESS_LIMITS.pendingCalls) return Promise.reject(new Error("RPC outgoing credit limit exceeded"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Extension RPC timed out: ${method}; result unknown`)), timeout);
      this.pending.set(callId, { resolve, reject, timer, runId: correlation.runId, resourceId: correlation.resourceId ?? this.identity.resourceId, workflowId: correlation.workflowId, stepId: correlation.stepId });
      void this.send({ callId, ...correlation, kind: "request", method, value, parentCallId }).catch(e => this.fail(e));
    });
  }
  fail(error: Error) {
    if (this.closed) return;
    this.closed = error;
    this.buffer = Buffer.alloc(0);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.input.destroy(); this.output.destroy();
    this.onFailure?.(error);
  }
}
