import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Markdown, type CodeProps} from '../markdown.js';
import {syntaxKey, languageName, withinSyntaxBudget, type SyntaxLines} from './types.js';
import {nodeSyntax} from './node.js';
export async function markdownHtml(text:string, scope:string) {
  const blocks=new Map<string,CodeProps>();
  const Collect=({text,language}:CodeProps)=>{
    if(languageName(language) && withinSyntaxBudget(text)) blocks.set(syntaxKey(text,language),{text,language});
    return null;
  };
  renderToStaticMarkup(h(Markdown,{text,Code:Collect}));
  const highlights=new Map<string,SyntaxLines>();
  for(const [key,block] of blocks) {
    const lines=await nodeSyntax.run(block.text,block.language,scope);
    if(lines)highlights.set(key,lines);
  }
  return renderToStaticMarkup(h(Markdown,{text,highlights}));
}
