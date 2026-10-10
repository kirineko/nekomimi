import {Button} from '../ui/Button';
import {DialogRoot,DialogContent,DialogTitle,DialogDescription,DialogClose} from '../ui/Dialog';
import {deferred} from './deferred';
import {setExtensionDisplay,useExtensionDisplay} from './state/extension-display';
import {useWorkbenchTheme} from './theme';
const Appearance=deferred('v2/routes/themes.tsx','ThemesPage','主题管理',()=>import('./routes/themes').then(module=>module.ThemesPage));
const ExportContent=deferred('v2/routes/session-export.tsx','ExportContent','会话导出',()=>import('./routes/session-export').then(module=>module.ExportContent));
export function MoreDialog({dialog,close,restore,theme,onTheme,sessionId}:{dialog:'appearance'|'export';close:()=>void;restore:()=>void;theme:'light'|'dark';onTheme:(value:'light'|'dark')=>void;sessionId?:string}){
 const custom=useWorkbenchTheme(),visible=useExtensionDisplay();
 return (
    <DialogRoot open={!!dialog} onOpenChange={open=>{if(!open)close();}}>
      <DialogContent className="max-h-[85%] w-[min(680px,calc(100%-32px))] overflow-y-auto" onCloseAutoFocus={event=>{event.preventDefault();restore();}}>
        <div className="flex items-center justify-between gap-3"><DialogTitle>{dialog==='export'?'导出对话':'外观'}</DialogTitle><DialogClose asChild><Button size="sm" variant="outline">{dialog==='export'?'关闭导出':'关闭外观'}</Button></DialogClose></div>
        <DialogDescription>{dialog==='export'?'离线 HTML 用于阅读，诊断包包含会话与执行证据；导出不会重新运行模型、工具或扩展。':'预览只在此窗口中生效，关闭即取消未保存预览。'}</DialogDescription>
        {dialog==='appearance'&&<div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" onClick={()=>onTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?'浅色':'深色'}</Button>
            <Button size="sm" variant="outline" role="switch" aria-label="显示扩展内容" aria-checked={visible} onClick={()=>setExtensionDisplay(!visible)}><span aria-hidden className={`inline-block h-3 w-3 rounded-full ${visible?'bg-brand':'bg-muted'}`} />显示扩展内容<span aria-hidden>{visible?'已开启':'已关闭'}</span></Button>
            <Button size="sm" variant="outline" disabled={custom.recovering} onClick={()=>{setExtensionDisplay(false);void custom.recover();close();}}>恢复默认界面</Button>
          </div>
          <Appearance embedded loadClose={close} />
        </div>}
        {dialog==='export'&&sessionId&&<ExportContent key={sessionId} sessionId={sessionId} loadClose={close} />}
      </DialogContent>
    </DialogRoot>
);
}
