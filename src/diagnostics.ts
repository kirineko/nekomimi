import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Diagnostic } from "./shared/protocol.js";

/** Stage names describe operations, never file contents or user supplied paths. */
export class OperationError extends Error {
  readonly code?: string;
  readonly syscall?: string;
  constructor(readonly operation: string, readonly original: unknown) {
    super(`Operation failed: ${operation}: ${original instanceof Error ? original.message : String(original)}`, { cause: original });
    this.code = (original as NodeJS.ErrnoException | undefined)?.code;
    this.syscall = (original as NodeJS.ErrnoException | undefined)?.syscall;
  }
}
export async function observeIO<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) { throw error instanceof OperationError ? error : new OperationError(operation, error); }
}
const safeCode = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : undefined;
export function diagnostic(error: unknown, context: Pick<Diagnostic, "sessionId" | "runId" | "attemptId" | "seq" | "durableSeq">, operation = "background.run"): Diagnostic {
  const source = (error instanceof OperationError ? error.original : error) as NodeJS.ErrnoException | undefined;
  // Do not serialize arbitrary Error messages/stacks: providers may embed request bodies or credentials.
  return {
    version: 1, id: randomUUID(), timestamp: new Date().toISOString(),
    ...context, operation: error instanceof OperationError ? error.operation : operation,
    code: safeCode(source?.code), syscall: safeCode(source?.syscall),
    platform: process.platform, nodeVersion: process.version,
    category: error instanceof OperationError ? "storage" : "background",
  };
}
function stderr(value: unknown) {
  try { process.stderr.write(JSON.stringify(value) + "\n"); } catch { /* preserve original failure */ }
}
export async function saveDiagnostic(directory: string, value: Diagnostic): Promise<void> {
  stderr({ nekomimiDiagnostic: value });
  try {
    const folder = join(directory, "diagnostics");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    if ((await lstat(folder)).isSymbolicLink()) throw new Error("Diagnostic directory symlink rejected");
    await writeFile(join(folder, value.id + ".json"), JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    stderr({ nekomimiDiagnosticWriteFailed: value.id, code: safeCode((error as NodeJS.ErrnoException).code) });
  }
}
export async function readDiagnostics(directory: string): Promise<Diagnostic[]> {
  const folder = join(directory, "diagnostics");
  try {
    if ((await lstat(folder)).isSymbolicLink()) return [];
    const names = (await readdir(folder)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    const values: Diagnostic[] = [];
    for (const name of names.slice(-1000)) {
      const path = join(folder, name);
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size > 8192) continue;
        const value = JSON.parse(await readFile(path, "utf8")) as Diagnostic;
        if (value.version === 1 && value.id + ".json" === name && typeof value.timestamp === "string") values.push(value);
      } catch { /* incomplete auxiliary file cannot invalidate the journal */ }
    }
    return values.sort((a,b) => a.timestamp.localeCompare(b.timestamp));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    stderr({ nekomimiDiagnosticReadFailed: true, code: safeCode((error as NodeJS.ErrnoException).code) });
    return [];
  }
}
