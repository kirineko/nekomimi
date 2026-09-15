import { renderSessionHtml } from "./export/html.js";
import { readFile, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  artifactRefs,
  readArtifact,
  readSession,
  hash,
  atomicFile,
  type SessionSnapshot,
} from "./journal.js";
export interface BundleManifest {
  schemaVersion: 1;
  kind: "harness-bundle";
  redacted: boolean;
  resumable: boolean;
  files: { path: string; sha256: string; bytes: number }[];
}
export interface ExportOptions {
  format: "html" | "bundle";
  output: string;
  redact?: string[];
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function redactor(values: string[] = []) {
  return (text: string) => {
    for (const value of values)
      if (value) text = text.split(value).join("[REDACTED]");
    return text
      .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+/g, "Bearer [REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
  };
}
async function evidence(snapshot: SessionSnapshot) {
  const artifacts = new Map<string, Buffer>();
  for (const event of snapshot.events.slice(0, snapshot.durableSeq))
    for (const ref of artifactRefs(event.payload)) {
      if (!artifacts.has(ref.sha256))
        artifacts.set(ref.sha256, await readArtifact(snapshot.directory, ref));
    }
  return artifacts;
}
export async function exportSession(
  directory: string,
  options: ExportOptions,
): Promise<string> {
  const snapshot = await readSession(directory);
  const artifacts = await evidence(snapshot);
  const redact = redactor(options.redact);
  const output = resolve(options.output);
  if (options.format === "html") {
    const html = await renderSessionHtml(snapshot, artifacts, redact);
    await atomicFile(output, html);
    return output;
  }
  await mkdir(output, { recursive: false, mode: 0o700 });
  const manifest: BundleManifest = {
    schemaVersion: 1,
    kind: "harness-bundle",
    redacted: !!options.redact?.length,
    resumable:
      !options.redact?.length &&
      !snapshot.tornBytes &&
      !snapshot.tentativeEvents,
    files: [],
  };
  const save = async (path: string, bytes: Buffer) => {
    await atomicFile(join(output, path), bytes);
    manifest.files.push({ path, sha256: hash(bytes), bytes: bytes.length });
  };
  if (manifest.redacted) {
    const view = {
      redacted: true,
      resumable: false,
      events: JSON.parse(redact(JSON.stringify(snapshot.events))),
      pending: snapshot.pending,
      artifacts: Object.fromEntries(
        [...artifacts].map(([key, data]) => [
          key,
          redact(data.toString("utf8")),
        ]),
      ),
    };
    const bytes = Buffer.from(JSON.stringify(view, null, 2));
    await atomicFile(join(output, "view.json"), bytes);
    manifest.files = [
      { path: "view.json", sha256: hash(bytes), bytes: bytes.length },
    ];
  } else {
    const serialized = snapshot.events
      .map((e) => JSON.stringify(e) + "\n")
      .join("");
    // Keep the original torn tail for diagnostics, but ensure the source did not change while exporting.
    const raw = await readFile(join(snapshot.directory, "journal.jsonl"));
    if (
      !raw
        .subarray(0, Buffer.byteLength(serialized))
        .equals(Buffer.from(serialized)) ||
      raw.length !== Buffer.byteLength(serialized) + snapshot.tornBytes
    )
      throw new Error("Session changed during export; retry");
    await save("journal.jsonl", raw);
    await save(
      "durable.json",
      Buffer.from(
        JSON.stringify({
          seq: snapshot.durableSeq,
          hash: snapshot.events[snapshot.durableSeq - 1]?.hash ?? "",
        }),
      ),
    );
    await mkdir(join(output, "artifacts"));
    for (const [digest, bytes] of artifacts)
      await save(`artifacts/${digest}`, bytes);
  }
  await atomicFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return output;
}
export async function inspectBundle(
  directory: string,
): Promise<{
  manifest: BundleManifest;
  snapshot?: SessionSnapshot;
  view?: unknown;
}> {
  directory = await realpath(directory);
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as BundleManifest;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "harness-bundle" ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Unsupported bundle manifest");
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (
      !/^(journal\.jsonl|durable\.json|view\.json|artifacts\/[a-f0-9]{64})$/.test(
        file.path,
      ) ||
      names.has(file.path)
    )
      throw new Error("Unsafe or duplicate bundle path");
    names.add(file.path);
    const path = join(directory, file.path);
    if ((await realpath(path)) !== path)
      throw new Error("Bundle symlink rejected");
    const bytes = await readFile(path);
    if (hash(bytes) !== file.sha256 || bytes.length !== file.bytes)
      throw new Error(`Bundle integrity mismatch: ${file.path}`);
  }
  if (manifest.redacted) {
    if (manifest.resumable || !names.has("view.json"))
      throw new Error("Invalid redacted bundle");
    return {
      manifest,
      view: JSON.parse(await readFile(join(directory, "view.json"), "utf8")),
    };
  }
  if (!names.has("journal.jsonl") || !names.has("durable.json"))
    throw new Error("Bundle is missing its journal or watermark");
  const snapshot = await readSession(directory);
  for (const e of snapshot.events.slice(0, snapshot.durableSeq))
    for (const ref of artifactRefs(e.payload))
      if (!names.has(`artifacts/${ref.sha256}`))
        throw new Error("Bundle manifest omits a referenced artifact");
  if (manifest.resumable && (snapshot.tornBytes || snapshot.tentativeEvents))
    throw new Error("Incomplete bundle cannot claim resumability");
  return { manifest, snapshot };
}
export async function importBundle(
  source: string,
  destination: string,
): Promise<string> {
  const { manifest } = await inspectBundle(source);
  if (!manifest.resumable)
    throw new Error(
      "This bundle is not resumable; use inspect for the diagnostic view",
    );
  destination = resolve(destination);
  await mkdir(destination, { recursive: false, mode: 0o700 });
  await mkdir(join(destination, "artifacts"));
  for (const file of manifest.files) {
    const bytes = await readFile(join(source, file.path));
    if (hash(bytes) !== file.sha256 || bytes.length !== file.bytes)
      throw new Error("Bundle changed during import");
    await atomicFile(join(destination, file.path), bytes);
  }
  await readSession(destination);
  return destination;
}
