import { Journal, id, type JournalOptions } from "../journal.js";
import { ResponsesProvider, type ProviderOptions } from "../provider.js";
import { hash } from "../journal.js";
export async function nameSession(
  directory: string,
  settings: ProviderOptions,
  signal: AbortSignal,
  journalOptions: JournalOptions = {},
) {
  const journal = await Journal.open(directory, { ...journalOptions, secrets: [settings.apiKey] });
  const runId = journalOptions.diagnosticRunId ?? id();
  try {
    if (journal.events.some((e) => e.type === "session.naming.started")) return;
    const runs = journal.events.filter((e) => e.type === "run.finished");
    if (runs.length !== 1 || (runs[0]!.payload as any).status !== "completed")
      return;
    const first = journal.events.find(
      (e) => e.type === "context.add" && (e.payload as any).source === "user",
    );
    if (!first) return;
    await journal.append(
      "session.naming.started",
      { purpose: "session-title" },
      { runId },
    );
    const original = (first.payload as any).item;
    const text =
      typeof original.content === "string"
        ? original.content
        : original.content?.map((c: any) => c.text ?? "").join(" ");
    const limited = Buffer.from(String(text))
      .subarray(0, 4096)
      .toString("utf8");
    const fragment = {
      source: "nekomimi:session-title:v1",
      text: "Name this conversation in the language of the user. Return only a short title, at most 16 CJK characters or 8 words. No quotes, explanation, or tools.",
    };
    const provider = new ResponsesProvider(
      journal,
      { runId },
      {
        text: fragment.text,
        fragments: [{ ...fragment, hash: hash(fragment.text) }],
        schemas: [],
      },
      {
        ...settings,
        purpose: "session-title",
        contextEvents: [
          {
            ...first,
            payload: {
              source: "user",
              item: { role: "user", content: limited },
            },
          },
        ],
        maxOutputTokens: 64,
        maxAttempts: 1,
        timeoutMs: 10000,
      },
    );
    const result = await (
      await provider.stream(provider.model, { messages: [] }, { signal })
    ).result();
    signal.throwIfAborted();
    const title = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "");
    if (
      result.stopReason !== "stop" ||
      !title ||
      /[\r\n]/.test(title) ||
      (title.match(/[\u3400-\u9fff]/g)?.length ?? 0) > 16 ||
      title.split(/\s+/).length > 8 ||
      title.length > 100
    )
      throw new Error("命名未返回有效短标题");
    await journal.append(
      "session.title",
      { title, source: "model", purpose: "session-title" },
      { runId },
    );
    await journal.append(
      "session.naming.finished",
      { status: "completed" },
      { runId },
    );
  } catch (e) {
    await journal.append(
      "session.naming.finished",
      {
        status: signal.aborted ? "cancelled" : "failed",
        error: journal.clean(String(e)),
      },
      { runId },
    );
  } finally {
    await journal.close();
  }
}
