import { it, expect } from "vitest";
import { join } from "node:path";
import { Journal, hash } from "../src/journal.js";
import { JournalReader } from "../src/server/journal-reader.js";
import { SessionProjection } from "../src/projection/session.js";
import { temporary } from "./helpers.js";
it("incrementally reads durable records, ignoring tentative tail until flush", async () => {
  const dir = await temporary();
  const j = await Journal.open(dir);
  try {
    await j.append("start", {});
    const reader = new JournalReader(j.directory);
    await reader.refresh();
    expect(reader.events).toHaveLength(1);
    await j.append("stream", {}, {}, false);
    await reader.refresh();
    expect(reader.events).toHaveLength(1);
    await j.flush();
    await reader.refresh();
    expect(reader.events).toHaveLength(2);
    await reader.refresh();
    expect(reader.events).toHaveLength(2);
    expect(reader.matches(1, reader.events[0]!.hash)).toBe(true);
    expect(reader.matches(2, "wrong")).toBe(false);
  } finally {
    await j.close();
  }
});
it("rebuilds chunk-split display and retains unknown raw evidence", async () => {
  const dir = await temporary();
  const j = await Journal.open(dir);
  try {
    const links = { runId: "r", modelCallId: "m", attemptId: "a" };
    await j.append("attempt.started", { attempt: 1, model: "fixture" }, links);
    const raw =
      'data: {"type":"future","x":1}\n\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n';
    for (const data of [raw.slice(0, 25), raw.slice(25)])
      await j.append(
        "response.chunk",
        { artifact: await j.artifact(data) },
        links,
      );
    const a = new SessionProjection(j.directory);
    await a.update(j.events);
    await a.update(j.events);
    expect([...a.rows.values()].find((r) => r.kind === "assistant")?.text).toBe(
      "hello",
    );
    const b = new SessionProjection(j.directory);
    await b.update(j.events);
    expect([...b.rows.values()]).toEqual([...a.rows.values()]);
  } finally {
    await j.close();
  }
});
it("pages a long timeline without sending the entire history", async () => {
  const dir = await temporary();
  const j = await Journal.open(dir);
  try {
    for (let i = 0; i < 250; i++)
      await j.append(
        "context.add",
        {
          source: "user",
          item: {
            role: "user",
            content: [{ type: "input_text", text: `item ${i}` }],
          },
        },
        {},
        false,
      );
    await j.flush();
    const projection = new SessionProjection(j.directory);
    await projection.update(j.events);
    const page = projection.page();
    expect(page.rows).toHaveLength(60);
    expect(page.before).toBe(190);
    expect(projection.page(page.before).rows[0]?.text).toBe("item 130");
  } finally {
    await j.close();
  }
});
