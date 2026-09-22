import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { exists, safePath, type Resource, type Resources } from "./resources.js";
import { RpcPeer, PROCESS_LIMITS } from "./rpc.js";
import type { ExtensionContext, ExtensionTool, Hook } from "./types.js";
import type { LoadedExtension } from "./host.js";
import type { Links } from "../journal.js";
import { buildPanel } from "./panel-build.js";
import type { PanelDefinition } from "./contracts.js";
import { validateProvider } from "./provider-registry.js";
import type { ModelDefinition } from "./contracts.js";
import type { WorkflowContext } from "./contracts.js";
import { validateWorkflow, type WorkflowDescriptor } from "./workflow-contract.js";

export interface ProcessContext extends ExtensionContext {
  readonly runId: string;
  readonly reloadReceiptId: string;
  readonly workflowId?: string;
  readonly stepId?: string;
  readonly attemptId?: string;
  readonly workspaceState?: WorkflowContext["workspaceState"];
  recordRpc(type: string, payload: unknown, links: Links): Promise<void>;
}
interface Registration {
  resourceId: string;
  kind: "tool" | "command" | "hook" | "dispose" | "provider" | "workflow" | "panel";
  id?: string;
  models?: ModelDefinition[];
  handlerId: string;
  name?: string;
  description?: string;
  parameters?: ExtensionTool["parameters"];
  promptSnippet?: string;
  promptGuidelines?: string[];
  event?: Hook;
}
export class ExtensionProcess {
  readonly instanceId = randomUUID();
  private child!: ChildProcess;
  private peer!: RpcPeer;
  private contexts = new Map<string, ProcessContext>();
  private exited = false;
  private exitPromise!: Promise<void>;
  private stopping?: Promise<void>;
  private failure?: Error;
  private logBytes = 0;
  constructor(private resource: Resource, private catalog: Resources, private additional: Resource[] = []) {}
  private owner(resourceId: string) {
    const resource = [this.resource, ...this.additional].find(r => r.id === resourceId);
    if (!resource) throw new Error("Unknown process resource");
    return resource;
  }
  async start(): Promise<LoadedExtension[]> {
    const js = fileURLToPath(new URL("./worker.js", import.meta.url));
    const worker = await exists(js) ? js : js.replace(/\.js$/, ".ts");
    const sdkJs = fileURLToPath(new URL("../extensions.js", import.meta.url));
    const sdk = await exists(sdkJs) ? sdkJs : sdkJs.replace(/\.js$/, ".ts");
    const resources = [this.resource, ...this.additional];
    const resourceIds = resources.map(r => r.id);
    const identity = { protocolVersion: 1 as const, instanceId: this.instanceId, packageId: this.resource.packageId, resourceId: this.resource.id, revision: this.resource.packageRevision ?? this.resource.hash };
    const jiti = createRequire(import.meta.url).resolve("jiti");
    const bootstrap = `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(import.meta.url)});const {createJiti}=require(${JSON.stringify(jiti)});await createJiti(import.meta.url,{fsCache:false}).import(${JSON.stringify(worker)});`;
    // A trusted Node process, not an OS sandbox. Do not inherit host credentials.
    const env = Object.fromEntries(["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
    this.child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap, JSON.stringify({ identity, resourceIds })], {
      cwd: this.catalog.workspace, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    this.exitPromise = new Promise(resolve => {
      this.child.once("exit", () => { this.exited = true; resolve(); this.peer?.fail(new Error("Extension process exited; result unknown")); });
      this.child.once("error", error => { this.exited = true; resolve(); this.peer?.fail(error); });
    });
    const pipe = this.child.stdio[3] as Readable & Writable;
    this.peer = new RpcPeer(pipe, pipe, identity, resourceIds);
    this.peer.onFailure = error => { this.failure ??= error; void this.stop().catch(() => {}); };
    for (const output of [this.child.stdout, this.child.stderr]) output!.on("data", (chunk: Buffer) => {
      this.logBytes += chunk.length;
      // Never reflect arbitrary process output (which can contain credentials) into the UI.
      if (this.logBytes > PROCESS_LIMITS.logBytes) this.peer.fail(new Error("Extension stdout/stderr log limit exceeded"));
    });
    this.peer.handle = async (method, value, rpcCallId, parentCallId, runId, resourceId, workflowId, stepId) => {
      const ctx = parentCallId && this.contexts.get(parentCallId);
      if (method !== "service" || !ctx || ctx.signal.aborted || this.stopping) throw new Error("Expired or unknown extension call");
      if (ctx.runId !== runId || ctx.resourceId !== resourceId) throw new Error("Extension run/resource identity mismatch");
      if (ctx.workflowId !== workflowId || ctx.stepId !== stepId) throw new Error("Extension workflow/step identity mismatch");
      const resource = this.owner(ctx.resourceId);
      const decision = await this.catalog.grant(resource);
      if (!decision?.enabled || !decision.trusted) throw new Error("Extension grant revoked");
      const methods: Record<string, (...args: any[]) => unknown> = {
        callTool: ctx.callTool, model: ctx.model, "state.get": ctx.state.get, "state.set": ctx.state.set,
        ui: ctx.ui, contribute: ctx.contribute, followUp: ctx.followUp, reload: ctx.reload,
        ...(ctx.workspaceState ? { "workspaceState.get": ctx.workspaceState.get, "workspaceState.set": ctx.workspaceState.set } : {}),
      };
      if (!value || !Object.hasOwn(methods, value.name) || !Array.isArray(value.args)) throw new Error("Unsupported host service");
      if (resource.manifest?.sdkVersion === 2) {
        const capabilities: Record<string, string> = { callTool: "tools", model: "model", "state.get": "state", "state.set": "state", ui: "ui", contribute: "hooks", followUp: "follow-up", reload: "commands", "workspaceState.get": "workspace-state", "workspaceState.set": "workspace-state" };
        if (!resource.manifest.requiredCapabilities?.includes(capabilities[value.name]!) || !decision.capabilities?.includes(capabilities[value.name]!)) throw new Error("Host capability not declared or granted");
      }
      const links = { runId: ctx.runId, workflowId, stepId, attemptId: ctx.attemptId, packageId: resource.packageId, resourceId: resource.id, resourceRevision: resource.hash, instanceId: this.instanceId, rpcCallId };
      await ctx.recordRpc("extension.rpc.intent", { method: value.name, parentCallId, args: value.args }, links);
      if (ctx.signal.aborted || this.stopping || !this.contexts.has(parentCallId!)) throw new Error("Extension call cancelled");
      const currentGrant = await this.catalog.grant(resource);
      if (!currentGrant?.enabled || !currentGrant.trusted) throw new Error("Extension grant revoked");
      if (resource.manifest?.sdkVersion === 2 && decision.capabilities?.some(c => !currentGrant.capabilities?.includes(c))) throw new Error("Extension capabilities revoked");
      try {
        const result = await methods[value.name]!(...value.args);
        await ctx.recordRpc("extension.rpc.completed", { method: value.name, parentCallId }, links);
        return result;
      } catch (error) {
        await ctx.recordRpc("extension.rpc.failed", { method: value.name, parentCallId, error: String(error), unknown: true }, links);
        throw error;
      }
    };
    try {
      const registrations = await this.peer.request<Registration[]>("initialize", { entries: await Promise.all(resources.map(async resource => ({ resourceId: resource.id, entry: await safePath(resource.root, resource.manifest!.entry), sdkVersion: resource.manifest!.sdkVersion }))), sdk }, undefined, PROCESS_LIMITS.startupMs);
      if (!Array.isArray(registrations) || registrations.length > PROCESS_LIMITS.registrationCount) throw new Error("Invalid registrations");
      const loadedResources = new Map(resources.map(resource => [resource.id, { resource, unavailable: () => this.exited || !!this.stopping, providers: [], workflows: [], panels: [], tools: [], commands: new Map(), hooks: new Map(), dispose: [] } as LoadedExtension]));
      const names = new Set<string>(), handlers = new Set<string>();
      const disposers: Array<{ handlerId: string; resourceId: string }> = [];
      for (const r of registrations) {
        if (!r || typeof r.handlerId !== "string" || handlers.has(r.handlerId)) throw new Error("Invalid handler registration");
        handlers.add(r.handlerId);
        const loaded = loadedResources.get(r.resourceId);
        if (!loaded) throw new Error("Registration resource identity mismatch");
        const resource = loaded.resource;
        if (resource.manifest?.sdkVersion === 2 && r.kind !== "dispose") {
          const required = { tool: "tools", command: "commands", hook: "hooks", provider: "providers", workflow: "workflows", panel: "panels" }[r.kind];
          if (!resource.manifest.requiredCapabilities?.includes(required)) throw new Error("Registration capability not declared");
        }
        if (r.kind === "tool" || r.kind === "command") {
          if (typeof r.name !== "string" || !/^[a-z][a-z0-9_-]{0,39}$/.test(r.name) || names.has(r.resourceId + ":" + r.name) || ["read", "write", "edit", "bash", "powershell", "reload", "skill", "web_search"].includes(r.name)) throw new Error("Invalid or duplicate registration name");
          names.add(r.resourceId + ":" + r.name);
          if (typeof r.description !== "string") throw new Error("Invalid registration description");
        }
        if (r.kind === "panel") { loaded.panels.push(await buildPanel(resource, r as unknown as PanelDefinition)); }
        else if (r.kind === "tool") {
          if (r.parameters?.type !== "object") throw new Error("Invalid tool schema");
          loaded.tools.push({ name: r.name!, description: r.description!, parameters: r.parameters, promptSnippet: r.promptSnippet, promptGuidelines: r.promptGuidelines, execute: (args, ctx) => this.invoke(r.handlerId, args, ctx) });
        } else if (r.kind === "workflow") {
          const definition = r as unknown as WorkflowDescriptor; validateWorkflow(definition);
          loaded.workflows.push({ ...definition, resource, execute: (step, input, ctx) => this.invoke(r.handlerId, { step, input }, ctx) });
        } else if (r.kind === "provider") {
          const definition = { id: r.id!, models: r.models! }; validateProvider(definition);
          loaded.providers.push({ ...definition, resource, abort: () => this.stop(), serialize: (input, ctx) => this.invoke(r.handlerId, { method: "serialize", input }, ctx), parse: (input, ctx) => this.invoke(r.handlerId, { method: "parse", input }, ctx) });
        } else if (r.kind === "command") loaded.commands.set(r.name!, { description: r.description!, handler: (args, ctx) => this.invoke(r.handlerId, args, ctx) });
        else if (r.kind === "hook") {
          if (!["beforeRun", "beforeTool", "afterTool", "afterRun"].includes(r.event!)) throw new Error("Unsupported hook registration");
          loaded.hooks.set(r.event!, [...(loaded.hooks.get(r.event!) ?? []), (args, ctx) => this.invoke(r.handlerId, args, ctx)]);
        } else if (r.kind === "dispose") disposers.push({ handlerId: r.handlerId, resourceId: r.resourceId });
        else throw new Error("Unsupported registration kind");
      }
      loadedResources.get(this.resource.id)!.dispose.push(async () => {
        let failure: unknown;
        if (!this.exited && !this.stopping) for (const disposer of disposers.reverse()) {
          try { await this.peer.request("invoke", disposer, undefined, 1000, undefined, { resourceId: disposer.resourceId }); }
          catch (error) { failure = error; break; }
        }
        await this.stop();
        if (failure) throw failure;
      });
      return [...loadedResources.values()];
    } catch (error) { await this.stop(); throw error; }
  }
  private async invoke<T>(handlerId: string, argument: unknown, context: ExtensionContext): Promise<T> {
    const ctx = context as ProcessContext;
    const resource = this.owner(ctx.resourceId);
    if (this.stopping || this.exited || ctx.signal.aborted) throw this.failure ?? new Error("Extension process unavailable");
    const grant = await this.catalog.grant(resource);
    if (!grant?.enabled || !grant.trusted) throw new Error("Extension grant revoked");
    const callId = randomUUID();
    this.contexts.set(callId, ctx);
    const abort = () => {
      this.contexts.delete(callId);
      void this.peer.request("cancel", { callId }, undefined, PROCESS_LIMITS.cancelGraceMs).catch(() => {});
      void this.stop().catch(() => {});
    };
    ctx.signal.addEventListener("abort", abort, { once: true });
    const links = { runId: ctx.runId, workflowId: ctx.workflowId, stepId: ctx.stepId, attemptId: ctx.attemptId, packageId: resource.packageId, resourceId: resource.id, resourceRevision: resource.hash, instanceId: this.instanceId, rpcCallId: callId };
    try {
      await ctx.recordRpc("extension.callback.intent", { handlerId }, links);
      ctx.signal.throwIfAborted();
      const result = await this.peer.request<T>("invoke", { handlerId, argument, resourceId: resource.id, workspace: ctx.workspace, reloadReceiptId: ctx.reloadReceiptId, runId: ctx.runId, workflowId: ctx.workflowId, stepId: ctx.stepId, attemptId: ctx.attemptId }, undefined, PROCESS_LIMITS.callMs, callId, { runId: ctx.runId, resourceId: resource.id, workflowId: ctx.workflowId, stepId: ctx.stepId });
      await ctx.recordRpc("extension.callback.completed", { handlerId }, links);
      return result;
    } catch (error) {
      if (this.stopping) await this.stopping;
      await ctx.recordRpc("extension.callback.failed", { handlerId, error: String(error), unknown: true, evidenceGap: /limit|disconnect|exited|timed out/i.test(String(error)), processExited: this.exited }, links);
      throw error;
    }
    finally { ctx.signal.removeEventListener("abort", abort); this.contexts.delete(callId); }
  }
  stop(): Promise<void> {
    return this.stopping ??= this.terminate();
  }
  private async terminate() {
    this.contexts.clear();
    if (!this.child) return;
    const wait = async (ms: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.exitPromise, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]);
      clearTimeout(timer);
    };
    await wait(PROCESS_LIMITS.cancelGraceMs);
    if (process.platform === "win32" && !this.exited && this.child.pid) {
      await new Promise<void>((resolve, reject) => {
        execFile("taskkill.exe", ["/PID", String(this.child.pid), "/T", "/F"], { timeout: PROCESS_LIMITS.exitMs, maxBuffer: 16 * 1024, windowsHide: true }, error => {
          if (error && !this.exited) reject(new Error("Extension Windows process-tree cleanup failed"));
          else resolve();
        });
      });
    }
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, signal);
        else this.child.kill(signal);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    };
    kill("SIGTERM");
    await wait(PROCESS_LIMITS.terminateMs);
    // Kill the group even if the leader exited, to remove surviving descendants.
    kill("SIGKILL");
    await wait(PROCESS_LIMITS.exitMs);
    if (process.platform !== "win32" && this.child.pid) {
      const deadline = Date.now() + PROCESS_LIMITS.exitMs;
      for (;;) {
        let alive = true;
        try { process.kill(-this.child.pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw error; }
        if (!alive) break;
        if (Date.now() >= deadline) throw new Error("Extension cleanup failed; process group exit unconfirmed");
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    this.peer?.fail(new Error("Extension process stopped"));
    if (!this.exited) throw new Error("Extension cleanup failed; process exit unconfirmed");
  }
}
