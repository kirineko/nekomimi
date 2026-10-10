import {currentPanelTheme} from '../runtime-theme';
import {UiBridgeContext} from "../ui-bridge";
import type {UiSlot} from "../../customization/ui-contract";
import {readablePanel} from "../../shared/ui-content";
import {useContext,useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {Button} from '../ui/Button';
export interface PanelView {id:string;resourceId:string;revision:string;fallback:string;slot:UiSlot;contractVersion?:number;modes?:('work'|'create')[];targetScope?:'current';resourceRevision?:string;title?:string;order?:number;match?:{tool?:string;role?:string};bundleHash:string;renderer?:string;themes?:Record<string,unknown>}
export interface PanelMount {instanceId:string;nonce:string;url:string;fallback:string}
export function CustomPanel({panel,propsJson='{}',workflowId,preview=false,prepared}:{panel:PanelView;propsJson?:string;workflowId?:string;preview?:boolean;prepared?:PanelMount}) {
  const bridge=useContext(UiBridgeContext),bridgeRef=useRef(bridge);bridgeRef.current=bridge;
  const [ready,setReady]=useState(false),[attempt,setAttempt]=useState(0),[height,setHeight]=useState(160);
  const portRef=useRef<MessagePort|undefined>(undefined),instanceRef=useRef<string|undefined>(undefined);
  const frame=useRef<HTMLIFrameElement>(null),loads=useRef(0);
  const [mount,setMount]=useState<PanelMount>(),[error,setError]=useState(''),[closed,setClosed]=useState(false),[theme,setTheme]=useState('');
  useEffect(()=>{if(bridge.enabled===false){setClosed(true);setMount(undefined);setReady(false);}},[bridge.enabled]);
  useEffect(()=>{
    if(closed||bridge.enabled===false) return;
    let live=true, bound:PanelMount|undefined,channel:MessageChannel|undefined,connected=false,inflight=0,count=0,windowStart=Date.now(),lastId=0;
    const sessionId=bridge.sessionId;
    let dispatch:Promise<unknown>=Promise.resolve();
    const controller=new AbortController(); loads.current=0;setMount(undefined);setReady(false);setError('');
    const fail=(reason:string)=>{controller.abort();if(live) {setError(reason);setMount(undefined);setReady(false);} channel?.port1.close();if(bound)void api('/customization',{action:'panel-unmount',sessionId,instanceId:bound.instanceId}).catch(()=>{});};
    const timer=setTimeout(()=>{if(!connected) fail('面板未完成握手，已显示文本回退');},10000);
    const receive=(event:MessageEvent)=>{
      if(connected || !bound || event.source!==frame.current?.contentWindow || event.data?.kind!=='ready' || event.data?.version!==1 || event.data?.nonce!==bound.nonce || event.data?.instanceId!==bound.instanceId) return;
      connected=true;setReady(true);clearTimeout(timer);channel=new MessageChannel();
      const port=channel.port1;portRef.current=port;instanceRef.current=bound.instanceId;
      port.onmessage=message=>{
        const value=message.data;
        if(Date.now()-windowStart>=1000){windowStart=Date.now();count=0;}
        let size=Infinity;try{size=JSON.stringify(value).length;}catch{}
        if(++count>30 || size>32768 || inflight>=16 || value?.instanceId!==bound!.instanceId) {fail('面板消息超限或身份无效');return;}
        if(value?.kind==='resize'){if(Number.isFinite(value.height))setHeight(Math.max(80,Math.min(900,value.height)));return;}
        if(value?.kind==='crash'){fail('组件运行失败，已显示文本回退');return;}
        if(value?.kind!=='request' || value.version!==1 || !Number.isSafeInteger(value.id) || value.id<=lastId) {fail('面板消息序列无效');return;}
        lastId=value.id;inflight++;
        // HTTP can arrive out of order even though MessagePort delivery is ordered.
        // Serialize the server phase only: a draft confirmation must not stall subscriptions.
        const response=dispatch.then(()=>api('/customization',{action:'panel-action',sessionId,instanceId:bound!.instanceId,sequence:value.id,method:value.action,value:value.value},controller.signal));
        dispatch=response.then(()=>undefined,()=>undefined);
        void response.then(async(result:any)=>{if(!live)return;if(result?.uiAction){if(result.sessionId!==bridgeRef.current.sessionId)throw new Error('会话已切换');result=await bridgeRef.current.handle(result.uiAction,result.value,result.resourceId,controller.signal);}if(live) port.postMessage({kind:'response',instanceId:bound!.instanceId,id:value.id,result});}).catch(e=>{if(live) port.postMessage({kind:'response',instanceId:bound!.instanceId,id:value.id,error:String(e)});}).finally(()=>{inflight--;});
      };
      frame.current!.contentWindow!.postMessage({kind:'connect',version:1,nonce:bound.nonce,instanceId:bound.instanceId},'*',[channel.port2]);
    };
    window.addEventListener('message',receive);
    void Promise.resolve().then(()=>prepared ?? api<PanelMount>('/customization',{action:'panel-mount',resourceId:panel.resourceId,panelId:panel.id,revision:panel.revision,props:JSON.parse(propsJson),workflowId,preview,theme,sessionId},controller.signal)).then(value=>{bound=value;if(live){setError('');setMount(value);}else void api('/customization',{action:'panel-unmount',sessionId,instanceId:value.instanceId}).catch(()=>{});}).catch(e=>{if(live) fail(String(e));});
    return ()=>{portRef.current=undefined;instanceRef.current=undefined;live=false;clearTimeout(timer);controller.abort();window.removeEventListener('message',receive);channel?.port1.close();if(bound)void api('/customization',{action:'panel-unmount',sessionId,instanceId:bound.instanceId}).catch(()=>{});};
  },[panel.resourceId,panel.id,panel.revision,propsJson,workflowId,preview,closed,prepared,attempt,bridge.sessionId,bridge.enabled]);
  useEffect(()=>{
    const send=(value:unknown)=>portRef.current?.postMessage({kind:'theme',instanceId:instanceRef.current,value});
    const listener=(event:Event)=>{const detail=(event as CustomEvent).detail;send({...detail,...(theme?panel.themes?.[theme] as object:{})});};
    window.addEventListener('nekomimi-theme',listener);
    send({...currentPanelTheme(),...(theme?panel.themes?.[theme] as object:{})});
    return()=>window.removeEventListener('nekomimi-theme',listener);
  },[theme,ready]);
  return <section className="custom-panel min-w-0 space-y-3 rounded-lg border border-line p-3" aria-label={`自定义面板 ${panel.title??panel.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{panel.title??'扩展内容'}</strong><Button variant="outline" onClick={()=>{setClosed(!closed);setMount(undefined);setReady(false);}}>{closed?'重新打开':'收起'}</Button></div>
    {!prepared&&!!Object.keys(panel.themes ?? {}).length&&<div className="panel-theme-options flex flex-wrap gap-2" role="group" aria-label="面板主题"><Button variant="outline" aria-pressed={!theme} onClick={()=>setTheme('')}>跟随界面</Button>{Object.keys(panel.themes!).map(name=><Button variant="outline" key={name} aria-pressed={theme===name} onClick={()=>setTheme(name)}>{name}</Button>)}</div>}
    {!closed&&!ready&&!error&&<p role="status">正在打开…</p>}
    {error&&<div role="alert"><p>暂时无法显示互动内容，已保留结果。</p><Button variant="outline" onClick={()=>{setClosed(false);setAttempt(n=>n+1);}}>重试</Button></div>}
    {mount&&!closed&&<iframe className="w-full border-0" ref={frame} title={`面板 ${panel.title??panel.id}`} sandbox="allow-scripts" referrerPolicy="no-referrer" src={mount.url} style={{height}} onLoad={()=>{if(++loads.current>1){setError('组件导航已停止');setClosed(true);setMount(undefined);}}}/>}
    {!ready&&<p className="panel-fallback">{readablePanel({props:JSON.parse(propsJson),fallback:panel.fallback})}</p>}
    <details className="panel-developer-details"><summary>开发详情</summary>{error&&<p>{error}</p>}<pre className="whitespace-pre-wrap break-all">{propsJson}</pre></details>
  </section>;
}
