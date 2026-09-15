import { expect, test } from "vitest";
import { writeFile, mkdir, symlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createPatch } from "diff";
import { Journal, readArtifact, type JournalEvent } from "../src/journal.js";
import { parseSearch, webSearch } from "../src/web-search.js";
import { diffPage } from "../src/presentation/diff.js";
import {
  listFiles,
  workspacePath,
  WorkspaceFiles,
  openerCommand,
} from "../src/server/workspace.js";
import { fileChanges, fileChangesPage } from "../src/server/changes.js";
import {
  temporary,
  key,
  callItem,
  reasoning,
  response,
  textItem,
} from "./helpers.js";
import { run } from "../src/runtime.js";
import { ConfigStore } from "../src/config/store.js";
const payload = {
  content: [
    { type: "server_tool_use", name: "web_search", id: "s" },
    {
      type: "web_search_tool_result",
      tool_use_id: "s",
      content: [
        {
          type: "web_search_result",
          title: "Example",
          url: "https://example.com",
        },
      ],
    },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 4 },
};
test("search matches calls and distinguishes empty, partial, forged and unsafe sources", () => {
  expect(parseSearch(payload).status).toBe("complete");
  expect(parseSearch({ ...payload, stop_reason: "max_tokens" }).status).toBe(
    "partial",
  );
  expect(parseSearch({ content: [payload.content[1]] }).status).toBe("failed");
  expect(
    parseSearch({
      content: [payload.content[0], { ...payload.content[1], content: [] }],
    }).status,
  ).toBe("empty");
  expect(
    parseSearch({
      content: [
        payload.content[0],
        {
          ...payload.content[1],
          content: [
            {
              type: "web_search_result",
              title: "bad",
              url: "javascript:alert(1)",
            },
          ],
        },
      ],
    }).sources,
  ).toEqual([]);
});
test("search transport is recorded, bounded and never retries", async () => {
  const directory = await temporary();
  const journal = await Journal.open(directory, { secrets: [key] });
  let calls = 0;
  const fetch: typeof globalThis.fetch = async (_u, init) => {
    calls++;
    expect(JSON.parse(String(init?.body)).tools[0].name).toBe("web_search");
    return Response.json(payload);
  };
  try {
    const result = await webSearch(
      journal,
      { runId: "run", toolCallId: "tool" },
      "example",
      { apiKey: key, fetch },
    );
    expect(result.details.sources).toHaveLength(1);
    const request = journal.events.find(
      (e) => e.type === "request.dispatched",
    )!;
    expect(request.toolCallId).toBe("tool");
    expect(request.attemptId).toBeTruthy();
    expect(
      (
        await readArtifact(journal.directory, (request.payload as any).body)
      ).toString(),
    ).toContain('"web_search"');
    expect(JSON.stringify(journal.events)).not.toContain(key);
    await expect(
      webSearch(journal, {}, "example", {
        apiKey: key,
        fetch,
        maxResponseBytes: 10,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
    expect(
      journal.events.filter((e) => e.type === "attempt.finished"),
    ).toHaveLength(2);
  } finally {
    await journal.close();
  }
});
test("search cancellation records a terminal attempt", async () => {
  const journal = await Journal.open(await temporary());
  const cancel = new AbortController();
  try {
    const result = webSearch(
      journal,
      {},
      "example",
      {
        apiKey: key,
        fetch: async (_u, init) =>
          new Promise((_, reject) => {
            init!.signal!.addEventListener("abort", () =>
              reject(new Error("abort")),
            );
            setTimeout(() => cancel.abort(), 10);
          }),
      },
      cancel.signal,
    );
    await expect(result).rejects.toThrow();
    expect((journal.events.at(-1)?.payload as any).status).toBe("cancelled");
  } finally {
    await journal.close();
  }
});
test("search integrates as a paired tool result without Messages in Responses history", async () => {
  const session = await temporary();
  let count = 0;
  const result = await run({
    session,
    workspace: await temporary(),
    apiKey: key,
    prompt: "search",
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/messages")) return Response.json(payload);
      count++;
      if (count === 1)
        return response([
          reasoning,
          callItem("web_search", { query: "example" }),
        ]);
      expect(
        body.input.some((i: any) => i.type === "function_call_output"),
      ).toBe(true);
      expect(JSON.stringify(body.input)).not.toContain("server_tool_use");
      return response([textItem()]);
    },
  });
  expect(result.status).toBe("completed");
});
test("old settings gain search defaults and explicit disable persists", async () => {
  const store = new ConfigStore(await temporary());
  const old = await store.describe();
  const next = await store.save("settings", {
    revision: old.revision,
    model: old.model,
    baseUrl: old.baseUrl,
    search: { ...old.search, enabled: false },
  });
  expect(next.search.enabled).toBe(false);
  expect((await store.snapshot()).search.enabled).toBe(false);
});
test("diff lines count changes, preserve context and paginate", () => {
  const patch = createPatch("a", "one\ntwo\nthree\n", "one\nTWO\nthree\n");
  const p = diffPage(patch, 0, 2);
  expect(p.added).toBe(1);
  expect(p.removed).toBe(1);
  expect(p.next).toBe(2);
  expect(diffPage(createPatch("a", "", "a\n")).added).toBe(1);
  expect(diffPage(createPatch("a", "a", "a")).total).toBe(0);
  expect(() => diffPage("broken")).toThrow();
  expect(diffPage(createPatch("a", "a\r\n", "b\r\n")).removed).toBe(1);
  expect(
    fileChanges([
      { type: "file.change_prepared" } as any,
      { type: "tool.failed", payload: { source: "tool:write" } } as any,
    ]),
  ).toEqual([]);
});
test("file service paginates, rejects escapes and safely opens literal paths", async () => {
  const root = await temporary(),
    outside = await temporary();
  await mkdir(join(root, "dir"));
  await Promise.all(
    Array.from({ length: 202 }, (_, i) => writeFile(join(root, `f${i}`), "")),
  );
  await writeFile(join(root, ".hidden"), "");
  const first = await listFiles(root);
  expect(first.entries).toHaveLength(200);
  expect(first.next).toBeTruthy();
  expect(first.entries[0]?.type).toBe("directory");
  expect((await listFiles(root, ".", false, first.next)).entries).toHaveLength(
    3,
  );
  await writeFile(join(root, "added"), "");
  await expect(listFiles(root, ".", false, first.next)).rejects.toThrow("刷新");
  await symlink(outside, join(root, "escape"));
  await expect(workspacePath(root, "escape", true)).rejects.toThrow();
  await expect(workspacePath(root, "../outside")).rejects.toThrow();
  const name = "中文 ' & $ file.txt";
  await writeFile(join(root, name), "text");
  let opened = "",
    n = 0;
  const service = new WorkspaceFiles(root, async (p) => {
    opened = p;
    n++;
    await new Promise((r) => setTimeout(r, 10));
  });
  await Promise.all([service.open(name), service.open(name)]);
  expect(n).toBe(1);
  expect(opened).toBe(await realpath(join(root, name)));
  const windows = openerCommand(opened, "win32");
  expect(windows.args.join(" ")).not.toContain(name);
  expect(windows.env.NEKOMIMI_OPEN_FILE).toBe(opened);
});

test("disabled search contributes neither schema nor guidance", async () => {
  await run({
    session: await temporary(),
    workspace: await temporary(),
    apiKey: key,
    prompt: "hello",
    search: {
      enabled: false,
      model: "deepseek-flash",
      baseUrl: "https://api.deepseek.com/anthropic/v1",
    },
    fetch: async (_u, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools.some((t: any) => t.name === "web_search")).toBe(false);
      expect(body.instructions).not.toContain("Use web_search");
      return response([textItem()]);
    },
  });
});
test("diff evidence remains independent of files and failures, with missing artifacts explicit", async () => {
  const { changeDiff } = await import("../src/server/changes.js");
  const journal = await Journal.open(await temporary());
  try {
    const patch = await journal.artifact(createPatch("x", "old\n", "new\n"));
    await journal.append(
      "file.change_prepared",
      { path: "x", patch },
      { runId: "r", toolCallId: "t" },
    );
    expect(fileChanges(journal.events)).toHaveLength(0);
    await journal.append(
      "tool.result",
      { source: "tool:edit", details: { path: "x", patch } },
      { runId: "r", toolCallId: "t" },
    );
    const entry = {
      directory: journal.directory,
      reader: { events: journal.events },
    } as any;
    const first = await changeDiff(entry, patch.sha256, 0, 120);
    expect(first.added).toBe(1);
    await writeFile(join(journal.directory, "x"), "unrelated current content");
    expect(await changeDiff(entry, patch.sha256, 0, 120)).toEqual(first);
    await journal.append(
      "tool.result",
      { source: "tool:write", details: { path: "x", patch } },
      { runId: "r2", toolCallId: "t2" },
    );
    expect(fileChanges(journal.events)).toHaveLength(2);
    await writeFile(
      join(journal.directory, "artifacts", patch.sha256),
      "corrupted",
    );
    expect(
      (await changeDiff(entry, patch.sha256, 0, 120)).unavailable,
    ).toContain("Artifact");
  } finally {
    await journal.close();
  }
});
test("diff bounds long lines and provides complete totals for large patches", () => {
  const page = diffPage(
    createPatch("x", "", "x".repeat(20000) + "\n" + "line\n".repeat(1000)),
    0,
    8,
  );
  expect(page.added).toBe(1001);
  expect(page.lines).toHaveLength(8);
  expect(page.lines[1]?.truncated).toBe(true);
  expect(page.lines[1]?.text.length).toBe(4000);
});
test("missing keys, HTTP errors and failed server tools do not succeed", async () => {
  const journal = await Journal.open(await temporary());
  let calls = 0;
  try {
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      return new Response("unavailable", { status: 503 });
    };
    await expect(
      webSearch(journal, {}, "q", { apiKey: "", fetch }),
    ).rejects.toThrow("API key");
    expect(calls).toBe(0);
    await expect(
      webSearch(journal, {}, "q", { apiKey: key, fetch }),
    ).rejects.toThrow("503");
    expect(calls).toBe(1);
    await expect(
      webSearch(journal, {}, "q", {
        apiKey: key,
        fetch: async () => Response.json({ content: [] }),
      }),
    ).rejects.toThrow("未返回");
    expect(
      journal.events.filter((e) => e.type === "attempt.finished"),
    ).toHaveLength(2);
  } finally {
    await journal.close();
  }
});

