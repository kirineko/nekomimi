import { expect, it } from "vitest";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { assemblePrompt, type ToolDefinition } from "../src/context.js";
import { profileInstruction, type ProfilePurpose } from "../src/prompts.js";
import { hash, readSession, readArtifact, Journal } from "../src/journal.js";
import { run } from "../src/runtime.js";
import { temporary, key, response, textItem } from "./helpers.js";
const purposes: ProfilePurpose[] = ["work", "create", "compaction", "session-title", "handoff"];
const write: ToolDefinition = { tool: { name: "write", label: "write", description: "WRITE_DESCRIPTION", parameters: { type: "object" }, execute: async () => ({ content: [], details: {} }) }, snippet: "WRITE_GUIDANCE", guidance: [], source: "fixture:write" };

it("freezes five independent versioned profile fixtures, and isolates all auxiliary instructions and tools", async () => {
  const fixture = JSON.parse(await readFile("test/fixtures/task-profiles.json", "utf8"));
  for (const purpose of purposes) {
    const profile = profileInstruction(purpose); expect({ ...profile, hash: hash(profile.text) }).toEqual(fixture.profiles[purpose]);
    const prompt = assemblePrompt([write], [{ source: "fixture:create", text: "SDK_BODY_SENTINEL APPLY_CANDIDATE_NOW" }], purpose);
    expect(prompt.profile).toEqual({ id: purpose, version: profile.version, hash: hash(profile.text) });
    expect(prompt.fragments[0]).toMatchObject({ source: profile.source, version: profile.version, hash: hash(profile.text) });
    if (!["work", "create"].includes(purpose)) {
      expect(prompt.schemas).toEqual([]); expect(prompt.text).not.toContain("SDK_BODY_SENTINEL"); expect(prompt.text).not.toContain("APPLY_CANDIDATE_NOW");
      expect(prompt.text).not.toContain("WRITE_GUIDANCE"); expect(prompt.text).not.toContain("Work only in the immutable development target");
    }
  }
  expect(profileInstruction("main")).toEqual(profileInstruction("work"));
  expect(assemblePrompt([], [], "work").text).not.toContain("first read customization_sdk");
  expect(profileInstruction("handoff").text).toContain("candidate and active versions");
  expect(profileInstruction("compaction").text).toContain("UNKNOWN");
});
it("selects work and create from persisted mode for the same user task, with exact recorded profile and body", async () => {
  const owner = await temporary(), development = await temporary(), home = await temporary();
  const prompt = "同一用户文本，检查项目"; const profiles: unknown[] = [];
  for (const mode of ["work", "create"] as const) {
    const session = join(await realpath(await temporary()), "session"); let body: any;
    const result = await run({ workspace: mode === "work" ? owner : development, ownerWorkspace: owner, mode,
      ...(mode === "create" ? { target: { kind: "extension", root: development } as const } : {}), home, session, apiKey: key, prompt,
      fetch: async (_url, init) => { body = JSON.parse(String(init!.body)); return response([textItem()]); } }); expect(result.status, JSON.stringify(result)).toBe("completed");
    const events = (await readSession(session)).events, attempt = events.find(event => event.type === "attempt.started")!;
    const viewEvent = events.find(event => event.type === "context.view")!;
    const view = JSON.parse((await readArtifact(session, (viewEvent.payload as any).artifact)).toString());
    const profile = profileInstruction(mode);
    expect(attempt).toMatchObject({ mode, payload: { purpose: mode, profile: { id: mode, version: profile.version, hash: hash(profile.text) } } });
    expect(body.instructions).toBe(view.prompt.text); expect(body.instructions).toContain(profile.source);
    expect(view.prompt.profile).toEqual((attempt.payload as any).profile); profiles.push(view.prompt.profile);
    if (mode === "work") {
      expect(body.instructions).not.toContain("first read customization_sdk"); expect(body.instructions).not.toContain("Core changes require their own source baseline");
      expect(body.tools.some((tool: any) => tool.name === "customization_candidate")).toBe(false);
    } else {
      expect(body.instructions).toContain("first read customization_sdk"); expect(body.instructions).toContain("recorded host build, SDK and data contract versions");
      expect(body.instructions).toContain("A successful check or preview does not mean applied"); expect(body.tools.some((tool: any) => tool.name === "customization_candidate")).toBe(true);
    }
  }
  expect(profiles[0]).not.toEqual(profiles[1]);
});
it("keeps old recorded instruction bytes intact when new profiles are selected", async () => {
  const directory = join(await realpath(await temporary()), "old-request"), journal = await Journal.open(directory);
  const old = { text: "<policy source=\"nekomimi:main:v2\">Original instruction bytes</policy>", fragments: [{ source: "nekomimi:main:v2", version: "2", text: "Original instruction bytes", hash: hash("Original instruction bytes") }], schemas: [] };
  const artifact = await journal.artifact(JSON.stringify(old)); await journal.append("context.view", { revision: "old", artifact }); await journal.close();
  const before = await readFile(join(directory, "journal.jsonl"));
  expect(assemblePrompt([], [], "create").profile.version).toBe("3");
  const recorded = (await readSession(directory)).events[0]!;
  expect(JSON.parse((await readArtifact(directory, (recorded.payload as any).artifact)).toString())).toEqual(old);
  expect(await readFile(join(directory, "journal.jsonl"))).toEqual(before);
});
