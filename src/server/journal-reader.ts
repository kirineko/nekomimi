import { open, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { hash, type JournalEvent } from "../journal.js";
/** Incremental durable reader. Index rebuilds after recovery; unchanged polls read only the watermark. */
export class JournalReader {
  events: JournalEvent[] = [];
  private offset = 0;
  private identity = "";
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  refresh(): Promise<void> {
    const next = this.tail.then(() => this.update());
    this.tail = next.catch(() => {});
    return next;
  }
  private async update() {
    const path = join(this.directory, "journal.jsonl");
    if (
      (await realpath(path)) !== path ||
      (await realpath(join(this.directory, "durable.json"))) !==
        join(this.directory, "durable.json")
    )
      throw new Error("Journal symlink rejected");
    const mark = JSON.parse(
      await readFile(join(this.directory, "durable.json"), "utf8"),
    ) as { seq: number; hash: string };
    if (
      !Number.isSafeInteger(mark.seq) ||
      mark.seq < 0 ||
      typeof mark.hash !== "string"
    )
      throw new Error("Invalid durable watermark");
    const info = await stat(path);
    const identity = `${info.dev}:${info.ino}`;
    if (
      this.identity !== identity ||
      info.size < this.offset ||
      mark.seq < this.events.length ||
      (mark.seq === this.events.length &&
        mark.hash !== (this.events.at(-1)?.hash ?? ""))
    ) {
      this.events = [];
      this.offset = 0;
    }
    this.identity = identity;
    if (mark.seq === this.events.length) return;
    const file = await open(path, "r");
    let position = this.offset;
    let pending = Buffer.alloc(0);
    const added: JournalEvent[] = [];
    let previous = this.events.at(-1)?.hash ?? "";
    try {
      while (this.events.length + added.length < mark.seq) {
        const buffer = Buffer.alloc(65536);
        const { bytesRead } = await file.read(
          buffer,
          0,
          buffer.length,
          position,
        );
        if (!bytesRead)
          throw new Error("Journal ended before durable watermark");
        position += bytesRead;
        pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
        let end: number;
        while (
          (end = pending.indexOf(10)) >= 0 &&
          this.events.length + added.length < mark.seq
        ) {
          const line = pending.subarray(0, end);
          const event = JSON.parse(line.toString("utf8")) as JournalEvent;
          const { hash: digest, ...body } = event;
          const first = this.events[0] ?? added[0];
          if (
            event.schemaVersion !== 1 ||
            event.seq !== this.events.length + added.length + 1 ||
            event.previousHash !== previous ||
            hash(JSON.stringify(body)) !== digest ||
            (first && first.sessionId !== event.sessionId)
          )
            throw new Error("Invalid journal chain");
          added.push(event);
          previous = digest;
          pending = pending.subarray(end + 1);
        }
        if (pending.length > 64 * 1024 * 1024)
          throw new Error("Journal record exceeds read limit");
      }
      if (previous !== mark.hash)
        throw new Error("Invalid durable watermark hash");
      this.events.push(...added);
      this.offset = position - pending.length;
    } finally {
      await file.close();
    }
  }
  get cursor() {
    return { seq: this.events.length, hash: this.events.at(-1)?.hash ?? "" };
  }
  matches(seq: number, digest: string) {
    return (
      seq <= this.events.length &&
      seq >= 0 &&
      (this.events[seq - 1]?.hash ?? "") === digest
    );
  }
}