test("directory failures and cancelled reads are not empty listings", async () => {
  const root = await temporary();
  await expect(listFiles(root, "missing")).rejects.toThrow("不存在");
  await expect(
    listFiles(root, ".", false, undefined, AbortSignal.abort()),
  ).rejects.toThrow();
  await writeFile(join(root, "file"), "");
  await expect(listFiles(root, "file")).rejects.toThrow("目录");
  const service = new WorkspaceFiles(root, async () => {
    throw new Error("no desktop");
  });
  await expect(service.open("file")).rejects.toThrow("no desktop");
});

test("directory aliases keep logical paths and reject ancestor cycles", async () => {
  const root = await temporary();
  await mkdir(join(root, "real"));
  await writeFile(join(root, "real", "file.txt"), "ok");
  await symlink(".", join(root, "loop"), "dir");
  await symlink("real", join(root, "alias"), "dir");
  await symlink("..", join(root, "real", "back"), "dir");
  const top = await listFiles(root);
  expect(top.entries.find(e => e.name === "loop")?.type).toBe("unavailable");
  expect(top.entries.find(e => e.name === "alias")?.type).toBe("directory");
  const alias = await listFiles(root, "alias");
  expect(alias.entries).toContainEqual({ name: "file.txt", path: "alias/file.txt", type: "file" });
  expect(alias.entries).toContainEqual({ name: "back", path: "alias/back", type: "unavailable" });
  await expect(listFiles(root, "loop")).rejects.toMatchObject({ code: "directory_cycle" });
  await expect(listFiles(root, "alias/back")).rejects.toMatchObject({ code: "directory_cycle" });
  expect(await workspacePath(root, "alias/file.txt")).toBe(await realpath(join(root, "real/file.txt")));
});


test("change sequence cursors remain stable when new results arrive", () => {
  const events = Array.from({ length: 120 }, (_, i) => ({
    type: "tool.result", eventId: `event-${i + 1}`, seq: i + 1,
    payload: { source: "tool:write", details: { path: "file.txt" } },
  })) as JournalEvent[];
  const first = fileChangesPage(events);
  expect(first.changes.map(c => c.seq)).toEqual(Array.from({ length: 50 }, (_, i) => 120 - i));
  const later = [...events, ...Array.from({ length: 60 }, (_, i) => ({
    ...events[0]!, eventId: `event-${121 + i}`, seq: 121 + i,
  }))];
  const older = fileChangesPage(later, first.nextBefore);
  expect(older.changes.map(c => c.seq)).toEqual(Array.from({ length: 50 }, (_, i) => 70 - i));
  const fresh = fileChangesPage(later, undefined, 120);
  expect(fresh.changes).toHaveLength(50);
  const rest = fileChangesPage(later, fresh.nextBefore, 120);
  expect(rest.changes.map(c => c.seq)).toEqual(Array.from({ length: 10 }, (_, i) => 130 - i));
  expect(rest.nextBefore).toBeUndefined();
});
