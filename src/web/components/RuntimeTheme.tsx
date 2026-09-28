import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import type {BuiltTheme} from '../../customization/ui-contract';
import type {ThemePreference,ThemeSelection} from '../../customization/ui-contract';
import {themeCss,currentPanelTheme,setPanelFontData} from '../runtime-theme';
export type ThemeItem=BuiltTheme&ThemeSelection;
export interface ThemeCatalog {themes:ThemeItem[];user:ThemePreference;project:ThemePreference;active?:ThemeItem;unavailable:boolean}
export function RuntimeTheme({catalog,refresh,onExport,canExport,uiDisabled,onToggleViews}:{catalog?:ThemeCatalog;refresh:()=>void;onExport:()=>void;canExport:boolean;uiDisabled:boolean;onToggleViews:()=>void}) {
 const [appearance,setAppearance]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null);
 const container=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[preview,setPreview]=useState<ThemeItem|null>(),[scope,setScope]=useState<'user'|'project'>('project'),[error,setError]=useState('');
 const theme=preview===undefined?catalog?.active:preview??undefined;
 useEffect(()=>{
  const openTheme=async(event:Event)=>{
   const selection=(event as CustomEvent<ThemeSelection>).detail;
   let found=catalog?.themes.find(t=>t.resourceId===selection.resourceId&&t.revision===selection.revision&&t.id===selection.id);
   if(!found){try{const current=await api<{runtimeUi:ThemeCatalog}>('/runtime-ui');found=current.runtimeUi.themes.find(t=>t.resourceId===selection.resourceId&&t.revision===selection.revision&&t.id===selection.id);}catch{ /* Show an actionable error below. */ }refresh();}
   if(!found){setError('此版本暂不可用，请刷新定制能力后重试。');setAppearance(true);setOpen(true);}
   else {setPreview(found);setAppearance(true);setOpen(true);}
  };
  window.addEventListener('nekomimi-theme-open',openTheme);
  return()=>window.removeEventListener('nekomimi-theme-open',openTheme);
 },[catalog,refresh]);
 useEffect(()=>{
  if(!open)return;
  const cancel=()=>{setPreview(undefined);setOpen(false);setAppearance(false);};
  const outside=(e:PointerEvent)=>{if(!container.current?.contains(e.target as Node))cancel();};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){cancel();trigger.current?.focus();}};
  container.current?.querySelector<HTMLElement>('.header-menu button')?.focus();
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
 },[open]);

 useEffect(()=>{if(open)container.current?.querySelector<HTMLElement>('.header-menu button')?.focus();},[appearance]);
 useEffect(()=>{
  const sheet=new CSSStyleSheet();
  if(theme){sheet.replaceSync(themeCss(theme));document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];document.documentElement.dataset.theme='custom';document.documentElement.dataset.motion=theme.motion?.preset??'none';document.documentElement.dataset.bubbles=theme.bubbles?.style??'rounded';}
  setPanelFontData(theme?.assetsData?.font);
  window.dispatchEvent(new CustomEvent('nekomimi-theme',{detail:currentPanelTheme()}));
  if (theme && preview === undefined) { const active = catalog?.active; if(active) void api('/customization',{action:'theme-verify',resourceId:active.resourceId,contentHash:active.revision,id:active.id}).catch(()=>{}); }
  return()=>{setPanelFontData(undefined);document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==sheet);delete document.documentElement.dataset.theme;delete document.documentElement.dataset.motion;delete document.documentElement.dataset.bubbles;};
 },[theme]);
 async function save(selection:ThemeSelection|null|undefined,selectedScope=scope){
  if(!catalog)return;
  try{await api('/customization',{action:'theme-select',scope:selectedScope,selection,revision:catalog[selectedScope].revision});setPreview(undefined);setOpen(false);setError('');trigger.current?.focus();refresh();}catch(e){setError('主题未保存，请刷新后重试。');refresh();}
 }
 return <div ref={container} className="runtime-theme-controls">
  <button ref={trigger} className="header-more" aria-label="更多操作" title="更多操作" aria-expanded={open} aria-controls="header-menu" onClick={()=>{setPreview(undefined);setAppearance(false);setOpen(!open);}}><span aria-hidden="true">•••</span></button>
  {open&&<section id="header-menu" className="header-menu" aria-label="更多操作">
   {appearance?<>
    <button className="menu-back" onClick={()=>{setPreview(undefined);setAppearance(false);}}>‹ 返回</button>
    <strong>界面风格</strong>
    <div className="theme-options"><button aria-pressed={!theme} onClick={()=>setPreview(null)}><span className="theme-dot" aria-hidden="true"/>默认风格</button>{catalog?.themes.map(t=><button key={`${t.resourceId}:${t.id}`} aria-pressed={theme?.resourceId===t.resourceId&&theme.id===t.id} onClick={()=>setPreview(t)}><span className="theme-dot" style={{background:t.colors?.accent??"var(--accent)"}} aria-hidden="true"/>{t.title}</button>)}</div>
    <button className="primary" onClick={()=>void save(theme?{id:theme.id,revision:theme.revision,resourceId:theme.resourceId}:null)}>应用风格</button>
    <button type="button" role="switch" className="view-toggle" aria-checked={!uiDisabled} onClick={onToggleViews}><span>显示扩展内容</span><span className="toggle-track" aria-hidden="true"><span/></span></button>
    <details><summary>高级选项</summary><div role="group" aria-label="应用范围"><button aria-pressed={scope==='project'} onClick={()=>setScope('project')}>当前项目</button><button aria-pressed={scope==='user'} onClick={()=>setScope('user')}>全局默认</button></div>{scope==='project'&&<button onClick={()=>void save(undefined)}>跟随全局默认</button>}</details>
    <button className="host-recovery" onClick={()=>{setPreview(null);window.dispatchEvent(new Event('nekomimi-ui-reset'));void save(null,'project');}}>恢复默认界面</button>
    {preview!==undefined&&<button onClick={()=>{setPreview(undefined);setAppearance(false);setOpen(false);trigger.current?.focus();}}>取消预览</button>}
   </>:<>
    <span className="menu-caption">工作台</span>
    <button className="menu-action" aria-label="外观" onClick={()=>setAppearance(true)}><span aria-hidden="true">◐</span><span>外观<small>{catalog?.active?.title??'默认风格'}</small></span><span aria-hidden="true">›</span></button>
    <button className="menu-action" aria-label="导出" disabled={!canExport} onClick={()=>{setOpen(false);trigger.current?.focus();onExport();}}><span aria-hidden="true">↗</span><span>导出<small>保存对话或诊断包</small></span><span aria-hidden="true">›</span></button>
   </>}
   {(error||catalog?.unavailable)&&<span role="status">{error||'原风格暂不可用，已恢复默认。'}</span>}
  </section>}
 </div>;
}
