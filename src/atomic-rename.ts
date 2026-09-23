import { rename } from "node:fs/promises";

/** Replace atomically without ever unlinking the previous durable value. */
export async function atomicRename(source: string, target: string, platform = process.platform): Promise<void> {
  const deadline = performance.now() + 2000;
  let backoff = 10;
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const remaining = deadline - performance.now();
      // Windows readers/scanners can briefly deny replacement of an existing file.
      // Retry only the rename of the already-synced temporary file, never its writer.
      if (platform !== "win32" || attempt >= 20 || remaining <= 0 ||
          !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(backoff, remaining)));
      backoff = Math.min(backoff * 2, 100);
    }
  }
}
