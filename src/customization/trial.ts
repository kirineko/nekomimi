import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Journal, id } from "../journal.js";
import { CustomizationHost } from "./host.js";
import { CustomRun } from "./run.js";
import { Candidates } from "./candidates.js";
import type { Json, ToolResult } from "./types.js";
import type { Resource } from "./resources.js";
import { hostIdentity } from "./sdk.js";
import { SDK_VERSION } from "./types.js";
import type { VerificationResult } from "../shared/customization-lifecycle.js";
export interface TrialOptions {
  assertTarget?: () => Promise<void>;
  validationTaskId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  resource?: Resource;
  mockResults?: Record<string, ToolResult>;
  model?: string;
  form?: Json;
}
/** Cooperative mock services, not an OS sandbox for arbitrary extension code. */
export async function trialExtension(
  workspace: string,
  home: string | undefined,
  resourceId: string,
  command: string,
  options: TrialOptions = {},
) {
  const host = new CustomizationHost(workspace, home);
  const directory = await mkdtemp(join(tmpdir(), "nekomimi-trial-"));
  const journal = await Journal.open(join(directory, "session"));
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let verifiedResource = options.resource;
  let closed = false;
  const environment = { node: process.version, platform: process.platform, arch: process.arch, sdkVersion: SDK_VERSION, hostBuild: (await hostIdentity()).build };
  try {
    verifiedResource ??= (await host.catalog.discover()).find(resource => resource.id === resourceId);
    if (!verifiedResource) throw new Error("Trial resource unavailable");
    await journal.append("trial.started", { simulated: true, resourceId, resourceRevision: verifiedResource.hash, command, environment }, {validationTaskId: options.validationTaskId});
    controller.signal.throwIfAborted();
    await host.trial(resourceId, options.resource, controller.signal);
    const runtime = new CustomRun(
      host,
      host.active!,
      journal,
      id(),
      controller.signal,
      { apiKey: "trial-not-a-key" },
      undefined,
      true,
      { model: options.model, form: options.form },
    );
    await runtime.initialize(
      ["read", "write", "edit", "bash", "powershell", "web_search"].map(
        (name) => ({
          snippet: "Trial mock",
          guidance: [],
          tool: {
            name,
            label: name,
            description: "Trial mock",
            parameters: Type.Object({}, { additionalProperties: true }),
            execute: async (_id, args) => {
              await journal.append("trial.tool", { name, args });
              const mock = options.mockResults?.[name];
              if (mock) return { ...mock, details: mock.details ?? {} };
              return {
                content: [
                  { type: "text" as const, text: "Trial tool response" },
                ],
                details: {},
              };
            },
          },
        }),
      ),
    );
    const reason = await runtime.hook("beforeRun");
    if (reason) throw new Error(reason);
    const result = await runtime.command(command);
    await runtime.hook("afterRun");
    if (!result.handled) throw new Error("Trial requires an extension command");
    controller.signal.throwIfAborted();
    await host.close(); closed = true;
    controller.signal.throwIfAborted();
    await options.assertTarget?.();
    const evidence = await host.lifecycle.record(verifiedResource,'simulation',{passed:true,check:'mock-host-services',sessionId:options.sessionId,runId:options.validationTaskId});
    await journal.append("trial.finished", { simulated: true, verification: evidence.verification }, {validationTaskId: options.validationTaskId});
    return {
      ...result,
      session: journal.directory,
      simulated: true,
      verification:evidence.verification,
      boundary: "Trusted code with mock host services; not an OS sandbox",
    };
  } catch (error) {
    let cleanupError: unknown;
    try { if (!closed) await host.close(); }
    catch (failure) { cleanupError = failure; }
    closed = true;
    const unknownCleanup = cleanupError || host.degraded || (error as { cleanup?: string })?.cleanup === 'unknown';
    const status = unknownCleanup ? "unknown" : controller.signal.aborted ? "cancelled" : "failed";
    if (cleanupError) error = new AggregateError([error, cleanupError], 'Trial cleanup unconfirmed');
    const verification: VerificationResult = { stage: "simulation", status, hostIntegration: "not_run", resourceId, resourceRevision: verifiedResource?.hash ?? "unknown", environment, check: "mock-host-services" };
    await journal.append("trial.finished", { simulated: true, verification, error: journal.clean(String(error)) }, {validationTaskId: options.validationTaskId});
    if (verifiedResource) try { await options.assertTarget?.(); await host.lifecycle.record(verifiedResource,'simulation',{passed:false,status,check:'mock-host-services',sessionId:options.sessionId,runId:options.validationTaskId}); }
    catch (recording) { error = new AggregateError([error, recording], `Trial target evidence unavailable: ${String(recording)}`); }
    throw Object.assign(new Error(String(error), { cause: error }), { session: journal.directory, verification });
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", cancel);
    try { if (!closed) await host.close(); } finally { await journal.close(); }
  }
}
export async function trialCandidate(workspace: string, home: string | undefined, candidateId: string, expectedHash: string, command: string, authorize = false, options: Omit<TrialOptions, "resource"> = {}) {
  options.signal?.throwIfAborted();
  const store = new Candidates(workspace);
  const { resource } = await store.prepare(candidateId, expectedHash);
  const host = new CustomizationHost(workspace, home);
  const settings = await host.catalog.decisions();
  if (!authorize && resource.manifest?.sdkVersion === 3 && resource.manifest.requiredCapabilities?.some(c => !settings.entries[resource.id]?.capabilities?.includes(c))) throw new Error("Trial capability expansion requires authorization");
  options.signal?.throwIfAborted();
  if (authorize) await host.catalog.decide(resource.id, true, true, settings.revision, resource);
  options.signal?.throwIfAborted();
  resource.status = "enabled";
  return trialExtension(workspace, home, resource.id, command, { ...options, resource });
}
