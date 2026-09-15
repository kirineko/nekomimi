import { parsePatch } from "diff";
import type { SyntaxToken } from "./syntax/types.js";
export interface DiffLine {
  tokens?: SyntaxToken[];
  kind: "add" | "del" | "context" | "header";
  text: string;
  truncated?: boolean;
  old?: number;
  next?: number;
}
export interface DiffPage {
  lines: DiffLine[];
  added: number;
  removed: number;
  total: number;
  offset: number;
  next?: number;
  unavailable?: string;
}
export function diffPage(text: string, offset = 0, limit = 120): DiffPage {
  const patches = parsePatch(text);
  if (patches.length !== 1 || !text.includes("--- ") || !text.includes("+++ "))
    throw new Error("diff 证据格式无效");
  const lines: DiffLine[] = [];
  let total = 0,
    added = 0,
    removed = 0;
  const take = (row: DiffLine) => {
    if (total >= offset && lines.length < limit)
      lines.push(
        row.text.length > 4000
          ? { ...row, text: row.text.slice(0, 4000), truncated: true }
          : row,
      );
    total++;
  };
  for (const h of patches[0]!.hunks) {
    take({
      kind: "header",
      text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    });
    let old = h.oldStart,
      next = h.newStart;
    for (const line of h.lines) {
      if (line.startsWith("+")) {
        added++;
        take({ kind: "add", text: line.slice(1), next: next++ });
      } else if (line.startsWith("-")) {
        removed++;
        take({ kind: "del", text: line.slice(1), old: old++ });
      } else if (line.startsWith(" "))
        take({
          kind: "context",
          text: line.slice(1),
          old: old++,
          next: next++,
        });
      else if (line.startsWith("\\")) take({ kind: "header", text: line });
      else throw new Error("diff 行格式无效");
    }
    if (old - h.oldStart !== h.oldLines || next - h.newStart !== h.newLines)
      throw new Error("diff 行数不完整");
  }
  return {
    lines,
    total,
    added,
    removed,
    offset,
    next: offset + lines.length < total ? offset + lines.length : undefined,
  };
}
