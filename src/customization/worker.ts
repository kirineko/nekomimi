// Only imported by the child bootstrap. Never import this module in the host.
import { Socket } from "node:net";
import { createJiti } from "jiti";
import { RpcPeer, PROCESS_LIMITS } from "./rpc.js";
import type { RpcIdentity } from "./contracts.js";
import type { ExtensionContext, Hook } from "./types.js";
import type { ExtensionAPI2 } from "./contracts.js";

const { identity, resourceIds }: { identity: RpcIdentity; resourceIds: string[] } = JSON.parse(process.argv[1]!);
const channel = new Socket({ fd: 3, readable: true, writable: true });
const peer = new RpcPeer(channel, channel, identity, resourceIds);
peer.onFailure = () => process.exit(1);
const handlers = new Map<string, { resourceId: string; handler: Function }>();
const controllers = new Map<string, AbortController>();
let initialized = false;
let nextHandler = 0;
peer.handle = async (method, value, callId) => {
  if (method === "initialize") {
    if (initialized) throw new Error("Already initialized");
    if (!Array.isArray(value.entries) || !value.entries.length || value.entries.some((e: any) => ![1, 2].includes(e.sdkVersion) || !resourceIds.includes(e.resourceId))) throw new Error("Unsupported sdkVersion or resource");
    initialized = true;
    const descriptions: unknown[] = [];
    const names = new Set<string>();
    for (const entry of value.entries) {
    let registering = true;
    const add = (kind: string, descriptor: any, handler: Function) => {
      if (!registering) throw new Error("Registrations require a new activation");
      if (typeof handler !== "function" || descriptions.length >= PROCESS_LIMITS.registrationCount) throw new Error("Invalid or excessive registrations");
      if (kind === "tool" || kind === "command") {
        const name = descriptor.name;
        if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name) || names.has(entry.resourceId + ":" + name) || ["read", "write", "edit", "bash", "powershell", "reload", "skill", "web_search"].includes(name)) throw new Error(`Invalid, duplicate or reserved name: ${name}`);
        names.add(entry.resourceId + ":" + name);
      }
      const handlerId = String(++nextHandler);
      handlers.set(handlerId, { resourceId: entry.resourceId, handler });
      descriptions.push({ kind, ...descriptor, handlerId, resourceId: entry.resourceId });
    };
    const api: ExtensionAPI2 = {
      registerProvider(provider) {
        if (entry.sdkVersion !== 2 || typeof provider.serialize !== "function" || typeof provider.parse !== "function") throw new Error("Provider requires SDK 2 serialize and parse callbacks");
        add("provider", { id: provider.id, models: provider.models }, (argument: any) => {
          if (argument.method === "serialize") return provider.serialize(argument.input);
          if (argument.method === "parse") return provider.parse(argument.input);
          throw new Error("Unsupported Provider method");
        });
      },
      registerWorkflow(workflow) {
        if (entry.sdkVersion !== 2 || !workflow.steps || Object.values(workflow.steps).some(step => typeof step.execute !== "function")) throw new Error("Invalid workflow handlers");
        const { steps, ...descriptor } = workflow;
        add("workflow", { ...descriptor, steps: Object.fromEntries(Object.entries(steps).map(([name, step]) => [name, { transitions: step.transitions }])) }, (argument: any, context: any) => {
          const step = Object.hasOwn(steps, argument.step) && steps[argument.step];
          if (!step) throw new Error("Unknown workflow step");
          return step.execute(argument.input, context);
        });
      },
      registerPanel(panel) { if (entry.sdkVersion !== 2) throw new Error("Panel requires SDK 2"); add("panel", panel, () => null); },
      registerTool(tool) {
        const { execute, ...descriptor } = tool;
        if (tool.parameters?.type !== "object" || !tool.description) throw new Error("Invalid tool definition");
        add("tool", descriptor, execute);
      },
      registerCommand(name, command) { add("command", { name, description: command.description }, command.handler); },
      on(event, handler) {
        if (!["beforeRun", "beforeTool", "afterTool", "afterRun"].includes(event)) throw new Error("Unsupported hook");
        add("hook", { event }, handler);
      },
      onDispose(handler) { add("dispose", {}, handler); },
    };
    const loader = createJiti(import.meta.url, { moduleCache: false, fsCache: false, alias: { "nekomimi/extensions": value.sdk } });
    try {
      const factory = await loader.import<any>(entry.entry, { default: true });
      if (typeof factory !== "function") throw new Error("default export must be a factory");
      await factory(api);
    } finally { registering = false; }
    }
    return descriptions;
  }
  if (method === "cancel") {
    controllers.get(value.callId)?.abort();
    return null;
  }
  if (method !== "invoke" || !initialized) throw new Error("Unknown worker operation");
  const handler = handlers.get(value.handlerId);
  if (!handler || handler.resourceId !== value.resourceId) throw new Error("Unknown handler or resource identity");
  const controller = new AbortController();
  controllers.set(callId, controller);
  const scheduled: Promise<unknown>[] = [];
  const service = (name: string, args: unknown[]) => peer.request<any>("service", { name, args }, callId, undefined, undefined, { runId: value.runId, resourceId: value.resourceId, workflowId: value.workflowId, stepId: value.stepId });
  const queue = (name: string, args: unknown[]) => {
    const promise = service(name, args);
    // Keep rejection handled immediately, then propagate at callback completion.
    void promise.catch(() => {});
    scheduled.push(promise);
  };
  const ctx: ExtensionContext = {
    ...(value.workflowId ? { workflowId: value.workflowId, stepId: value.stepId, attemptId: value.attemptId, workspaceState: { get: (key: string, version: number) => service("workspaceState.get", [key, version]), set: (key: string, version: number, expected: number, data: unknown) => service("workspaceState.set", [key, version, expected, data]) } } : {}),
    workspace: value.workspace, resourceId: value.resourceId, signal: controller.signal,
    callTool: (name, args) => service("callTool", [name, args]),
    model: prompt => service("model", [prompt]),
    state: { get: (key, version) => service("state.get", [key, version]), set: (key, version, data) => service("state.set", [key, version, data]) },
    ui: contribution => service("ui", [contribution]),
    contribute: text => service("contribute", [text]),
    followUp: prompt => queue("followUp", [prompt]),
    reload: () => { queue("reload", []); return { id: value.reloadReceiptId, status: "pending" }; },
  };
  try {
    const result = await handler.handler(value.argument, ctx);
    await Promise.all(scheduled);
    return result ?? null;
  } finally { controllers.delete(callId); }
};
