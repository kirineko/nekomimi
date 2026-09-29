export type Reference = { path: string; kind: 'file' | 'directory' };
export type ReferenceCandidate = Reference & { name: string };
export type ReferencePage = { entries: ReferenceCandidate[]; revision: string; next?: string; limited: boolean };
export type Segment = { type: 'text'; text: string } | ({ type: 'reference' } & Reference);
export const REFERENCE_MIME = 'application/x-nekomimi-references+json';
export function referencePath(input: string): string {
  if (!input || input.length > 8192 || /[\u0000-\u001f\u007f-\u009f]/u.test(input) || input.startsWith('/') || /^[A-Za-z]:/.test(input)) throw Error('引用路径无效');
  const parts = input.split('/');
  if (parts.includes('..')) throw Error('引用路径必须位于工作区内');
  return parts.filter(p => p && p !== '.').join('/') || '.';
}
export function formatReference(ref: Reference): string {
  const path = referencePath(ref.path) + (ref.kind === 'directory' ? '/' : '');
  return '@' + (/^[\p{L}\p{N}_./-]+$/u.test(path) ? path : JSON.stringify(path));
}
export function parseReference(value: string): Reference {
  if (!value.startsWith('@')) throw Error('引用语法无效');
  const path: unknown = value[1] === '"' ? JSON.parse(value.slice(1)) : value.slice(1);
  if (typeof path !== 'string') throw Error('引用语法无效');
  return { path: referencePath(path), kind: path.endsWith('/') ? 'directory' : 'file' };
}
export function segmentText(segment: Segment) { return segment.type === 'text' ? segment.text : formatReference(segment); }
export function serialize(segments: Segment[]) { return segments.map(segmentText).join(''); }
export function normalizeSegments(segments: Segment[]): Segment[] {
  const result: Segment[] = [];
  for (const s of segments) {
    if (s.type === 'text') {
      if (!s.text) continue;
      const last = result.at(-1);
      if (last?.type === 'text') last.text += s.text; else result.push({ ...s });
    } else result.push({ type: 'reference', path: referencePath(s.path), kind: s.kind });
  }
  return result;
}
export function sliceSegments(segments: Segment[], start: number, end: number): Segment[] {
  let offset = 0; const result: Segment[] = [];
  for (const s of segments) {
    const length = segmentText(s).length;
    if (end > offset && start < offset + length) result.push(s.type === 'text' ? { type: 'text', text: s.text.slice(Math.max(0, start - offset), Math.min(length, end - offset)) } : { ...s });
    offset += length;
  }
  return normalizeSegments(result);
}
export function atomicRange(segments: Segment[], start: number, end = start): [number, number] {
  let offset = 0;
  for (const s of segments) {
    const next = offset + segmentText(s).length;
    if (s.type === 'reference') {
      if (start > offset && start < next) start = offset;
      if (end > offset && end < next) end = next;
    }
    offset = next;
  }
  return [start, end];
}
export function replaceSegments(segments: Segment[], start: number, end: number, insert: Segment[]) {
  [start, end] = atomicRange(segments, start, end);
  const result = normalizeSegments([...sliceSegments(segments, 0, start), ...insert, ...sliceSegments(segments, end, Infinity)]);
  if (serialize(result).length > 32000) throw Error('任务内容不能超过 32000 个字符（包含完整引用路径）');
  return { segments: result, caret: start + serialize(insert).length };
}
export function decodeClipboard(raw: string): Segment[] {
  if (raw.length > 128000) throw Error('引用剪贴板过大');
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.segments) || value.segments.length > 2000) throw Error('引用剪贴板无效');
  const segments: Segment[] = value.segments.map((s: any) => {
    if (s?.type === 'text' && typeof s.text === 'string') return { type: 'text', text: s.text };
    if (s?.type === 'reference' && typeof s.path === 'string' && ['file', 'directory'].includes(s.kind)) return { type: 'reference', path: referencePath(s.path), kind: s.kind };
    throw Error('引用剪贴板无效');
  });
  if (serialize(segments).length > 32000) throw Error('引用剪贴板过大');
  return normalizeSegments(segments);
}
/** Only the current text node can activate completion; reference nodes are atomic. */
export function referenceWord(segments: Segment[], caret: number, end = caret) {
  if (caret !== end) return undefined;
  const text = serialize(segments); let offset = 0;
  for (const s of segments) {
    const next = offset + segmentText(s).length;
    if (s.type === 'reference' && caret > offset && caret <= next) return undefined;
    offset = next;
  }
  // Track fenced and inline code before the cursor, including multi-line fences.
  let fence = '', inline = 0;
  for (const line of text.slice(0, caret).split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !inline) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; continue; }
    if (fence) continue;
    for (const match of line.matchAll(/(?<!\\)`+/g)) { if (!inline) inline = match[0].length; else if (inline === match[0].length) inline = 0; }
  }
  if (fence || inline) return undefined;
  const prefix = text.slice(0, caret);
  const match = /(?:^|\s)@("(?:[^"\\\n]|\\.)*|[^\s"@]*)$/.exec(prefix);
  if (!match) return undefined;
  const raw = match[1]!; const start = caret - raw.length - 1;
  // Do not allow a token to span an existing chip.
  offset = 0;
  for (const s of segments) { const next = offset + segmentText(s).length; if (s.type === 'reference' && next > start && offset < caret) return undefined; offset = next; }
  let query = raw;
  if (raw.startsWith('"')) { try { query = JSON.parse(raw + '"'); } catch { return undefined; } }
  return { start, end: caret, query: query as string };
}
