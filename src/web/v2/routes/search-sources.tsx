/** Render saved source metadata only. Unsafe or credential-bearing links are omitted. */
function link(value:unknown) {
  if(typeof value!=='string')return;
  try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url;}catch{}
}
export function SearchSources({details}:{details:unknown}) {
  const saved=details as {sources?:unknown;status?:string}|undefined;
  if(!Array.isArray(saved?.sources))return null;
  return <section aria-label="搜索来源" className="mt-3 space-y-2 text-sm">
    <p className="text-xs text-muted">{({complete:'搜索完成',partial:'部分结果，搜索未全部完成',empty:'搜索完成，无结果',failed:'搜索失败'} as Record<string,string>)[saved.status ?? ''] ?? '已保存的搜索记录'}</p>
    {saved.sources.slice(0,10).map((item,index)=>{
      if(!item||typeof item!=='object')return null;const source=item as {url?:unknown;title?:unknown;snippet?:unknown},url=link(source.url);
      if(!url||typeof source.title!=='string')return null;
      return <a key={`${url.href}:${index}`} href={url.href} target="_blank" rel="noopener noreferrer" className="block break-words rounded-md border border-line p-2 text-foreground"><strong>{index+1}. {source.title}</strong><span className="block break-all text-xs text-muted">{url.hostname} ↗</span>{typeof source.snippet==='string'&&<p>{source.snippet}</p>}</a>;
    })}
  </section>;
}
export function SavedFetchSummary({details}:{details:unknown}) {
  const saved=details as {finalUrl?:unknown;title?:unknown;status?:string;statusCode?:number;extraction?:string;bodyTruncated?:boolean;outputTruncated?:boolean}|undefined,url=link(saved?.finalUrl);
  if(!saved||!url)return null;
  return <section aria-label="网页读取结果" className="mt-3 space-y-2 text-sm"><a href={url.href} target="_blank" rel="noopener noreferrer" className="block break-all text-foreground underline">{typeof saved.title==='string'&&saved.title?saved.title:url.hostname}<span className="block text-xs">{url.href}</span></a>
    <p className="text-xs text-muted">{({complete:'读取完成',partial:'部分内容',empty:'未提取到可读文本',failed:'读取失败',cancelled:'读取已停止'} as Record<string,string>)[saved.status ?? ''] ?? '读取记录'}{typeof saved.statusCode==='number'&&` · HTTP ${saved.statusCode}`}</p>
    {saved.extraction==='metadata'&&<p>页面摘要（description 回退，非完整正文）</p>}{saved.bodyTruncated&&<p>响应体已截断，未下载部分不可恢复。</p>}{saved.outputTruncated&&<p>输出已截断，可在详情中查看完整已保存文本。</p>}
  </section>;
}
