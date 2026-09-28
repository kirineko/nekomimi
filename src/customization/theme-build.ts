import { assetMime } from './asset.js';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { hash } from '../journal.js';
import { safePath, LIMITS, type Resource } from './resources.js';
import { validateTheme, assetPath, type ThemeDefinition } from './ui-contract.js';
import type {BuiltTheme} from './ui-contract.js';
export type {BuiltTheme} from './ui-contract.js';
/** Assets are embedded from immutable package inputs; the browser never fetches arbitrary URLs. */
export async function buildTheme(resource: Resource, theme: ThemeDefinition): Promise<BuiltTheme> {
  validateTheme(theme);
  const assetsData: NonNullable<BuiltTheme['assetsData']> = {};
  for (const [kind, name] of [['font',theme.typography?.font],['background',theme.assets?.background]] as const) {
    if (!name) continue;
    assetPath(name);
    const bytes = await readFile(await safePath(resource.root, name));
    if (bytes.length > LIMITS.file) throw new Error('Theme asset size limit');
    const expected = resource.fileHashes?.[name];
    if (!expected || hash(bytes) !== expected) throw new Error('Theme immutable asset integrity mismatch');
    const mime = assetMime(name, bytes);
    assetsData[kind] = `data:${mime};base64,${bytes.toString('base64')}`;
  }
  return {...theme,assetsData};
}
