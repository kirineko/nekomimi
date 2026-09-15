import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Markdown as SharedMarkdown, type CodeProps } from '../../presentation/markdown';
import { TokenSpans } from '../../presentation/syntax/view';
import { SyntaxPool } from '../../presentation/syntax/pool';
import { type SyntaxLines } from '../../presentation/syntax/types';
export const browserSyntax = new SyntaxPool((message,error)=>{
  const worker=new Worker(new URL('../syntax-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=e=>message(e.data);worker.onerror=error;
  return worker;
});
const Scope=createContext('');
export function SyntaxScope({id,children}:{id:string;children:ReactNode}) {
  useEffect(()=>()=>browserSyntax.clearScope(id),[id]);
  return <Scope.Provider value={id}>{children}</Scope.Provider>;
}
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
