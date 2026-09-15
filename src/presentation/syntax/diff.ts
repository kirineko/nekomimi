import type {DiffPage} from '../diff.js';
import {tokenText, type SyntaxLines, type SyntaxToken} from './types.js';
export function colorDiff(page:DiffPage, before?:SyntaxLines, after?:SyntaxLines):DiffPage {
  return {...page,lines:page.lines.map(line=>{
    const tokens=line.kind==='del'?before?.[(line.old ?? 0)-1]:line.kind==='header'?undefined:after?.[(line.next ?? 0)-1];
    if(!tokens)return line;
    let remaining=line.text.length;
    const sliced:SyntaxToken[]=line.truncated?tokens.flatMap(t=>{
      const text=t.text.slice(0,Math.max(0,remaining));remaining-=text.length;return text?[{...t,text}]:[];
    }):tokens;
    return tokenText(sliced)===line.text?{...line,tokens:sliced}:line;
  })};
}
