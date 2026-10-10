import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SearchSources,SavedFetchSummary} from '../src/web/v2/routes/search-sources.js';
it('renders only bounded safe saved search links and escapes all source text',()=>{
  const html=renderToStaticMarkup(createElement(SearchSources,{details:{status:'partial',sources:[{url:'javascript:alert(1)',title:'unsafe'},{url:'https://user:password@example.com/private',title:'credentials'},{url:'https://example.com/path',title:'<script>bad()</script>',snippet:'<img src=x onerror=bad()>'},...Array.from({length:20},(_,i)=>({url:`https://example.org/${i}`,title:`Result ${i}`}))]}}));
  expect(html).not.toContain('javascript:');expect(html).not.toContain('password');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).toContain('&lt;script&gt;');expect(html.match(/<a /g)).toHaveLength(8);expect(html).toContain('noopener noreferrer');expect(html).toContain('部分结果');
});
it('keeps historical fetch summary explicitly partial and rejects credential-bearing destinations',()=>{
  expect(renderToStaticMarkup(createElement(SavedFetchSummary,{details:{finalUrl:'https://secret:token@example.com'}}))).toBe('');
  const html=renderToStaticMarkup(createElement(SavedFetchSummary,{details:{finalUrl:'https://example.com/history',status:'partial',statusCode:200,extraction:'metadata',bodyTruncated:true,outputTruncated:true}}));
  for(const text of ['网页读取结果','部分内容','非完整正文','未下载部分不可恢复','完整已保存文本'])expect(html).toContain(text);
});
