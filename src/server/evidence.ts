import { mkdtemp, readFile, rm, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { artifactRefs, type Artifact } from "../journal.js";
import { exportSession } from "../export.js";
import { ApiError } from "../shared/protocol.js";
import type { Entry } from "./sessions.js";
export async function artifactPage(
  entry: Entry,
  digest: string,
  offset: number,
  limit: number,
) {
  const ref = entry.reader.events
    .flatMap((e) => artifactRefs(e.payload))
    .find((r) => r.sha256 === digest);
  if (!ref || !/^[a-f0-9]{64}$/.test(digest))
    throw new ApiError(404, "artifact", "当前会话未引用此附件");
  const path = join(entry.directory, "artifacts", digest);
  if ((await realpath(path)) !== path)
    throw new ApiError(403, "artifact", "附件链接无效");
  const file = await open(path, "r");
  try {
    const hash = createHash("sha256");
    let count = 0;
    const buffer = Buffer.alloc(65536);
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, count);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      count += bytesRead;
    }
    if (count !== ref.bytes || hash.digest("hex") !== digest)
      throw new ApiError(409, "integrity", "附件完整性检查失败");
    if (offset > count)
      throw new ApiError(400, "offset", "附件读取位置超出范围");
    let bytes = Buffer.alloc(Math.min(limit, count - offset));
    await file.read(bytes, 0, bytes.length, offset);
    let text = "";
    let encoding = "utf8";
    let decoded = false;
    // Keep a valid UTF-8 continuation boundary; binary evidence is explicitly base64.
    for (let trim = 0; trim <= Math.min(3, bytes.length - 1); trim++) {
      try {
        text = new TextDecoder("utf8", { fatal: true }).decode(
          bytes.subarray(0, bytes.length - trim),
        );
        bytes = bytes.subarray(0, bytes.length - trim);
        decoded = true;
        break;
      } catch {}
    }
    if (!decoded && bytes.length) {
      text = bytes.toString("base64");
      encoding = "base64";
    }
    return {
      sha256: digest,
      bytes: count,
      offset,
      next: offset + bytes.length < count ? offset + bytes.length : undefined,
      text,
      encoding,
      redacted: ref.redacted ?? false,
    };
  } finally {
    await file.close();
  }
}
export async function prepareDownload(
  entry: Entry,
  format: string,
  redact: string[],
) {
  if (!["html", "bundle"].includes(format))
    throw new ApiError(400, "format", "未知导出格式");
  const directory = await mkdtemp(join(tmpdir(), "harness-download-"));
  try {
    const output = join(
      directory,
      format === "html" ? "session.html" : "bundle",
    );
    await exportSession(entry.directory, {
      format: format as "html" | "bundle",
      output,
      redact,
    });
    if (format === "html")
      return {
        file: output,
        directory,
        type: "text/html; charset=utf-8",
        name: "session.html",
      };
    // tar packages an existing verified bundle; no shell interpolation or source paths from clients.
    const archive = join(directory, "session.tar");
    await promisify(execFile)("tar", ["-cf", archive, "-C", output, "."]);
    return {
      file: archive,
      directory,
      type: "application/x-tar",
      name: "session.tar",
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Context navigation stays usable even when the raw manifest exceeds one artifact page. */
export async function contextPage(
  entry: Entry,
  callId: string,
  offset: number,
) {
  const event = entry.reader.events.find(
    (e) => e.type === "context.view" && e.modelCallId === callId,
  );
  const ref = event && artifactRefs(event.payload)[0];
  if (!ref) throw new ApiError(404, "context", "上下文证据不存在");
  const { readArtifact } = await import("../journal.js");
  const view = JSON.parse(
    (await readArtifact(entry.directory, ref)).toString("utf8"),
  );
  const nodes = Array.isArray(view.nodes) ? view.nodes : [];
  return {
    revision: view.revision,
    artifact: ref,
    fragments: view.prompt?.fragments ?? [],
    nodes: nodes.slice(offset, offset + 40).map((n: any) => ({
      item: n.item,
      seq: n.seq,
      itemIndex: n.itemIndex,
      source: n.source,
      hash: n.hash,
      eventId: n.eventId,
    })),
    next: offset + 40 < nodes.length ? offset + 40 : undefined,
  };
}

/** A bounded display projection; abandoned operations are never presented as still running. */
export function tracePage(
  entry: Entry,
  runId: string,
  offset: number,
  activeRunId?: string,
) {
  const rows = [...entry.projection.rows.values()].filter(
    (row) => row.runId === runId,
  );
  return {
    rows: rows
      .slice(offset, offset + 40)
      .map((row) =>
        row.status === "running" && activeRunId !== runId
          ? {
              ...row,
              status: "interrupted",
              text:
                row.kind === "tool"
                  ? row.text + "\n\n执行已中断，结果未知；请检查工作区。"
                  : row.text,
            }
          : row,
      ),
    total: rows.length,
    next: offset + 40 < rows.length ? offset + 40 : undefined,
  };
}
