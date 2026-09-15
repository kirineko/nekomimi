import { useEffect, useState } from "react";
import type { EvidenceRef } from "../../shared/protocol";
import { api } from "../api";
interface Page {
  encoding: string;
  text: string;
  offset: number;
  next?: number;
  bytes: number;
}
export function Artifact({
  sessionId,
  reference,
  onSource,
}: {
  sessionId: string;
  reference: EvidenceRef;
  onSource?: (seq: number) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  useEffect(() => {
    setOffset(0);
  }, [reference.sha256]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setPage(undefined);
    void api<Page>(
      `/sessions/${sessionId}/artifacts/${reference.sha256}?offset=${offset}`,
      undefined,
      abort.signal,
    )
      .then(setPage)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [sessionId, reference.sha256, offset]);
  return (
    <section className="artifact">
      <div className="eyebrow">
        {reference.bytes.toLocaleString()} bytes · {page?.encoding ?? "utf8"}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <pre>{page ? formatEvidence(page.text) : error ? "" : "加载…"}</pre>
      <div className="pager">
        <button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 16384))}
        >
          上一段
        </button>
        <span>
          {offset} / {page?.bytes ?? reference.bytes} bytes
        </span>
        <button
          disabled={page?.next === undefined}
          onClick={() => setOffset(page!.next!)}
        >
          下一段
        </button>
      </div>
    </section>
  );
}
export function references(value: unknown): EvidenceRef[] {
  if (!value || typeof value !== "object") return [];
  if ("kind" in value && value.kind === "artifact")
    return [value as EvidenceRef];
  return Object.values(value).flatMap(references);
}

function formatEvidence(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
