import { realpath } from "node:fs/promises";
import * as nativePath from "node:path";

/** Both arguments must be canonical paths before accessing the filesystem. */
export function isResourceWithin(
  root: string,
  target: string,
  paths: Pick<typeof nativePath, "relative" | "isAbsolute" | "sep"> = nativePath,
): boolean {
  const relative = paths.relative(root, target);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}

export async function resolveResource(root: string, target: string): Promise<string | undefined> {
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  return isResourceWithin(canonicalRoot, canonicalTarget) ? canonicalTarget : undefined;
}
