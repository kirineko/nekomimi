import { it, expect } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { temporary, key } from "./helpers.js";
import { Journal } from "../src/journal.js";
import { CustomizationHost } from "../src/customization/host.js";
import { CustomRun } from "../src/customization/run.js";
it("keeps scoped rules separate, withdraws removed user rules and bounds repeated changes", async () => {
  const workspace = await temporary();
  const home = await temporary();
  await mkdir(join(workspace, "a"));
  await mkdir(join(workspace, "b"));
  await writeFile(join(workspace, "a/AGENTS.md"), "A_ONLY");
  await writeFile(join(workspace, "b/AGENTS.md"), "B_ONLY");
  await writeFile(join(home, "AGENTS.md"), "USER_RULE");
  const host = new CustomizationHost(workspace, home);
  const journal = await Journal.open(join(workspace, "session"));
  try {
    const active = await host.acquire();
    const custom = new CustomRun(
      host,
      active,
      journal,
      "test",
      new AbortController().signal,
      { apiKey: key },
    );
    await custom.initialize([]);
    expect(custom.instructions.map((i) => i.text).join("")).toContain(
      "USER_RULE",
    );
    expect(await custom.checkRules("write", { path: "a/file" })).toContain(
      "Rules were loaded",
    );
    expect(custom.instructions.map((i) => i.text).join("")).not.toContain(
      "B_ONLY",
    );
    expect(await custom.checkRules("write", { path: "b/file" })).toContain(
      "Rules were loaded",
    );
    expect(
      custom.instructions.find((i) => i.text.includes("A_ONLY"))?.text,
    ).toContain("scope: a");
    await rm(join(home, "AGENTS.md"));
    expect(await custom.checkRules("bash", { command: "echo test" })).toContain(
      "Rules were loaded",
    );
    expect(custom.instructions.map((i) => i.text).join("")).not.toContain(
      "USER_RULE",
    );
    for (let n = 0; n < 5; n++) {
      await writeFile(join(workspace, "a/AGENTS.md"), "changed " + n);
      await custom.checkRules("write", { path: "a/file" });
    }
    await writeFile(join(workspace, "a/AGENTS.md"), "one change too many");
    await expect(
      custom.checkRules("write", { path: "a/file" }),
    ).rejects.toThrow("repeatedly");
  } finally {
    await journal.close();
    await host.release();
    await host.close();
  }
});

it('reads a skill from the captured run revision even if its source changes', async () => {
  const workspace = await temporary(); const home = await temporary(); const path = join(workspace, '.agents/skills/review/SKILL.md');
  await mkdir(join(workspace, '.agents/skills/review'), { recursive: true });
  const source = '---\nname: review\ndescription: review\n---\nORIGINAL_SKILL'; await writeFile(path, source);
  const host = new CustomizationHost(workspace, home); const journal = await Journal.open(join(workspace, 'session'));
  try {
    const active = await host.acquire(); const custom = new CustomRun(host, active, journal, 'run', new AbortController().signal, { apiKey: key }); await custom.initialize([]);
    await writeFile(path, source.replace('ORIGINAL_SKILL', 'CHANGED_SKILL'));
    const skill = active.resources.find(r => r.kind === 'skill')!;
    expect(await custom.load(skill.id)).toBe(source);
    await rm(path); await expect(custom.load(skill.id)).rejects.toThrow("missing");
  } finally { await journal.close(); await host.release(); await host.close(); }
});
