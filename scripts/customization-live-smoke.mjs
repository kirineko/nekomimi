// Explicit live exercise: synthetic workspace only, never included in CI.
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../dist/config/store.js";
import { run, readSession } from "../dist/index.js";
import {
  CustomizationHost,
  validateExtension,
} from "../dist/customization/host.js";
const config = await new ConfigStore().snapshot();
if (!config.apiKey)
  throw new Error("Live customization requires locally configured credentials");
const workspace = await mkdtemp(join(tmpdir(), "nekomimi-custom-live-"));
const home = join(workspace, "home");
await mkdir(home);
const root = join(workspace, ".nekomimi/extensions/review");
await mkdir(root, { recursive: true });
await writeFile(join(workspace, "sample.txt"), "synthetic review target v1\n");
await writeFile(
  join(root, "extension.json"),
  JSON.stringify({
    name: "review",
    sdkVersion: 1,
    entry: "index.ts",
    requiredCapabilities: ["commands", "tools", "ui"],
  }),
);
// Deliberately malformed first-generation fixture: verifies repair, not generation success rate.
await writeFile(join(root, "index.ts"), "export default !!!");
const host = new CustomizationHost(workspace, home);
const settings = {
  ...config,
  workspace,
  home,
  customization: host,
  session: join(workspace, "session"),
  tools: [
    "read",
    "write",
    "edit",
    "resource_list",
    "resource_read",
    "customization_validate",
    "customization_reload",
  ],
  maxTurns: 16,
  maxOutputTokens: 4096,
  timeoutMs: 90000,
};
const started = Date.now();
try {
  // An invalid discovered resource must not stop the agent from repairing its files.
  const first = await run({
    ...settings,
    prompt:
      'This is an authorized synthetic customization exercise. Read the bundled SDK documentation with resource_list/resource_read, then read .nekomimi/extensions/review/index.ts and repair its deliberately invalid TypeScript. Implement /review as a registered command that uses ctx.callTool("read", {path:"sample.txt"}), shows the read result text (including its evidence footer is acceptable) in a card titled "Live review", and returns the same text. The read result has content:[{type:"text",text:string}], so use result.content.filter(c=>c.type==="text").map(c=>c.text).join("\\n"). Do not investigate implementation details; the bundled example is sufficient. Do not use ctx.model, shell, network, or forms. Run customization_validate and fix errors. Do not enable extensions or request reload yet.',
  });
  if (first.status !== "completed")
    throw new Error(`Repair failed: ${first.status} ${first.error ?? ""}`);
  const resource = (await host.catalog.discover()).find(
    (r) => r.kind === "extension",
  );
  const errors = await validateExtension(resource);
  if (errors.length) throw new Error(errors.join("\n"));
  await host.catalog.decide(
    resource.id,
    true,
    true,
    (await host.catalog.decisions()).revision,
  );
  const receipt = host.requestReload();
  await host.reload(receipt);
  if (receipt.status !== "activated") throw new Error(receipt.error);
  const used = await run({ ...settings, prompt: "/review" });
  if (
    used.status !== "completed" ||
    !used.text.includes("synthetic review target v1")
  )
    throw new Error(`Use failed: ${used.error ?? used.text}`);
  const second = await run({
    ...settings,
    prompt:
      'Modify the review extension using read/edit tools: keep its read of sample.txt, but prefix both the displayed card text and returned command result with "UPDATED: ". Read the file first. Validate with customization_validate, then request customization_reload. This is the already-authorized extension; do not use shell or modify sample.txt.',
  });
  if (second.status !== "completed")
    throw new Error(`Update failed: ${second.status} ${second.error ?? ""}`);
  const usedAgain = await run({ ...settings, prompt: "/review" });
  if (
    usedAgain.status !== "completed" ||
    !usedAgain.text.startsWith("UPDATED: ")
  )
    throw new Error(`Updated use failed: ${usedAgain.error ?? usedAgain.text}`);
  const journal = await readSession(settings.session);
  const report = {
    workspace,
    node: process.version,
    model: config.model,
    elapsedMs: Date.now() - started,
    statuses: [first.status, used.status, second.status, usedAgain.status],
    attempts: journal.events.filter((e) => e.type === "attempt.finished")
      .length,
    cards: journal.events.filter((e) => e.type === "extension.ui").length,
    initialFailure:
      "deliberately malformed TypeScript fixture; not a naturally occurring model failure",
    source: await readFile(join(root, "index.ts"), "utf8"),
  };
  await writeFile(
    join(workspace, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, source: undefined }, null, 2));
} finally {
  await host.close();
}
