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
export interface TrialOptions {
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
  try {
    await journal.append("trial.started", { simulated: true, resourceId, resourceRevision: options.resource?.hash, command });
    await host.trial(resourceId, options.resource);
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
    return {
      ...result,
      session: journal.directory,
      simulated: true,
      boundary: "Trusted code with mock host services; not an OS sandbox",
    };
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", cancel);
    try { await host.close(); } finally { await journal.close(); }
  }
}
export async function trialCandidate(workspace: string, home: string | undefined, candidateId: string, expectedHash: string, command: string, authorize = false, options: Omit<TrialOptions, "resource"> = {}) {
  const store = new Candidates(workspace);
  const { resource } = await store.prepare(candidateId, expectedHash);
  const host = new CustomizationHost(workspace, home);
  const settings = await host.catalog.decisions();
  if (!authorize && resource.manifest?.sdkVersion === 2 && resource.manifest.requiredCapabilities?.some(c => !settings.entries[resource.id]?.capabilities?.includes(c))) throw new Error("Trial capability expansion requires authorization");
  if (authorize) await host.catalog.decide(resource.id, true, true, settings.revision, resource);
  resource.status = "enabled";
  return trialExtension(workspace, home, resource.id, command, { ...options, resource });
}
