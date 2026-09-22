import ts from "typescript";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { hash } from "../journal.js";
import type { Resource } from "./resources.js";

export interface ValidationDiagnostic {
  stage: "manifest" | "syntax" | "type" | "dependency";
  code: number | string;
  message: string;
  resourceId: string;
  contentHash: string;
  file?: string;
  line?: number;
  column?: number;
}
export interface ValidationReport {
  version: 1;
  resourceId: string;
  contentHash: string;
  passed: boolean;
  diagnostics: ValidationDiagnostic[];
}
export function contentHash(files: Record<string, string>): string {
  return hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
}
/** Compiler API only: no tsconfig discovery, plugins, emit, or module execution. */
export function checkTypes(resource: Resource): ValidationReport {
  const files = resource.files ?? {};
  const digest = contentHash(files);
  const result: ValidationReport = { version: 1, resourceId: resource.id, contentHash: digest, passed: false, diagnostics: [] };
  const add = (diagnostic: Omit<ValidationDiagnostic, "resourceId" | "contentHash">) => result.diagnostics.push({ ...diagnostic, resourceId: resource.id, contentHash: digest });
  if (!resource.manifest || resource.error) {
    add({ stage: "manifest", code: "invalid_manifest", message: resource.error ?? "Missing manifest" });
    return result;
  }
  const sdkSource = fileURLToPath(new URL("../extensions.ts", import.meta.url));
  const sdk = existsSync(sdkSource) ? sdkSource : fileURLToPath(new URL("../extensions.d.ts", import.meta.url));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, strict: true, noImplicitAny: resource.manifest.sdkVersion !== 1, noEmit: true, skipLibCheck: true,
    allowJs: true, checkJs: true, allowImportingTsExtensions: true,
    types: ["node"], typeRoots: [dirname(dirname(createRequire(import.meta.url).resolve("@types/node/package.json")))],
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
    baseUrl: resource.root, paths: { "nekomimi/extensions": [sdk] },
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  const snapshot = new Map(Object.entries(files).map(([name, text]) => [resolve(resource.root, name), text]));
  host.readFile = path => snapshot.get(resolve(path)) ?? read(path);
  host.fileExists = path => snapshot.has(resolve(path)) || exists(path);
  const entrypoints = [...snapshot.keys()].filter(p => /\.[cm]?[jt]sx?$/.test(p));
  const program = ts.createProgram(entrypoints, options, host);
  const syntax = program.getSyntacticDiagnostics();
  const diagnostics = [...syntax, ...program.getOptionsDiagnostics(), ...program.getSemanticDiagnostics()];
  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const position = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    add({
      stage: [2307, 2688, 2792].includes(diagnostic.code) ? "dependency" : syntax.some(d => d === diagnostic) ? "syntax" : "type",
      code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      file: diagnostic.file ? relative(resource.root, diagnostic.file.fileName) : undefined,
      line: position ? position.line + 1 : undefined, column: position ? position.character + 1 : undefined,
    });
    if (result.diagnostics.length >= 100) { add({ stage: "type", code: "diagnostic_limit", message: "Stopped after 100 diagnostics" }); break; }
  }
  result.passed = result.diagnostics.length === 0;
  return result;
}
