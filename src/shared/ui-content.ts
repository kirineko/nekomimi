/** User-facing projection only. Never mutate or reconstruct execution evidence. */
export function readablePanel(value: {summary?:unknown;text?:unknown;props?:unknown;fallback?:unknown}):string {
 for(const text of [value.summary,value.text])if(typeof text==='string'&&text.trim())return text.slice(0,8000);
 const lines:string[]=[];
 const visit=(v:unknown,depth:number)=>{
  if(lines.length>=24||depth>3)return;
  if(typeof v==='string'||typeof v==='number'||typeof v==='boolean'){lines.push(String(v).slice(0,1000));return;}
  if(Array.isArray(v)){for(const item of v.slice(0,12))visit(item,depth+1);return;}
  if(v&&typeof v==='object')for(const [key,item] of Object.entries(v).slice(0,24)){if(!/^(version|.*hash|.*revision|.*id|.*artifact|token|secret|password)$/i.test(key))visit(item,depth+1);}
 };
 visit(value.props,0);
 return lines.length?lines.join('\n').slice(0,8000):typeof value.fallback==='string'?value.fallback.slice(0,4000):'结果已保存。';
}
