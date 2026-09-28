import { it, expect, vi } from "vitest";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Sessions } from "../src/server/sessions.js";
import { SessionProjection } from "../src/projection/session.js";
import { Journal, type JournalEvent } from "../src/journal.js";
import { temporary } from "./helpers.js";
import { sessionTime } from "../src/web/session-time.js";
import { commandWord, completeCommand, matchingCommands } from "../src/web/command-input.js";

it("derives activity from task boundaries without changing journal evidence", async () => {
  const dir = await temporary(), j = await Journal.open(dir);
  try {
    for (const type of ["session.created", "command.accepted", "run.started", "run.finished", "session.title", "response.chunk"]) await j.append(type, {});
    const before = await readFile(join(dir, "journal.jsonl"), "utf8");
    const p = new SessionProjection(dir);
    expect(p.info("s", j.events).activityAt).toBe(j.events[3]!.timestamp);
    expect(p.info("s", j.events).updatedAt).toBe(j.events.at(-1)!.timestamp);
    expect(p.info("s", []).activityAt).toBeNull();
    const old = [{ type: "run.started", timestamp: "2020-01-01T00:00:00Z", payload: {} }, { type: "run.finished", timestamp: "bad", payload: {} }] as JournalEvent[];
    expect(p.info("s", old).activityAt).toBe("2020-01-01T00:00:00.000Z");
    expect(await readFile(join(dir, "journal.jsonl"), "utf8")).toBe(before);
  } finally { await j.close(); }
});
it("sorts before pagination and rejects changed versions while ignoring corrupt directories", async () => {
  const service = await Sessions.open({ workspace: await temporary(), home: await temporary(), naming: false });
  try {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
    const ids: string[] = [];
    for (let i = 0; i < 35; i++) ids.push((await service.create(`session ${i}`)).id);
    await mkdir(join(service.root, "broken"));
    const first = await service.list(0, 10);
    const second = await service.list(10, 25, first.listRevision);
    expect([...first.sessions, ...second.sessions].map(s => s.id)).toEqual(ids.sort());
    expect(second.next).toBeUndefined();
    expect((await service.list(10, 25)).sessions).toEqual(second.sessions);
    const continued = ids[34]!;
    vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
    const j = await Journal.open(join(service.root, continued));
    await j.append("command.accepted", { commandId: "continued" }); await j.close();
    await expect(service.list(10, 25, first.listRevision)).rejects.toMatchObject({ code: "list_changed" });
    const changed = await service.list(0, 10);
    expect(changed.sessions[0]!.id).toBe(continued);
    const renamed = await Journal.open(join(service.root, ids[0]!));
    await renamed.append("session.title", { title: "renamed" });
    // A missing stream artifact must not be opened by the metadata-only list path.
    await renamed.append("response.chunk", { artifact: { kind: "artifact", sha256: "a".repeat(64), bytes: 10 } });
    await renamed.close();
    expect((await service.list(0, 10)).listRevision).toBe(changed.listRevision);
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    const added = await service.create("newest");
    expect((await service.list(0, 1)).sessions[0]!.id).toBe(added.id);
    await expect(service.list(10, 25, changed.listRevision)).rejects.toMatchObject({ code: "list_changed" });
    const beforeDelete = await service.list(0, 10);
    await service.remove(added.id);
    await expect(service.list(10, 25, beforeDelete.listRevision)).rejects.toMatchObject({ code: "list_changed" });
  } finally { vi.useRealTimers(); await service.close(); }
});
it("uses local calendar groups, including midnight and unknown dates", () => {
  const now = new Date(2026, 8, 28, 12).getTime();
  const at = (day: number) => new Date(2026, 8, day, 11).toISOString();
  expect([28,27,26,22,21].map(d => sessionTime(at(d), now).group)).toEqual(["今天", "昨天", "近 7 天", "近 7 天", "更早"]);
  expect(sessionTime(at(28), new Date(2026,8,29,0).getTime()).group).toBe("昨天");
  expect(sessionTime(null, now).group).toBe("时间未知");
  expect(sessionTime(at(28), now).full).toContain("2026");
});
it("completes only the command word, preserves arguments and rejects paths", () => {
  expect(commandWord("/", 1)).toBe("/");
  expect(commandWord("/mo arg", 3)).toBe("/mo");
  for (const [text, pos] of [["hello /mo", 9], ["/tmp/file", 4], ["/mo arg/path", 9]] as const) expect(commandWord(text, pos)).toBeUndefined();
  expect(completeCommand('/mo {"x":1}', "/moe")).toEqual({ text: '/moe {"x":1}', caret: 5 });
  expect(completeCommand("/mo", "/moe").text).toBe("/moe ");
  const commands = [{ id:"a",kind:"extension" as const,name:"/moe",insertText:"/moe",description:"猫咪",source:"test" }];
  expect(matchingCommands(commands,"/猫")).toHaveLength(1);
  expect(matchingCommands(commands,"/none")).toHaveLength(0);
});
