#!/usr/bin/env node
import lockfile from "proper-lockfile";
import { parseArgs } from "node:util";
import { ConfigStore } from "./config/store.js";
import { configure } from "./config/interactive.js";
import { workspacePaths } from "./storage/paths.js";
import { migrate } from "./storage/migrate.js";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { run } from "./runtime.js";
import { readSession, id } from "./journal.js";
import { exportSession, inspectBundle, importBundle } from "./export.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      home: { type: "string" },
      execute: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      json: { type: "boolean" },
      workspace: { type: "string" },
      session: { type: "string" },
      model: { type: "string" },
      provider: { type: "string" },
      "credential-file": { type: "string" },
      "omit-reasoning": { type: "boolean" },
      "base-url": { type: "string" },
      "max-output-tokens": { type: "string" },
      "max-turns": { type: "string" },
      output: { type: "string", short: "o" },
      format: { type: "string" },
      redact: { type: "string", multiple: true },
      instructions: { type: "string", multiple: true },
      tools: { type: "string" },
      image: { type: "string", multiple: true },
    },
  });
  const [command, arg, ...rest] = positionals;
  if (values.help || !command) {
    console.log(
      `Nekomimi — inspectable local coding agent\n\nnekomimi web [--workspace <dir>] [--port <port>]\n\nnekomimi run <prompt> [--workspace <dir>] [--session <dir>] [--json]\nnekomimi resume <session> <prompt> [--json]\nnekomimi replay <session>\nnekomimi export <session> --format html|bundle --output <path> [--redact <text>]\nnekomimi inspect <bundle>\nnekomimi import <bundle> --output <new-session-dir>\n\nOptions: --model, --provider <profile>, --base-url, --max-output-tokens, --max-turns, --instructions <file>, --tools <comma-list>, --image <file>\nCustomization: nekomimi extensions list|validate|trial|enable|disable|reload [resource-id].\nCandidates: nekomimi candidates create|inspect|trial|activate|rollback|sdk.\nPackages: nekomimi packages prepare|inspect|activate|list|rollback|export|uninstall|collect <JSON-options>.\nModels: nekomimi providers list|save|select|credential|migrate; nekomimi branch <session> --output <new-directory> [--omit-reasoning].\nMCP OAuth: nekomimi mcp-auth status|authorize|disconnect <resource-id>.\nWorkflows: nekomimi workflows list|inspect|start|resume|answer|resolve|cancel|migrate|evidence|artifact|recover|state-get|state-migrate <JSON-options>.\nConfiguration: nekomimi config; nekomimi migrate [--execute]; --home <directory>.\nShell executes locally with your OS permissions; only file tools enforce workspace boundaries.\nFull bundles contain task content; HTML is a redacted offline reading view.`,
    );
    return;
  }
  const store = new ConfigStore(values.home);
  if (command === "config") {
    await configure(store);
    return;
  }
  if (command === "migrate") {
    const paths = await workspacePaths(resolve(values.workspace ?? process.cwd()), values.home);
    const release = await lockfile.lock(paths.sessions, { retries: 0 });
    try {
      console.log(JSON.stringify(await migrate(paths, !!values.execute), null, 2));
    } finally {
      await release();
    }
    return;
  }
  if (command === "web") {
    const { startWeb } = await import("./server/app.js");
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port");
    const app = await startWeb({
      workspace: resolve(values.workspace ?? process.cwd()),
      port,
      home: values.home,
      model: values.model,
      baseUrl: values["base-url"],
    });
    console.log(`Web: ${app.url}`);
    let stopping = false;
    const stop = () => {
      if (!stopping) {
        stopping = true;
        void app.close().catch((e) => {
          console.error(String(e));
          process.exitCode = 1;
        });
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }
  if (command === 'workflows') {
    const input = rest[0] ? JSON.parse(rest[0]) : {};
    const { CustomizationHost } = await import('./customization/host.js');
    const host = new CustomizationHost(resolve(values.workspace ?? process.cwd()), values.home);
    const settings = await store.snapshot(); host.workflows.configure({ ...settings, apiKey: settings.apiKey ?? '' });
    const paths = await workspacePaths(host.catalog.workspace, values.home);
    const readonly = !arg || ['list', 'inspect', 'evidence', 'artifact', 'state-get'].includes(arg);
    const release = readonly ? undefined : await lockfile.lock(paths.sessions, { retries: 0 });
    const abort = new AbortController(), stop = () => abort.abort(new Error('Workflow interrupted'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const flows = host.workflows;
      let result: unknown;
      if (!arg || arg === 'list') result = await flows.list();
      else if (arg === 'recover') result = await flows.recoverWorkflow(String(input.id));
      else if (arg === 'state-get') result = await flows.stateGet(String(input.resourceId),String(input.key),Number(input.schemaVersion));
      else if (arg === 'state-migrate') result = await flows.stateMigrate(input);
      else if (arg === 'inspect') result = await flows.inspect(String(input.id));
      else if (arg === 'evidence') result = await flows.evidence(String(input.id), input.offset);
      else if (arg === 'artifact') result = await flows.artifact(String(input.id), String(input.hash));
      else if (arg === 'start' || arg === 'migrate') {
        const activation = await host.acquire(); let state;
        try { state = arg === 'start' ? await flows.create(String(input.resourceId), String(input.definitionId), input.input ?? {}, activation, input.commandId) : await flows.migrate(String(input.id), Number(input.revision), input.target, activation); }
        finally { await host.release(); }
        result = arg === 'start' && state.status === 'queued' ? await flows.advance(state.id, { signal: abort.signal, expectedRevision: state.revision }) : state;
      } else if (arg === 'resume') result = await flows.advance(String(input.id), { signal: abort.signal, expectedRevision: Number(input.revision) });
      else if (arg === 'answer') result = await flows.answer(String(input.id), String(input.waitId), String(input.commandId), input.answer, Number(input.revision));
      else if (arg === 'resolve') result = await flows.resolveUnknown(String(input.id), Number(input.revision), input.choice);
      else if (arg === 'cancel') result = await flows.cancel(String(input.id), Number(input.revision));
      else throw new Error('Unknown workflows action');
      console.log(JSON.stringify(result, null, 2));
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await host.close(); await release?.(); }
    return;
  }
  if (command === 'branch') {
    if (!arg || !values.output) throw new Error('Use branch <session> --output <new-session-directory>');
    const { branchHistory } = await import('./customization/history-branch.js');
    const original = await readSession(resolve(arg));
    console.log(JSON.stringify(await branchHistory(resolve(arg), resolve(values.output), resolve(values.workspace ?? String((original.events[0]?.payload as any)?.workspace)), values['omit-reasoning'] === true)));
    return;
  }
  if (command === 'providers') {
    const { ProviderProfiles } = await import('./customization/provider-profiles.js');
    const profiles = new ProviderProfiles(store.home), current = await profiles.list();
    if (arg === 'credential') {
      if (!values['credential-file']) throw new Error('Use --credential-file with a private file; credentials are not accepted as command arguments');
      await profiles.saveCredential(rest[0] ?? '', (await readFile(resolve(values['credential-file']), 'utf8')).trim()); console.log('Saved server-side credential reference.');
    } else if (arg === 'save') console.log(JSON.stringify(await profiles.save(JSON.parse(rest[0] ?? '{}'), current.revision)));
    else if (arg === 'select') console.log(JSON.stringify(await profiles.select(rest[0] as 'main' | 'auxiliary' | 'naming', rest[1], current.revision)));
    else if (arg === 'migrate') console.log(JSON.stringify(await profiles.migrateLegacy(current.revision)));
    else if (!arg || arg === 'list') console.log(JSON.stringify(current, null, 2));
    else throw new Error('Unknown providers action');
    return;
  }
  if (command === 'mcp-auth') {
    const { CustomizationHost } = await import('./customization/host.js');
    const host = new CustomizationHost(resolve(values.workspace ?? process.cwd()), values.home);
    const controller = new AbortController();
    const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const resource = (await host.catalog.discover()).find(r => r.id === rest[0] && r.kind === 'mcp');
      if (!resource) throw new Error('Specify an MCP resource ID from extensions list');
      if (arg === 'authorize') {
        const started = await host.oauth.begin(resource); console.log(JSON.stringify(started));
        while (!controller.signal.aborted && Date.now() < started.expiresAt) {
          const state = await host.oauth.describe(resource);
          if (state.status !== 'authorizing') { console.log(JSON.stringify(state)); if (state.status !== 'authorized') process.exitCode = 1; break; }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } else if (arg === 'disconnect') { await host.oauth.disconnect(resource); console.log(JSON.stringify(await host.oauth.describe(resource))); }
      else if (!arg || arg === 'status') console.log(JSON.stringify(await host.oauth.describe(resource)));
      else throw new Error('Unknown mcp-auth action');
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await host.close(); }
    return;
  }
  if (command === 'packages') {
    const { CustomizationHost } = await import('./customization/host.js');
    const { packageAction } = await import('./customization/package-management.js');
    const host = new CustomizationHost(resolve(values.workspace ?? process.cwd()), values.home);
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Package operation cancelled'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const input = rest[0] ? JSON.parse(rest[0]) : {};
      const result = await packageAction(host, { ...input, action: arg ?? 'list', authorize: true }, { user: true, signal: controller.signal });
      if (result && typeof result === 'object' && 'status' in result && result.status === 'pending' && 'id' in result) await host.reload(result as import('./customization/host.js').ReloadReceipt);
      console.log(JSON.stringify(result, null, 2));
      if (result && typeof result === 'object' && 'status' in result && result.status === 'failed') process.exitCode = 1;
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await host.close(); }
    return;
  }
  if (command === 'candidates') {
    const { Candidates } = await import('./customization/candidates.js');
    const { sdkCatalog } = await import('./customization/sdk.js');
    const store = new Candidates(resolve(values.workspace ?? process.cwd()));
    if (arg === 'sdk') console.log(JSON.stringify(await sdkCatalog(rest[0]), null, 2));
    else if (arg === 'create') console.log(JSON.stringify(await store.scaffold(rest[0] ?? ''), null, 2));
    else if (arg === 'inspect') {
      const { candidate } = await store.inspect(rest[0] ?? '');
      console.log(JSON.stringify(candidate, null, 2));
      if (!candidate.report.passed) process.exitCode = 1;
    } else if (arg === 'trial') {
      const { trialCandidate } = await import('./customization/trial.js');
      const controller = new AbortController();
      const stop = () => controller.abort(new Error('Trial cancelled'));
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { console.log(JSON.stringify(await trialCandidate(store.workspace, values.home, rest[0] ?? '', rest[1] ?? '', rest[2] ?? '', true, { signal: controller.signal }), null, 2)); }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }

    } else if (arg === 'activate' || arg === 'rollback') {
      const { CustomizationHost } = await import('./customization/host.js');
      const host = new CustomizationHost(store.workspace, values.home);
      try {
        const receipt = arg === 'activate' ? await host.requestCandidate(rest[0] ?? '', rest[1] ?? '', true) : await host.requestRollback(rest[0] ?? '', true);
        await host.reload(receipt);
        console.log(JSON.stringify(receipt));
        if (receipt.status === 'failed') process.exitCode = 1;
      } finally { await host.close(); }
    } else if (!arg || arg === 'list') console.log(JSON.stringify(await store.list(), null, 2));
    else throw new Error('Unknown candidates action');
    return;
  }
  if (command === 'extensions') {
    const { CustomizationHost, validateExtension } = await import('./customization/host.js');
    const host = new CustomizationHost(resolve(values.workspace ?? process.cwd()), values.home);
    try {
      if (!arg || arg === 'list') console.log(JSON.stringify(await host.describe(), null, 2));
      else if (arg === 'reload') { const receipt = host.requestReload(); await host.reload(receipt); console.log(JSON.stringify(receipt)); if (receipt.status === 'failed') process.exitCode = 1; }
      else {
        const resource = (await host.catalog.discover()).find(r => r.id === rest[0]);
        if (!resource) throw new Error('Specify a resource ID from extensions list');
        if (arg === 'trial') { const { trialExtension } = await import('./customization/trial.js'); console.log(JSON.stringify(await trialExtension(host.catalog.workspace, values.home, resource.id, rest[1] ?? ''))); }
        else if (arg === 'validate') { const errors = await validateExtension(resource); console.log(JSON.stringify({ errors })); if (errors.length) process.exitCode = 1; }
        else if (arg === 'enable' || arg === 'disable') { await host.catalog.decide(resource.id, arg === 'enable', arg === 'enable', (await host.catalog.decisions()).revision); console.log('Saved. Reload active Web service to apply.'); }
        else throw new Error('Unknown extensions action');
      }
    } finally { await host.close(); }
    return;
  }
  if (!arg) throw new Error("Missing prompt or session path");
  if (command === "replay") {
    console.log(JSON.stringify(await readSession(arg), null, 2));
    return;
  }
  if (command === "inspect") {
    console.log(JSON.stringify(await inspectBundle(arg), null, 2));
    return;
  }
  if (command === "import") {
    if (!values.output) throw new Error("--output is required");
    console.log(await importBundle(arg, values.output));
    return;
  }
  if (command === "export") {
    if (!values.output || !["html", "bundle"].includes(values.format ?? ""))
      throw new Error("--format html|bundle and --output are required");
    console.log(
      await exportSession(arg, {
        output: values.output,
        format: values.format as "html" | "bundle",
        redact: values.redact,
      }),
    );
    return;
  }
  if (command !== "run" && command !== "resume")
    throw new Error("Unknown command");
  const settings = await store.snapshot();
  const apiKey = settings.apiKey ?? '';
  const { ProviderProfiles } = await import('./customization/provider-profiles.js');
  if (!apiKey && !(await new ProviderProfiles(store.home).resolve('main', values.provider)))
    throw new Error("请运行 nekomimi config 或在 Web 设置中保存 API key");
  const session =
    command === "resume"
      ? resolve(arg)
      : resolve(
          values.session ??
            join(
              (
                await workspacePaths(
                  resolve(values.workspace ?? process.cwd()),
                  values.home,
                )
              ).sessions,
              id(),
            ),
        );
  const prior =
    command === "resume"
      ? ((await readSession(session)).events.find(
          (e) => e.type === "session.created",
        )?.payload as
          | { workspace: string; model: string; baseUrl: string }
          | undefined)
      : undefined;
  const prompt =
    command === "resume" ? rest.join(" ") : [arg, ...rest].join(" ");
  const instructions = await Promise.all(
    (values.instructions ?? []).map(async (path) => ({
      source: resolve(path),
      text: await readFile(path, "utf8"),
    })),
  );
  const images = await Promise.all(
    (values.image ?? []).map(async (path) => {
      const extension = path.split(".").at(-1)?.toLowerCase();
      const mimeType = (
        {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        } as Record<string, string>
      )[extension ?? ""];
      if (!mimeType) throw new Error("Unsupported image format");
      return {
        type: "image" as const,
        data: (await readFile(path)).toString("base64"),
        mimeType,
      };
    }),
  );
  const positive = (value: string | undefined, fallback: number) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1)
      throw new Error("Limits must be positive integers");
    return n;
  };
  const workspaceRoot=await workspacePaths(resolve(values.workspace ?? prior?.workspace ?? process.cwd()),values.home);
  const releaseWorkspace=await lockfile.lock(workspaceRoot.sessions,{retries:0});
  const abort = new AbortController();
  const onInterrupt = () => abort.abort(new Error("User cancelled"));
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  try {
    if (!values.json) console.error(`Session: ${session}`);
    const result = await run({
      session,
      home: values.home,
      workspace: resolve(values.workspace ?? prior?.workspace ?? process.cwd()),
      prompt,
      apiKey,
      providerProfile: values.provider,
      search: settings.search,
      model: values.model ?? settings.model,
      baseUrl: values["base-url"] ?? settings.baseUrl,
      maxOutputTokens: positive(values["max-output-tokens"], 4096),
      maxTurns: positive(values["max-turns"], 32),
      instructions,
      images,
      tools: values.tools?.split(",").filter(Boolean),
      signal: abort.signal,
    });
    console.log(
      values.json
        ? JSON.stringify(result)
        : `${result.text || result.error || result.status}\n[${result.status}; durable sequence ${result.durableSeq}]`,
    );
    process.exitCode =
      result.status === "completed"
        ? 0
        : result.status === "cancelled"
          ? 130
          : 1;
  } finally {
    await releaseWorkspace();
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}
main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
