import { createContext, useEffect, type ReactNode } from 'react';
import { SyntaxPool } from '../../presentation/syntax/pool';
export const browserSyntax = new SyntaxPool((message,error)=>{
  const worker=new Worker(new URL('../syntax-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=e=>message(e.data);worker.onerror=error;
  return worker;
});
export const Scope=createContext('');
export function SyntaxScope({id,children}:{id:string;children:ReactNode}) {
  useEffect(()=>()=>browserSyntax.clearScope(id),[id]);
  return <Scope.Provider value={id}>{children}</Scope.Provider>;
}
