import { expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProviderProfiles, type ProviderProfile } from "../src/customization/provider-profiles.js";
import { ProviderRegistry, defaultModel, type RegisteredProvider } from "../src/customization/provider-registry.js";
import { executeRecordedModel, type ModelRequest } from "../src/pi/model-service.js";
import { Journal } from "../src/journal.js";
import { run } from "../src/runtime.js";
import { temporary, key, response, textItem } from "./helpers.js";

const profile: ProviderProfile = { id: "explicit", providerId: "deepseek", resourceId: "builtin:deepseek", model: "physical-model", baseUrl: "https://fixture.invalid", paths: ["/responses"] };

it("rejects unsupported routing on save and restore without rewriting the source", async () => {
  const home = await temporary(), store = new ProviderProfiles(home);
  for (const routing of ["auto", "removed-router", null, { strategy: "cheapest" }]) {
    await expect(store.save({ ...profile, routing } as ProviderProfile, 0)).rejects.toThrow("Unsupported model routing");
  }
  await store.save({ ...profile, routing: "physical" }, 0);
  await store.select("work", profile.id, 1);
  expect((await store.resolve("work"))?.profile.routing).toBe("physical");
  const file = join(home, "provider-profiles.json"), restored = JSON.parse(await readFile(file, "utf8"));
  restored.entries.explicit.routing = "removed-router";
  const bytes = JSON.stringify(restored); await writeFile(file, bytes);
  let requests = 0;
  await expect(run({ home, session: await temporary(), workspace: await temporary(), apiKey: key, prompt: "continue", tools: [], fetch: async () => { requests++; return response([textItem()]); } })).rejects.toThrow("Unsupported model routing");
  expect(requests).toBe(0); expect(await readFile(file, "utf8")).toBe(bytes);
});

it("does not register an experimental strategy as a static model", () => {
  const provider = { id: "fixture", models: [{ ...defaultModel, routing: "auto" }], resource: { id: "extension:fixture", hash: "v1" } } as unknown as RegisteredProvider;
  expect(() => new ProviderRegistry([provider])).toThrow("Unsupported model routing");
});

it("rejects unsupported auxiliary routing before creating an attempt or invoking a decoder", async () => {
  const journal = await Journal.open(await temporary()); let requests = 0, decodes = 0;
  try {
    for (const operation of ["chat", "classifier", "image"] as const) {
      await expect(executeRecordedModel(journal, {
        routing: "auto", url: "https://fixture.invalid", body: "{}", provider: "fixture", model: "physical-model",
        protocol: "fixture", purpose: "extension", operation, contextRevision: 1, links: {},
        transport: { fetch: async () => { requests++; return Response.json({}); } },
        decode: async () => { decodes++; return {}; },
      } as unknown as ModelRequest<unknown>)).rejects.toThrow("Unsupported model routing");
    }
    expect(requests).toBe(0); expect(decodes).toBe(0);
    expect(journal.events.filter(event => event.type === "attempt.started")).toHaveLength(0);
  } finally { await journal.close(); }
});

it("uses the explicit model by default and rejects runtime routing without fallback", async () => {
  const home = await temporary(), workspace = await temporary(); const models: string[] = [];
  const options = { home, workspace, session: join(workspace, "session"), apiKey: key, prompt: "continue", tools: [], model: "chosen-physical",
    fetch: async (_url: unknown, init?: RequestInit) => { models.push(JSON.parse(String(init?.body)).model); return response([textItem()]); } };
  const result = await run(options); expect(result.status, result.error).toBe("completed");
  expect(models).toEqual(["chosen-physical"]);
  await expect(run({ ...options, routing: "auto" } as unknown as Parameters<typeof run>[0])).rejects.toThrow("Unsupported model routing");
  expect(models).toEqual(["chosen-physical"]);
});
