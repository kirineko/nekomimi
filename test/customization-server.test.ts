import { it, expect } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startWeb } from "../src/server/app.js";
import { temporary, key, delay } from "./helpers.js";
import { readSession } from "../src/journal.js";
import { exportSession, importBundle } from "../src/export.js";
it("keeps form answers idempotent, restores history without plugin and protects management", async () => {
  const workspace = await temporary();
  const home = await temporary();
  const root = join(workspace, ".nekomimi/extensions/forms");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "extension.json"),
    JSON.stringify({ name: "forms", sdkVersion: 1, entry: "index.ts" }),
  );
  await writeFile(
    join(root, "index.ts"),
    `export default api=>{api.registerCommand('ask',{description:'Ask',async handler(args,ctx){const r=await ctx.ui({kind:'form',title:'Review choice',fields:[{name:'choice',label:'Choice',required:true,options:['yes','no']}]});await ctx.state.set('answer',1,r);return JSON.stringify(r);}});}`,
  );
  const app = await startWeb({
    workspace,
    home,
    apiKey: key,
    naming: false,
    staticDir: resolve("dist/web-dist"),
  });
  const req = (path: string, body?: unknown, origin = app.origin) =>
    fetch(app.origin + "/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${app.token}`,
        origin,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    expect(
      (
        await req(
          "/customization",
          { action: "reload" },
          "https://invalid.example",
        )
      ).status,
    ).toBe(403);
    const initial = await (await req("/customization")).json();
    const resource = initial.resources.find((r: any) => r.kind === "extension");
    await req("/customization", {
      action: "set",
      id: resource.id,
      enabled: true,
      trusted: true,
      revision: initial.settingsRevision,
    });
    const session = await (
      await req("/sessions", { version: 1, title: "custom" })
    ).json();
    const receipt = await (
      await req(`/sessions/${session.id}/submit`, {
        version: 1,
        commandId: "first",
        prompt: "/ask",
      })
    ).json();
    let items: any[] = [];
    for (let n = 0; n < 60 && !items.length; n++) {
      items = (await (await req(`/sessions/${session.id}/interactions`)).json())
        .items;
      await delay(20);
    }
    expect(items).toHaveLength(1);
    const answer = {
      id: items[0].id,
      commandId: "answer",
      answer: { choice: "yes" },
    };
    expect((await req(`/sessions/${session.id}/answer`, answer)).status).toBe(
      200,
    );
    await app.sessions.active?.done;
    expect((await req(`/sessions/${session.id}/answer`, answer)).status).toBe(
      200,
    );
    expect(
      (
        await req(`/sessions/${session.id}/answer`, {
          ...answer,
          answer: { choice: "no" },
        })
      ).status,
    ).toBe(409);
    const duplicate = await (
      await req(`/sessions/${session.id}/submit`, {
        version: 1,
        commandId: "first",
        prompt: "/ask",
      })
    ).json();
    expect(duplicate.runId).toBe(receipt.runId);
    const entry = await app.sessions.entry(session.id);
    const events = (await readSession(entry.directory)).events;
    expect(
      events.filter((e) => e.type === "interaction.answered"),
    ).toHaveLength(1);
    await rm(root, { recursive: true });
    await exportSession(entry.directory, {
      format: "html",
      output: join(workspace, "history.html"),
    });
    await exportSession(entry.directory, { format: 'bundle', output: join(workspace, 'bundle') });
    const imported = join(workspace, 'imported'); await importBundle(join(workspace, 'bundle'), imported);
    expect((await readSession(imported)).events.some(e => e.type === 'interaction.answered')).toBe(true);
    const snapshot = await (
      await req(`/sessions/${session.id}/snapshot`)
    ).json();
    expect(JSON.stringify(snapshot)).toContain("yes");
  } finally {
    await app.close();
  }
});
