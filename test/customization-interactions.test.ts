import { it, expect, vi } from "vitest";
import { basename, join } from "node:path";
import { temporary } from "./helpers.js";
import { Journal } from "../src/journal.js";
import { Interactions } from "../src/customization/interactions.js";
it("rejects stale interaction answers after cancellation and timeout without defaults", async () => {
  const journal = await Journal.open(join(await temporary(), "session"));
  const interactions = new Interactions();
  const signal = new AbortController();
  try {
    const pending = interactions.ask(
      journal,
      "run",
      "ext",
      {
        kind: "form",
        title: "Input",
        fields: [{ name: "value", label: "Value", required: true }],
      },
      signal.signal,
    );
    const rejection = expect(pending).rejects.toThrow("cancelled");
    while (!interactions.list(basename(journal.directory)).length)
      await new Promise((r) => setTimeout(r, 5));
    const id = interactions.list(basename(journal.directory))[0]!.id;
    signal.abort();
    await rejection;
    await expect(
      interactions.answer(basename(journal.directory), id, "late", {
        value: "late",
      }),
    ).rejects.toThrow("交互已结束");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const timeout = interactions.ask(
      journal,
      "run",
      "ext",
      {
        kind: "form",
        title: "Timeout",
        fields: [{ name: "value", label: "Value" }],
      },
      new AbortController().signal,
    );
    const rejected = expect(timeout).rejects.toThrow("timed out");
    // Journal IO remains real; allow the durable open to finish before advancing the UI timer.
    while (!interactions.list(basename(journal.directory)).length)
      await new Promise<void>((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(300001);
    await rejected;
    expect(
      journal.events.filter((e) => e.type === "interaction.cancelled"),
    ).toHaveLength(2);
    expect(journal.events.some((e) => e.type === "interaction.answered")).toBe(
      false,
    );
  } finally {
    vi.useRealTimers();
    await journal.close();
  }
});
