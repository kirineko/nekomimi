export interface SyntaxToken { text: string; className: string }
export type SyntaxLines = SyntaxToken[][];
export const maxSyntaxBytes = 256 * 1024;
export function withinSyntaxBudget(text: string) {
  return text.length <= maxSyntaxBytes && new TextEncoder().encode(text).length <= maxSyntaxBytes && text.split('\n').length <= 5000;
}
const aliases: Record<string, string> = { js:'javascript',ts:'typescript',py:'python',sh:'bash',shell:'bash',jsx:'tsx',mjs:'javascript',cjs:'javascript',mts:'typescript',cts:'typescript' };
const supported = new Set(['javascript','typescript','tsx','python','json','bash','diff']);
export function languageName(name = ''): string | undefined {
  if(name.length > 64) return;
  const lower = name.toLowerCase();
  if (lower.startsWith('diff-')) return `diff-${languageName(lower.slice(5))?.replace(/^diff-/, '') ?? 'diff'}`;
  const normalized = aliases[lower] ?? lower;
  return supported.has(normalized) ? normalized : undefined;
}
export function fileLanguage(path: string) { return languageName(path.split(/[\\/]/).at(-1)?.split('.').at(-1)); }
export const syntaxKey = (text: string, language: string) => JSON.stringify([language, text]);
export function tokenText(tokens: SyntaxToken[]) { return tokens.map(t=>t.text).join(''); }
export function safeTokenClass(value: string) {
  return value.split(' ').filter(c=>/^syn-(?:c\d+|f[1-7]|add|del)$/.test(c)).join(' ');
}
