import {useEffect,useRef,useState, type ComponentType} from 'react';
import {loadFeature,type Feature} from '../features';
function Loading({label,error,retry,close,modal}:{label:string;error:boolean;retry:()=>void;close:()=>void;modal:boolean}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(modal)dialog.current?.showModal();},[modal]);
 const content=<><header><strong>{label}</strong><button type="button" aria-label={`关闭${label}`} onClick={close}>×</button></header><p role={error?'alert':'status'}>{error?'暂时无法打开，请重试。':'正在准备…'}</p>{error&&<button type="button" onClick={retry}>重试加载</button>}</>;
 return modal?<dialog ref={dialog} className="feature-loading" aria-label={label} onCancel={e=>{e.preventDefault();close();}}>{content}</dialog>:<section className="feature-loading">{content}</section>;
}
export function AsyncFeature<P extends object>({feature,label,modal=false,...props}:P & {feature:Feature<P>;label:string;modal?:boolean;close:()=>void}) {
 const [Component,setComponent]=useState<ComponentType<P>|undefined>(()=>feature.component);
 const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 const opener=useRef<HTMLElement|null>(document.activeElement as HTMLElement);
 useEffect(()=>()=>{if(modal)queueMicrotask(()=>{if(opener.current?.isConnected)opener.current.focus({preventScroll:true});});},[modal]);
 useEffect(()=>{
  let current=true;
  void loadFeature(feature).then(component=>{if(current)setComponent(()=>component);},()=>{if(current)setFailed(true);});
  return()=>{current=false;};
 },[feature,attempt]);
 if(Component)return <Component {...props as P}/>;
 return <Loading label={label} modal={modal} error={failed} close={props.close} retry={()=>{setFailed(false);setAttempt(n=>n+1);}}/>;
}
