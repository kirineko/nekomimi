import { setExtensionDisplay } from './state/extension-display';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { currentPanelTheme, setPanelFontData } from '../runtime-theme';
import type { ThemeCatalog, ThemeItem } from '../theme-types';
import { workbenchThemeCss } from './theme-css';
export const themeKey=(sessionId?:string)=>['v2',location.host,'theme',sessionId??'host'];
interface ThemeState { recovering:boolean; catalog?:ThemeCatalog; error?:string; sessionId?:string; preview?:ThemeItem|null; setPreview:(theme:ThemeItem|null|undefined)=>void; refresh:()=>Promise<unknown>; recover:()=>Promise<void>; applied:()=>void }
const ThemeContext=createContext<ThemeState|undefined>(undefined);
export function useWorkbenchTheme(){const value=useContext(ThemeContext);if(!value)throw Error('Theme provider missing');return value;}
export function WorkbenchTheme({sessionId,children}:{sessionId?:string;children:ReactNode}){
  const client=useQueryClient(),[preview,setPreview]=useState<ThemeItem|null>(),[error,setError]=useState(''),[safe,setSafe]=useState(()=>{try{return sessionStorage.getItem('v2-theme-safe')==='true';}catch{return false;}}),[verify,setVerify]=useState<ThemeItem>();
  const recoveryLock=useRef(false),[recovering,setRecovering]=useState(false);
  const safety=useCallback((value:boolean)=>{setSafe(value);try{if(value)sessionStorage.setItem('v2-theme-safe','true');else sessionStorage.removeItem('v2-theme-safe');}catch{}},[]);
  const changePreview=useCallback((value:ThemeItem|null|undefined)=>{if(value!==undefined)safety(false);setError('');setPreview(value);},[safety]);
  const query=useQuery({queryKey:themeKey(sessionId),queryFn:({signal})=>api<{runtimeUi:ThemeCatalog}>('/runtime-ui'+(sessionId?'?session='+encodeURIComponent(sessionId):''),undefined,signal),refetchInterval:5000});
  const catalog=query.data?.runtimeUi;
  const requested=preview===undefined?catalog?.active:preview??undefined;
  const available=requested&&catalog?.themes.some(item=>item.id===requested.id&&item.resourceId===requested.resourceId&&item.revision===requested.revision);
  const theme=!safe&&!query.isError&&available?requested:undefined;
  const css=useMemo(()=>{try{return theme?{value:workbenchThemeCss(theme)}:{};}catch(cause){return {error:String(cause)};}},[theme]);
  useEffect(()=>{
    if(!css.value){delete document.documentElement.dataset.workbenchTheme;setPanelFontData(undefined);window.dispatchEvent(new CustomEvent('nekomimi-theme',{detail:currentPanelTheme()}));return;}
    const sheet=new CSSStyleSheet();sheet.replaceSync(css.value);document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];document.documentElement.dataset.workbenchTheme=theme!.id;
    setPanelFontData(theme?.assetsData?.font);window.dispatchEvent(new CustomEvent('nekomimi-theme',{detail:currentPanelTheme()}));
    return()=>{document.adoptedStyleSheets=document.adoptedStyleSheets.filter(item=>item!==sheet);delete document.documentElement.dataset.workbenchTheme;setPanelFontData(undefined);window.dispatchEvent(new CustomEvent('nekomimi-theme',{detail:currentPanelTheme()}));};
  },[css.value,theme]);
  useEffect(()=>{
    if(!verify||!theme||!css.value||preview!==undefined||verify.id!==theme.id||verify.resourceId!==theme.resourceId||verify.revision!==theme.revision)return;
    setVerify(undefined);
    void api('/customization',{action:'theme-verify',sessionId,id:theme.id,resourceId:theme.resourceId,contentHash:theme.revision}).catch(()=>setError('风格已应用，但宿主观测记录未确认。'));
  },[verify,theme,css.value,preview,sessionId]);
  const refresh=()=>client.invalidateQueries({queryKey:themeKey(sessionId)});
  const recover=async()=>{
    if(recoveryLock.current)return;recoveryLock.current=true;setRecovering(true);
    setExtensionDisplay(false);safety(true);setPreview(undefined);setVerify(undefined);setError('');
    try{const current=await api<{runtimeUi:ThemeCatalog}>('/runtime-ui'+(sessionId?'?session='+encodeURIComponent(sessionId):''));await api('/customization',{action:'theme-select',scope:'project',selection:null,revision:current.runtimeUi.project.revision,sessionId});await refresh();}
    catch{setError('已在本窗口恢复默认界面；保存偏好失败，请在主题管理中刷新后重试。');}
    finally{recoveryLock.current=false;setRecovering(false);}
  };
  return <ThemeContext.Provider value={{recovering,catalog,sessionId,error:error||css.error||(safe&&catalog?.active?'当前窗口已停用自定义风格；明确预览或应用可恢复。':undefined)||(query.isError?'主题目录读取失败，已使用默认风格。':requested&&!available?'预览版本已不可用，已使用默认风格。':catalog?.unavailable?'已选风格未加载或已撤权，已使用默认风格。':undefined),preview,setPreview:changePreview,refresh,recover,applied:()=>{safety(false);setPreview(undefined);void refresh().then(()=>setVerify(client.getQueryData<{runtimeUi:ThemeCatalog}>(themeKey(sessionId))?.runtimeUi.active));}}}>{children}</ThemeContext.Provider>;
}
