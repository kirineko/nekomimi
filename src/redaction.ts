/** Byte-preserving redaction with a bounded suffix retained across stream chunks. */
export class StreamRedactor {
  private pending: Buffer = Buffer.alloc(0);
  private secrets: Buffer[];
  constructor(secrets: string[]) {
    this.secrets = [...new Set(secrets.filter(Boolean))]
      .map((s) => Buffer.from(s))
      .sort((a, b) => b.length - a.length);
  }
  push(chunk: Uint8Array, final = false) {
    const data = Buffer.concat([this.pending, chunk]);
    // Hold only suffixes that could actually become a credential. Holding a
    // fixed tail would delay complete SSE frames until another chunk or EOF.
    let keep = 0;
    if (!final) {
      for (const secret of this.secrets) {
        for (
          let size = Math.min(data.length, secret.length - 1);
          size > keep;
          size--
        ) {
          if (data.subarray(data.length - size).equals(secret.subarray(0, size))) {
            keep = size;
            break;
          }
        }
      }
    }
    const boundary = data.length - keep;
    const parts: Buffer[] = [];
    let position = 0;
    let redacted = false;
    while (position < boundary) {
      let next = boundary;
      let match: Buffer | undefined;
      for (const secret of this.secrets) {
        const index = data.indexOf(secret, position);
        if (index >= 0 && index < next) {
          next = index;
          match = secret;
        }
      }
      parts.push(data.subarray(position, next));
      position = next;
      if (match) {
        parts.push(Buffer.from("[REDACTED]"));
        position += match.length;
        redacted = true;
      }
    }
    this.pending = Buffer.from(data.subarray(position));
    return { bytes: Buffer.concat(parts), redacted };
  }
}
