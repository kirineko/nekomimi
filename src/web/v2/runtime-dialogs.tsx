import {useRef} from 'react';
import {Button} from '../ui/Button';
import {DialogRoot,DialogContent,DialogTitle,DialogDescription,DialogActions} from '../ui/Dialog';
import {CustomPanel,type PanelView} from '../components/CustomPanel';
import {PanelBoundary} from './slots';
export function RuntimeDialogs({request,page,finish,closePage,restore}:{request?:{text:string};page?:PanelView;finish:(choice:'keep'|'append'|'replace')=>void;closePage:()=>void;restore:()=>void}){
 const cancel=useRef<HTMLButtonElement>(null);
 return <>
    <DialogRoot open={!!request} onOpenChange={open=>{if(!open)finish('keep');}}>
      <DialogContent onOpenAutoFocus={event=>{event.preventDefault();cancel.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();restore();}}>
        <DialogTitle>如何处理面板草稿？</DialogTitle>
        <DialogDescription>当前已有未发送内容。仅在你选择后修改草稿，不会自动发送。</DialogDescription>
        <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{request?.text}</p>
        <DialogActions><Button ref={cancel} variant="outline" onClick={()=>finish('keep')}>保留原草稿</Button><Button variant="outline" onClick={()=>finish('append')}>追加到草稿</Button><Button onClick={()=>finish('replace')}>替换草稿</Button></DialogActions>
      </DialogContent>
    </DialogRoot>
    <DialogRoot open={!!page} onOpenChange={open=>{if(!open)closePage();}}>
      <DialogContent className="max-h-[90dvh] w-[min(900px,calc(100vw-32px))] overflow-auto" onCloseAutoFocus={event=>{event.preventDefault();restore();}}>
        <DialogTitle>{page?.title ?? '扩展页面'}</DialogTitle>
        <DialogDescription>此视图仅绑定当前会话；关闭后停止实例与订阅。</DialogDescription>
        <Button variant="outline" onClick={()=>closePage()}>关闭扩展页面</Button>
        {page && <PanelBoundary key={`${page.resourceId}:${page.id}:${page.revision}`} fallback={page.fallback}><CustomPanel panel={page} /></PanelBoundary>}
      </DialogContent>
    </DialogRoot>
 </>;
}
