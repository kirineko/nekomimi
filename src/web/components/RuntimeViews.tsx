import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {CustomPanel,type PanelView} from './CustomPanel';
import type {UiSlot} from '../../customization/ui-contract';
export const RuntimeViewsContext=createContext<PanelView[]>([]);
export function RuntimeViews({slot,props={},tool,role,children}:{slot:UiSlot;props?:unknown;tool?:string;role?:string;children?:ReactNode}) {
 const catalog=useContext(RuntimeViewsContext);
 const [disabled,setDisabled]=useState<string[]>([]),[selected,setSelected]=useState('');
 const panels=catalog.filter(p=>p.slot===slot&&(!p.match?.tool||p.match.tool===tool)&&(!p.match?.role||p.match.role===role)).sort((a,b)=>(a.order??0)-(b.order??0)||a.resourceId.localeCompare(b.resourceId)||a.id.localeCompare(b.id));
 const key=(p:PanelView)=>`${p.resourceId}:${p.id}`;
 const toolbar=slot==='composer-toolbar';
 const exclusive=slot==='message-content'||slot==='tool-result';
 useEffect(()=>{setSelected('');},[tool,role]);
 if(slot==='message-content'&&!['assistant','user'].includes(role??''))return <>{children}</>;
 if(!panels.length)return <>{children}</>;
 return <section className="runtime-views" aria-label="扩展视图">
  {toolbar&&panels.map(p=><button key={key(p)} aria-expanded={selected===key(p)} onClick={()=>setSelected(selected===key(p)?'':key(p))}>{p.title??p.id}</button>)}
  {exclusive&&<details><summary>选择结果展示</summary><button onClick={()=>setSelected('')}>默认展示</button>{panels.map(p=><button key={key(p)} aria-pressed={selected===key(p)} onClick={()=>setSelected(key(p))}>{p.title??p.id}</button>)}</details>}
  {exclusive&&!panels.some(p=>key(p)===selected&&!disabled.includes(key(p)))&&children}
  {panels.filter(p=>!disabled.includes(key(p))&&(!(exclusive||toolbar)||key(p)===selected)).map(p=><div key={key(p)}><CustomPanel panel={p} propsJson={JSON.stringify(props)}/><button onClick={()=>setDisabled(v=>[...v,key(p)])}>隐藏此挂件</button></div>)}
  {!!disabled.length&&<button onClick={()=>setDisabled([])}>恢复挂件</button>}
 </section>;
}
