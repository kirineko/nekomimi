import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { exists } from "./resources.js";
import { CAPABILITIES } from "./types.js";
import { CONTRACT_VERSIONS } from "./contracts.js";
const entries = {
  public: "../extensions",
  legacy: "./types",
  contracts: "./contracts",
} as const;
export async function sdkCatalog(entry?: string) {
  const catalog = { versions: CONTRACT_VERSIONS, supportedSdkVersions: [1, 2], availableCapabilities: CAPABILITIES, entries: Object.keys(entries) };
  if (!entry) return catalog;
  if (!Object.hasOwn(entries, entry)) throw new Error("Unknown SDK catalog entry");
  const path = entries[entry as keyof typeof entries];
  const declaration = fileURLToPath(new URL(path + ".d.ts", import.meta.url));
  const source = fileURLToPath(new URL(path + ".ts", import.meta.url));
  return { ...catalog, entry, text: await readFile(await exists(declaration) ? declaration : source, "utf8") };
}
