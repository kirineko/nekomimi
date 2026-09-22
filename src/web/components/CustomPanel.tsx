import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
export interface PanelView {id:string;resourceId:string;revision:string;fallback:string;slot:'sidebar'|'result';bundleHash:string;renderer?:string;themes?:Record<string,unknown>}
export interface PanelMount {instanceId:string;nonce:string;url:string;fallback:string}
export function CustomPanel({panel,propsJson='{}',workflowId,preview=false,prepared}:{panel:PanelView;propsJson?:string;workflowId?:string;preview?:boolean;prepared?:PanelMount}) {
  const frame=useRef<HTMLIFrameElement>(null),loads=useRef(0);
  const [mount,setMount]=useState<PanelMount>(),[error,setError]=useState(''),[closed,setClosed]=useState(false),[theme,setTheme]=useState('');
  useEffect(()=>{
    if(closed) return;
    let live=true, bound:PanelMount|undefined,channel:MessageChannel|undefined,connected=false,inflight=0,count=0,windowStart=Date.now(),lastId=0;
    const controller=new AbortController(); loads.current=0;setMount(undefined);
    const fail=(reason:string)=>{if(live) {setError(reason);setMount(undefined);} channel?.port1.close();if(bound)void api('/customization',{action:'panel-unmount',instanceId:bound.instanceId}).catch(()=>{});};
    const timer=setTimeout(()=>{if(!connected) fail('面板未完成握手，已显示文本回退');},10000);
    const receive=(event:MessageEvent)=>{
      if(connected || !bound || event.source!==frame.current?.contentWindow || event.data?.kind!=='ready' || event.data?.version!==1 || event.data?.nonce!==bound.nonce || event.data?.instanceId!==bound.instanceId) return;
      connected=true;clearTimeout(timer);channel=new MessageChannel();
      const port=channel.port1;
      port.onmessage=message=>{
        const value=message.data;
        if(Date.now()-windowStart>=1000){windowStart=Date.now();count=0;}
        let size=Infinity;try{size=JSON.stringify(value).length;}catch{}
        if(++count>30 || size>32768 || inflight>=16 || value?.instanceId!==bound!.instanceId) {fail('面板消息超限或身份无效');return;}
        if(value?.kind==='crash'){fail('组件运行失败，已显示文本回退');return;}
        if(value?.kind!=='request' || value.version!==1 || !Number.isSafeInteger(value.id) || value.id<=lastId) {fail('面板消息序列无效');return;}
        lastId=value.id;inflight++;
        void api('/customization',{action:'panel-action',instanceId:bound!.instanceId,sequence:value.id,method:value.action,value:value.value},controller.signal).then(result=>{if(live) port.postMessage({kind:'response',instanceId:bound!.instanceId,id:value.id,result});}).catch(e=>{if(live) port.postMessage({kind:'response',instanceId:bound!.instanceId,id:value.id,error:String(e)});}).finally(()=>{inflight--;});
      };
      frame.current!.contentWindow!.postMessage({kind:'connect',version:1,nonce:bound.nonce,instanceId:bound.instanceId},'*',[channel.port2]);
    };
    window.addEventListener('message',receive);
    void Promise.resolve().then(()=>prepared ?? api<PanelMount>('/customization',{action:'panel-mount',resourceId:panel.resourceId,panelId:panel.id,revision:panel.revision,props:JSON.parse(propsJson),workflowId,preview,theme},controller.signal)).then(value=>{bound=value;if(live){setError('');setMount(value);}else void api('/customization',{action:'panel-unmount',instanceId:value.instanceId}).catch(()=>{});}).catch(e=>{if(live) fail(String(e));});
    return ()=>{live=false;clearTimeout(timer);controller.abort();window.removeEventListener('message',receive);channel?.port1.close();if(bound)void api('/customization',{action:'panel-unmount',instanceId:bound.instanceId}).catch(()=>{});};
  },[panel.resourceId,panel.id,panel.revision,propsJson,workflowId,preview,closed,theme,prepared]);
  return <section className="custom-panel" aria-label={`自定义面板 ${panel.id}`}>
    <div><strong>{panel.id}</strong><button onClick={()=>{setClosed(true);setMount(undefined);}}>关闭面板</button></div>
    {!prepared&&!!Object.keys(panel.themes ?? {}).length&&<label>面板主题<select aria-label="面板主题" value={theme} onChange={e=>setTheme(e.target.value)}><option value="">默认</option>{Object.keys(panel.themes!).map(name=><option key={name}>{name}</option>)}</select></label>}
    {error && <p role="alert">{error}</p>}
    {mount&&!closed&&<iframe ref={frame} title={`面板 ${panel.id}`} sandbox="allow-scripts" referrerPolicy="no-referrer" src={mount.url} onLoad={()=>{if(++loads.current>1){setError('组件导航已停止，已显示文本回退');setClosed(true);setMount(undefined);}}}/>}
    <p className="panel-fallback">{panel.fallback}</p>
    <details><summary>结构化面板数据</summary><pre>{propsJson}</pre></details>
  </section>;
}
export function PanelManagement({panels,flows}:{panels:PanelView[];flows:{id:string;resourceId:string;status:string}[]}) {
  const [selected,setSelected]=useState(''),[props,setProps]=useState('{}'),[workflow,setWorkflow]=useState(''),[live,setLive]=useState<{key:string;panel:PanelView;props:string;workflow?:string;preview:boolean}>();
  const panel=panels.find(p=>`${p.resourceId}|${p.id}`===selected);
  return <section aria-label="自定义面板"><h3>自定义面板</h3>
    <label>面板定义<select aria-label="面板定义" value={selected} onChange={e=>{setSelected(e.target.value);setWorkflow('');}}><option value="">选择面板</option>{panels.map(p=><option key={`${p.resourceId}|${p.id}`} value={`${p.resourceId}|${p.id}`}>{p.id} · {p.slot}</option>)}</select></label>
    <label>面板数据 JSON<textarea aria-label="面板数据 JSON" value={props} onChange={e=>setProps(e.target.value)}/></label>
    <label>关联工作流<select aria-label="关联工作流" value={workflow} onChange={e=>setWorkflow(e.target.value)}><option value="">不关联</option>{flows.filter(f=>f.resourceId===panel?.resourceId).map(f=><option key={f.id} value={f.id}>{f.id} · {f.status}</option>)}</select></label>
    <button disabled={!panel} onClick={()=>panel&&setLive({key:crypto.randomUUID(),panel,props,preview:true})}>预览面板</button><button disabled={!panel} onClick={()=>panel&&setLive({key:crypto.randomUUID(),panel,props,workflow,preview:false})}>打开面板</button>
    {live&&<CustomPanel key={live.key} panel={live.panel} propsJson={live.props} workflowId={live.workflow} preview={live.preview}/>}
  </section>;
}
