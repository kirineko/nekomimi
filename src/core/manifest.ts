import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { hash } from '../journal.js';

export interface CoreArtifactFile { path: string; kind: 'file' | 'directory' | 'symlink'; hash?: string; bytes?: number; executable?: boolean; target?: string }
/** Hash actual runtime inputs, including installed dependencies; symlinks must stay inside root. */
export async function coreTreeManifest(selected: string, entries?: string[]) {
  const root = await realpath(selected), files: CoreArtifactFile[] = []; let bytes = 0;
  const visit = async (name: string, depth: number): Promise<void> => {
    if (depth > 48 || files.length >= 100000) throw Error('Core artifact tree limit');
    const path = resolve(root, name), rel = relative(root, path);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw Error('Core artifact path outside root');
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await readlink(path), actual = relative(root, await realpath(path));
      if (isAbsolute(target)) throw Error(`Core artifact symlink must be relative: ${name}`);
      if (actual === '..' || actual.startsWith('../') || isAbsolute(actual)) throw Error(`Core artifact symlink escapes root: ${name}`);
      files.push({ path: name, kind: 'symlink', target, hash: hash(target) }); return;
    }
    if (info.isDirectory()) {
      files.push({ path: name, kind: 'directory' });
      for (const child of (await readdir(path)).sort()) await visit(name ? name + '/' + child : child, depth + 1);
      return;
    }
    if (!info.isFile() || info.size > 256 * 1024 * 1024 || bytes + info.size > 2 * 1024 ** 3) throw Error(`Core artifact byte limit: ${name}`);
    const value = await readFile(path), after = await lstat(path);
    if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs || value.length !== info.size) throw Error(`Core artifact changed: ${name}`);
    bytes += value.length;
    files.push({ path: name, kind: 'file', hash: hash(value), bytes: value.length, executable: !!(info.mode & 0o111) });
  };
  for (const entry of (entries ?? await readdir(root)).slice().sort()) await visit(entry, 0);
  return { revision: hash(JSON.stringify(files)), files, bytes };
}
