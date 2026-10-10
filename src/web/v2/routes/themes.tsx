import { useEffect, useState } from 'react';
import type { ThemeItem } from '../../theme-types';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Input';
import { EmptyState } from '../../ui/StateCard';
import { ManagementConfirm } from './management-confirm';
import { useWorkbenchTheme } from '../theme';
export function ThemesPage({embedded=false}:{embedded?:boolean}){
  const theme=useWorkbenchTheme(),[scope,setScope]=useState<'project'|'user'>('project');
  // Only discard this page's temporary preview; navigation never saves a preference.
  useEffect(()=>()=>theme.setPreview(undefined),[theme.setPreview]);
  const catalog=theme.catalog;
  if(!catalog)return <EmptyState title="正在读取主题目录…" detail={theme.error} actions={<Button onClick={()=>void theme.refresh()}>刷新主题目录</Button>}/>;
  const selection=theme.preview===undefined?catalog.active:theme.preview;
  const apply=(selected:ThemeItem|null|undefined,label:string)=><ManagementConfirm label={label} sessionId={theme.sessionId} description="按已审阅的范围及修订保存主题偏好，不授予资源新权限。" review={()=>({request:{action:'theme-select',scope,selection:selected?{id:selected.id,resourceId:selected.resourceId,revision:selected.revision}:selected,revision:catalog[scope].revision},detail:<><p>范围：{scope==='user'?'用户默认，可能影响其他项目':'当前绑定目标或服务项目'}</p><p>偏好修订：{catalog[scope].revision}</p><p>{selected?`${selected.title} · ${selected.revision}`:selected===null?'宿主默认风格':'跟随用户默认'}</p></>})} onResult={()=>theme.applied()}/>;
  return <div className="min-w-0 space-y-4"><header className="space-y-2"><h1 className="text-xl">主题与外观</h1><Button variant="outline" onClick={()=>void theme.refresh()}>刷新主题目录</Button></header>
    <p className="text-sm">{theme.sessionId ? '当前为此会话绑定的目标。' : '当前为服务项目，未绑定独立开发目标。'}当前已选：{catalog.active?.title??'宿主默认风格'}。预览不会保存，离开本页即取消。明暗切换为未声明颜色提供宿主默认值。</p>
    {theme.error&&<p role="alert" className="break-all text-sm text-danger">{theme.error}</p>}
    <section aria-label="主题预览" className="flex flex-wrap gap-2"><Button variant="outline" aria-pressed={theme.preview===null} onClick={()=>theme.setPreview(null)}>预览默认风格</Button>{catalog.themes.map(item=><Button variant="outline" key={`${item.resourceId}:${item.id}:${item.revision}`} aria-pressed={theme.preview?.id===item.id&&theme.preview.resourceId===item.resourceId} onClick={()=>theme.setPreview(item)}>预览 {item.title}</Button>)}</section>
    {!catalog.themes.length&&<p className="text-sm">暂无已加载并授权的主题；请从能力与权限入口管理主题资源。</p>}
    {theme.preview!==undefined&&<Button variant="outline" onClick={()=>theme.setPreview(undefined)}>取消主题预览</Button>}
    <details className="text-sm"><summary>高级作用域</summary><label className="block text-sm">主题应用范围<Select aria-label="主题应用范围" value={scope} onChange={event=>setScope(event.target.value as 'project'|'user')}><option value="project">当前绑定目标或服务项目</option><option value="user">用户默认</option></Select></label></details>
    <div className="flex flex-wrap gap-3">{apply(selection??null,'应用已审阅风格')}{scope==='project'&&apply(undefined,'跟随用户默认')}</div>
    <details className="text-sm"><summary>偏好与资源版本</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({user:catalog.user,project:catalog.project,preview:selection?{id:selection.id,resourceId:selection.resourceId,revision:selection.revision}:null},null,2)}</pre></details>
    {!embedded&&<Button variant="outline" disabled={theme.recovering} onClick={()=>void theme.recover()}>恢复此目标默认风格</Button>}
  </div>;
}
