import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import theme from '@shikijs/themes/github-light';
import { colors } from './palette.js';
import { languageName, withinSyntaxBudget, tokenText, type SyntaxLines, type SyntaxToken } from './types.js';
const loaders = {
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  python: () => import('@shikijs/langs/python'),
  json: () => import('@shikijs/langs/json'),
  bash: () => import('@shikijs/langs/bash'),
  diff: () => import('@shikijs/langs/diff'),
};
const highlighter = createHighlighterCoreSync({ langs: [], themes: [theme], engine: createJavaScriptRegexEngine() });
export async function loadLanguage(language: string) {
  const name = languageName(language);
  if (!name) return;
  const base = name.startsWith('diff-') ? name.slice(5) : name;
  for (const lang of new Set([base, ...(name.startsWith('diff-') ? ['diff'] : [])])) {
    if (!highlighter.getLoadedLanguages().includes(lang)) await highlighter.loadLanguage((await loaders[lang as keyof typeof loaders]()).default);
  }
}
function sourceTokens(text: string, lang: string): SyntaxLines {
  const raw = text.split('\n');
  return highlighter.codeToTokens(text, { lang, theme:'github-light' }).tokens.map((line,i) => {
    const tokens = line.map(t => {
      const color = colors.indexOf(t.color?.toLowerCase() ?? '');
      return {text:t.content,className:[color >= 0 ? `syn-c${color}` : '', t.fontStyle && t.fontStyle > 0 ? `syn-f${t.fontStyle & 7}` : ''].filter(Boolean).join(' ')};
    });
    // Shiki normalizes CRLF in its line API; retain CR in our text projection.
    if (raw[i]?.endsWith('\r') && tokenText(tokens) === raw[i]!.slice(0,-1)) tokens.push({text:'\r',className:''});
    return tokenText(tokens) === raw[i] ? tokens : [{text:raw[i] ?? '',className:''}];
  });
}
function diffTokens(text: string, language: string): SyntaxLines {
  const lines = text.split('\n');
  const result = sourceTokens(text, 'diff');
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const old: string[] = [], next: string[] = [];
    const positions: {i:number;old?:number;next?:number}[] = [];
    for(let i=start;i<end;i++) {
      const line=lines[i]!;
      if (/^[ +\-]/.test(line)) {
        const p: typeof positions[number] = {i};
        if(line[0] !== '+') { p.old=old.length; old.push(line.slice(1)); }
        if(line[0] !== '-') { p.next=next.length; next.push(line.slice(1)); }
        positions.push(p);
      } else if(line && !line.startsWith('\\')) return;
    }
    const a=sourceTokens(old.join('\n'),language), b=sourceTokens(next.join('\n'),language);
    for(const p of positions) {
      const prefix=lines[p.i]![0]!;
      const tokens = prefix==='-' ? a[p.old!] : b[p.next!];
      if(!tokens || tokenText(tokens)!==lines[p.i]!.slice(1)) continue;
      const cls=prefix==='+'?'syn-add':prefix==='-'?'syn-del':'';
      result[p.i]=[{text:prefix,className:cls},...tokens.map(t=>({...t,className:[t.className,cls].filter(Boolean).join(' ')}))];
    }
  };
  for(let i=0;i<lines.length;i++) {
    if(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(lines[i]!)) {flush(i);start=i+1;}
    else if(/^(?:diff --git |--- |\+\+\+ )/.test(lines[i]!)) {flush(i);start=-1;}
  }
  flush(lines.length);
  return result;
}
export function highlightLoaded(text: string, language: string): SyntaxLines | undefined {
  const name=languageName(language);
  if(!name || !withinSyntaxBudget(text)) return;
  try {
    return name.startsWith('diff-') ? diffTokens(text,name.slice(5)) : sourceTokens(text,name);
  } catch { return; }
}
export async function highlight(text: string, language: string) {
  if(!languageName(language) || !withinSyntaxBudget(text)) return;
  await loadLanguage(language);
  return highlightLoaded(text,language);
}
