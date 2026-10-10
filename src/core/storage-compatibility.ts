import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, readSession } from '../journal.js';
import { inspectDataHome, requireNewContract, DATA_FORMAT_VERSION, SDK_CONTRACT_VERSION } from '../storage/format.js';
import { safePath } from '../customization/resources.js';

/** Run using the selected binary's own readers, before any writable service initialization. */
export async function inspectCoreStorage(workspace: string, home: string) {
  if (await inspectDataHome(home) !== 'supported') throw Error('Recovery requires an existing supported data home');
  const canonical = await realpath(workspace), root = await safePath(home, join('workspaces', hash(canonical)));
  const optional = async (path: string) => {
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw Error('Invalid recovery metadata'); return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  for (const name of ['settings.json', 'auth.json']) {
    const path = join(home, name), value = await optional(path);
    if (value !== undefined) { requireNewContract(value, 'config', path); if (value.version !== 2) throw Error('Configuration version incompatible'); }
  }
  const metadata = await optional(join(root, 'workspace.json'));
  if (!metadata || metadata.workspace !== canonical || metadata.version !== 2) throw Error('Recovery workspace identity missing or incompatible');
  requireNewContract(metadata, 'config', root);
  let directories = 0, journals = 0;
  const inspect = async (directory: string, depth = 0): Promise<void> => {
    let info;
    try { info = await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Recovery storage directory is not an ordinary directory');
    if (++directories > 10000 || depth > 16) throw Error('Recovery storage inspection limit');
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some(entry => entry.name === 'journal.jsonl')) {
      const snapshot = await readSession(directory);
      if (snapshot.tornBytes || snapshot.tentativeEvents) throw Error('Storage Journal requires explicit recovery before version rollback');
      journals++;
      // Journal artifacts are verified by readSession; never follow data paths or load factories.
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw Error('Recovery storage symlink rejected');
      if (entry.isDirectory() && !entry.name.endsWith('.lock')) await inspect(join(directory, entry.name), depth + 1);
    }
  };
  await inspect(root);
  for (const name of ['workflows', 'workspace-state']) await inspect(await safePath(canonical, join('.nekomimi', name)));
  return { version: 1, dataFormatVersion: DATA_FORMAT_VERSION, sdkVersion: SDK_CONTRACT_VERSION, journals, writes: false as const };
}
