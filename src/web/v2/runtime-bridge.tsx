import { useExtensionDisplay } from './state/extension-display';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { type PanelView } from '../components/CustomPanel';
import { UiBridgeContext, type UiBridge } from '../ui-bridge';
import {deferred} from './deferred';
const RuntimeDialogs=deferred('v2/runtime-dialogs.tsx','RuntimeDialogs','扩展对话框',()=>import('./runtime-dialogs').then(module=>module.RuntimeDialogs));
import { useRuntimeUi } from './slots';
import { useDraft } from './state/drafts';

type DraftRequest = {text:string;resourceId:string;revision:string;resolve:(result:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void};

/** Bound once per session layout. A plugin can request a draft, never submit it. */
export function RuntimeBridge({sessionId,mode,children}:{sessionId?:string;mode:'work'|'create';children:ReactNode}) {
  const catalog=useRuntimeUi(mode,sessionId), navigate=useNavigate();
  const scope=catalog.data?.scope;
  const visible=useExtensionDisplay();
  const enabled=visible && !!sessionId && scope?.sessionId===sessionId && scope.mode===mode && !catalog.isError;
  const draft=useDraft(mode,mode==='work'?'default':scope?.targetId ?? 'unbound',sessionId);
  const [request,setRequest]=useState<DraftRequest>();
  const pending=useRef<DraftRequest|undefined>(undefined), alive=useRef(false);
  const [page,setPage]=useState<PanelView>();
  useEffect(()=>{
    if(visible)return;
    pending.current?.cleanup();pending.current?.reject(new Error('扩展内容已隐藏'));pending.current=undefined;
    setRequest(undefined);setPage(undefined);
  },[visible]);
  const origin=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    alive.current=true;
    return ()=>{alive.current=false;pending.current?.cleanup();pending.current?.reject(new Error('面板会话已离开'));pending.current=undefined;};
  },[]);
  const handle=useCallback<UiBridge['handle']>(async(action,value,resourceId,signal)=>{
    if(signal?.aborted || !alive.current || !enabled)throw new Error('面板会话已失效');
    if(action==='draft.set') {
      if(typeof value?.text!=='string' || value.text.length>16000)throw new Error('草稿参数无效');
      const resource=catalog.data?.panels?.find(panel=>panel.resourceId===resourceId);
      if(!resource)throw new Error('面板资源已失效');
      if(pending.current)throw new Error('请先处理已有的草稿请求');
      if(!draft.get().trim()) {draft.set(value.text);return {status:'drafted'};}
      origin.current=document.activeElement as HTMLElement|null;
      return new Promise((resolve,reject)=>{
        const abort=()=>{if(pending.current===next){pending.current=undefined;setRequest(undefined);}next.cleanup();reject(new Error('面板实例已关闭'));};
        const next:DraftRequest={text:value.text,resourceId:resource.resourceId,revision:resource.revision,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};
        signal?.addEventListener('abort',abort,{once:true});pending.current=next;setRequest(next);
      });
    }
    if(action==='session.navigate') {
      if(value?.sessionId!==sessionId)throw new Error('无法导航到未绑定会话');
      await navigate({to:mode==='work'?'/work/session/$sessionId':'/create/session/$sessionId',params:{sessionId:sessionId!}});
      return {status:'opened'};
    }
    if(action==='view.open') {
      const view=catalog.data?.panels?.find(panel=>panel.resourceId===resourceId && panel.id===value?.viewId && panel.slot==='page' && panel.modes?.includes(mode) && panel.targetScope==='current' && panel.contractVersion===3);
      if(!view)throw new Error('当前会话中的视图不可用');
      origin.current=document.activeElement as HTMLElement|null;setPage(view);
      return {status:'opened'};
    }
    throw new Error('不支持该宿主操作');
  },[enabled,sessionId,mode,catalog.data,draft.get,draft.set,navigate]);
  const bridge=useMemo<UiBridge>(()=>({sessionId,enabled,handle}),[sessionId,enabled,handle]);
  const finish=(choice:'keep'|'append'|'replace')=>{
    const current=pending.current;
    if(!current)return;
    pending.current=undefined;current.cleanup();setRequest(undefined);
    if(!alive.current||!enabled||!catalog.data?.panels?.some(panel=>panel.resourceId===current.resourceId&&panel.revision===current.revision)){current.reject(new Error('面板会话已失效'));return;}
    if(choice==='append')draft.set([draft.get(),current.text].filter(Boolean).join('\n'));
    if(choice==='replace')draft.set(current.text);
    current.resolve({status:choice==='keep'?'kept':'drafted'});
  };
  const restore=()=>{if(origin.current?.isConnected)origin.current.focus();};
  return <UiBridgeContext.Provider value={bridge}>
    {children}
    {(request||page)&&<RuntimeDialogs request={request} page={page} finish={finish} closePage={()=>setPage(undefined)} restore={restore} loadClose={()=>{finish('keep');setPage(undefined);restore();}} />}
  </UiBridgeContext.Provider>;
}
