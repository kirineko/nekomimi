import { readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { hash } from '../journal.js';
import { ApiError } from '../shared/protocol.js';
import { referencePath, type ReferenceCandidate, type ReferencePage } from '../shared/references.js';
import { workspacePath } from './workspace.js';
const excluded = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);
function logical(path: string) {
  try { return referencePath(path); } catch (e) { throw new ApiError(400, 'path', String(e)); }
}
export function referenceScore(path: string, query: string) {
  const needle = query.toLocaleLowerCase(), p = path.toLocaleLowerCase(), name = p.split('/').at(-1)!;
  if (name === needle) return 1000;
  if (name.startsWith(needle)) return 900;
  if (name.includes(needle)) return 700;
  if (p.includes(needle)) return 500;
  let at = 0, gaps = 0;
  for (const c of needle) { const next = p.indexOf(c, at); if (next < 0) return -1; gaps += next - at; at = next + 1; }
  return 300 - Math.min(299, gaps);
}
interface Index { entries: ReferenceCandidate[]; limited: boolean; revision: string; expires: number }
interface Scan { abort: AbortController; users: number; promise: Promise<Index> }
export class WorkspaceReferences {
  private cache?: Index;
  private scan?: Scan;
  constructor(readonly root: string, readonly maxEntries = 50000, readonly pageSize = 20) {}
  close() { this.scan?.abort.abort(); this.cache = undefined; }
  private async directory(path: string) {
    const root = await realpath(this.root), seen = new Set([root]);
    let current = root;
    if (path === '.') return root;
    for (const part of path.split('/')) {
      current = resolve(current, part);
      const canonical = await workspacePath(root, current, true);
      if (seen.has(canonical)) throw new ApiError(403, 'directory_cycle', '目录链接指向祖先，无法展开');
      seen.add(canonical);
    }
    return workspacePath(root, path, true);
  }
  async resolve(path: string, signal?: AbortSignal): Promise<ReferenceCandidate> {
    signal?.throwIfAborted(); path = logical(path);
    await this.directory(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');
    // workspacePath performs realpath containment and rejects special files.
    let kind: 'file' | 'directory' = 'file';
    try { await workspacePath(this.root, path); }
    catch (error) { try { await this.directory(path); kind = 'directory'; } catch { throw error; } }
    signal?.throwIfAborted();
    return { path, name: path === '.' ? '工作区' : path.split('/').at(-1)!, kind };
  }
  private async build(signal: AbortSignal): Promise<Index> {
    const entries: ReferenceCandidate[] = [], queue = ['.']; let visited = 0, limited = false;
    outer: for (let i = 0; i < queue.length; i++) {
      signal.throwIfAborted();
      const dir = queue[i]!;
      const target = await this.directory(dir);
      const children = (await readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (visited++ >= this.maxEntries) { limited = true; break outer; }
        if (visited % 128 === 0) { await setImmediate(); signal.throwIfAborted(); }
        if (child.name.startsWith('.') || excluded.has(child.name)) continue;
        const path = dir === '.' ? child.name : `${dir}/${child.name}`;
        try { logical(path); } catch { continue; }
        if (child.isDirectory()) { entries.push({ path, name: child.name, kind: 'directory' }); queue.push(path); }
        else if (child.isFile()) entries.push({ path, name: child.name, kind: 'file' });
        else if (child.isSymbolicLink()) { try { entries.push(await this.resolve(path, signal)); } catch { signal.throwIfAborted(); } }
      }
    }
    return { entries, limited, revision: hash(JSON.stringify(entries)), expires: Date.now() + 5000 };
  }
  private async index(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.cache && this.cache.expires > Date.now()) return this.cache;
    if (!this.scan || this.scan.abort.signal.aborted) {
      const abort = new AbortController();
      const scan: Scan = { abort, users: 0, promise: undefined! };
      scan.promise = this.build(abort.signal).then(index => { if (!abort.signal.aborted && this.scan === scan) this.cache = index; return index; }).finally(() => { if (this.scan === scan) this.scan = undefined; });
      this.scan = scan;
    }
    const scan = this.scan; scan.users++;
    try {
      return await new Promise<Index>((accept, reject) => {
        const cancel = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', cancel, { once: true });
        scan.promise.then(accept, reject).finally(() => signal?.removeEventListener('abort', cancel));
      });
    } finally { if (--scan.users === 0 && this.scan === scan) scan.abort.abort(); }
  }
  async list(query = '', cursor?: string, refresh = false, signal?: AbortSignal): Promise<ReferencePage> {
    if (query.length > 8192 || /[\u0000-\u001f\u007f-\u009f]/u.test(query)) throw new ApiError(400, 'path', '查询无效');
    signal?.throwIfAborted();
    if (refresh) { this.cache = undefined; this.scan?.abort.abort(); this.scan = undefined; }
    const slash = query.lastIndexOf('/');
    if (!query || slash >= 0 || query.startsWith('.')) {
      const path = logical(slash < 0 ? '.' : query.slice(0, slash) || '.');
      if (query.startsWith('/')) throw new ApiError(403, 'path', '仅支持工作区相对路径');
      const fragment = slash < 0 ? query : query.slice(slash + 1);
      const target = await this.directory(path), before = await stat(target);
      const revision = hash(`${target}:${query}:${before.mtimeMs}:${before.ctimeMs}`);
      let offset = 0;
      if (cursor) {
        const [stamp, value] = cursor.split(':'); offset = Number(value);
        if (stamp !== revision || !/^\d+$/.test(value ?? '') || !Number.isSafeInteger(offset)) throw new ApiError(409, 'directory_changed', '目录已变化，请刷新');
      }
      const all = (await readdir(target, { withFileTypes: true })).filter(e => (fragment.startsWith('.') || !e.name.startsWith('.')) && referenceScore(e.name, fragment) >= 0)
        .sort((a, b) => referenceScore(b.name, fragment) - referenceScore(a.name, fragment) || Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      const entries: ReferenceCandidate[] = [];
      let end = offset;
      for (; end < all.length && entries.length < this.pageSize; end++) {
        signal?.throwIfAborted(); const entry = all[end]!;
        try { entries.push(await this.resolve(path === '.' ? entry.name : `${path}/${entry.name}`, signal)); } catch { signal?.throwIfAborted(); }
      }
      const after = await stat(target);
      if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new ApiError(409, 'directory_changed', '目录已变化，请刷新');
      return { entries, revision, next: end < all.length ? `${revision}:${end}` : undefined, limited: false };
    }
    logical(query);
    const index = await this.index(signal);
    const ranked = index.entries.map(entry => ({ entry, score: referenceScore(entry.path, query) })).filter(e => e.score >= 0)
      .sort((a, b) => b.score - a.score || Number(b.entry.kind === 'directory') - Number(a.entry.kind === 'directory') || a.entry.path.localeCompare(b.entry.path));
    const entries: ReferenceCandidate[] = [];
    for (const { entry } of ranked) {
      signal?.throwIfAborted();
      try { entries.push(await this.resolve(entry.path, signal)); } catch { signal?.throwIfAborted(); }
      if (entries.length === this.pageSize) break;
    }
    return { entries, revision: index.revision, limited: index.limited || ranked.length > this.pageSize };
  }
}
