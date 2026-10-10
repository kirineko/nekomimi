import { useContext, useEffect, useRef, useState } from 'react';
import { Markdown as SharedMarkdown, type CodeProps } from '../../presentation/markdown';
import { TokenSpans } from '../../presentation/syntax/view';
import type { SyntaxLines } from '../../presentation/syntax/types';
import { Scope, browserSyntax } from './syntax-scope';
function WebCode({text,language}:CodeProps) {
  const scope=useContext(Scope);
  const [result,setResult]=useState<{text:string;language:string;scope:string;lines:SyntaxLines}>();
  const last=useRef(0);
  useEffect(()=>{
    const abort=new AbortController();
    const timer=setTimeout(()=>{
      last.current=Date.now();
      void browserSyntax.run(text,language,scope,abort.signal).then(lines=>{
        if(lines && !abort.signal.aborted)setResult({text,language,scope,lines});
      });
    },Math.max(0,150-(Date.now()-last.current)));
    return ()=>{clearTimeout(timer);abort.abort();};
  },[text,language,scope]);
  const lines=result?.text===text && result.language===language && result.scope===scope ? result.lines:undefined;
  return <code>{lines?lines.flatMap((tokens,i)=>[i?'\n':'',<TokenSpans key={i} tokens={tokens}/>]):text}</code>;
}
export function Markdown({text}:{text:string}) {return <SharedMarkdown text={text} Code={WebCode}/>;}
