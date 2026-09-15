import {createElement as h} from 'react';
import {safeTokenClass, type SyntaxToken} from './types.js';
export function TokenSpans({tokens}:{tokens:SyntaxToken[]}) {
  return tokens.map((t,i)=>h('span',{key:i,className:safeTokenClass(t.className)},t.text));
}
