import { artifactSyntax } from "../presentation/syntax/artifact.js";
import { fileLanguage } from "../presentation/syntax/types.js";
import { colorDiff } from "../presentation/syntax/diff.js";
import { readArtifact, type JournalEvent } from "../journal.js";
import { diffPage } from "../presentation/diff.js";
import { ApiError } from "../shared/protocol.js";
import type { Entry } from "./sessions.js";
export function fileChanges(events: JournalEvent[]) {
  return events
    .filter(
      (e) =>
        e.type === "tool.result" &&
        ["tool:write", "tool:edit"].includes((e.payload as any).source),
    )
    .map((e) => {
      const d = (e.payload as any).details;
      return {
        id: e.eventId,
        seq: e.seq,
        runId: e.runId,
        toolCallId: e.toolCallId,
        path: typeof d?.path === "string" ? d.path : "路径未记录",
        patch: d?.patch,
        before: d?.before,
        after: d?.after,
        created: !d?.before,
      };
    });
}
export function fileChangesPage(
  events: JournalEvent[],
  before = Number.MAX_SAFE_INTEGER,
  after = 0,
  offset = 0,
) {
  const all = fileChanges(events).reverse().filter(c => c.seq < before && c.seq > after);
  const changes = all.slice(offset, offset + 50);
  const hasMore = offset + 50 < all.length;
  return {
    changes,
    next: hasMore ? offset + 50 : undefined,
    nextBefore: hasMore ? changes.at(-1)!.seq : undefined,
  };
}
export async function changeDiff(
  entry: Entry,
  digest: string,
  offset: number,
  limit: number,
) {
  const change = fileChanges(entry.reader.events).find(
    (c) => c.patch?.sha256 === digest,
  );
  if (!change) throw new ApiError(404, "diff", "未找到已确认的文件修改证据");
  try {
    if (change.patch.redacted)
      throw new Error("diff 证据已脱敏，仅提供原始附件");
    const text = new TextDecoder("utf8", { fatal: true }).decode(
      await readArtifact(entry.directory, change.patch),
    );
    const page=diffPage(text, offset, limit);
    const language=fileLanguage(change.path);
    const [before,after]=await Promise.all([
      artifactSyntax(entry.directory,change.before,language),
      artifactSyntax(entry.directory,change.after,language),
    ]);
    return colorDiff(page,before,after);
  } catch (e) {
    return {
      lines: [],
      total: 0,
      added: 0,
      removed: 0,
      offset: 0,
      unavailable: String(e),
    };
  }
}
