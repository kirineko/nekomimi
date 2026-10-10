import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { DialogRoot, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogActions, DialogClose } from '../../ui/Dialog';
interface SavedSettings {
  revision: number; authRevision: number; configured: boolean; model: string; baseUrl: string; autoCompact: boolean;
  search: { enabled: boolean; model: string; baseUrl: string };
}
interface SettingsView extends SavedSettings {
  storedCredentialConfigured: boolean;
  runtimeDefault: { model: string; baseUrl: string; configured: boolean; overrides: { model: boolean; baseUrl: boolean; credential: boolean } };
}
const settingsKey = () => ['v2',location.host,'settings'];
function useSettingsRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ predicate: query => query.queryKey[0] === 'v2' && (query.queryKey.includes('settings') || query.queryKey.includes('models') || query.queryKey.includes('customization')) });
}
function CredentialSettings({ data }: { data: SettingsView }) {
  const [secret,setSecret] = useState(''),[revision,setRevision] = useState(data.authRevision),[clearing,setClearing] = useState(false),[clearRevision,setClearRevision] = useState(data.authRevision);
  const refresh = useSettingsRefresh();
  const save = useMutation({ mutationFn: async (remove: boolean) => {
    const key = secret; setSecret('');
    try { return await api<SavedSettings>('/settings',{kind:'auth',revision:remove?clearRevision:revision,apiKey:remove?null:key}); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); throw new Error(key ? message.split(key).join('[已隐藏凭证]') : message); }
  }, onSuccess: result => { setRevision(result.authRevision); setClearing(false); }, onSettled: refresh });
  return <section aria-label="默认模型凭证" className="space-y-3 rounded-lg border border-line p-4"><h2 className="text-base">默认 DeepSeek 凭证</h2><p className="text-sm">本地保存：{data.storedCredentialConfigured?'已配置':'未配置'}；运行时默认凭证：{data.runtimeDefault.configured?'已配置':'未配置'}。</p>
    {data.runtimeDefault.overrides.credential && <p className="text-sm">启动参数提供了运行时凭证。保存或清除本地凭证不会改变本次进程的启动参数。</p>}
    <form className="space-y-3" onSubmit={event=>{event.preventDefault();save.mutate(false);}}><label className="block text-sm">默认 DeepSeek API key<Input aria-label="默认 DeepSeek API key" type="password" autoComplete="off" value={secret} maxLength={4096} disabled={save.isPending} onChange={event=>{setSecret(event.target.value);save.reset();}} /></label><Button type="submit" disabled={!secret.trim()||revision!==data.authRevision} busy={save.isPending}>保存默认凭证</Button></form>
    {revision!==data.authRevision && <div className="space-y-2 text-sm"><p>凭证修订已变化，重新审阅当前状态后使用最新修订；不会自动重试。</p><Button variant="outline" disabled={save.isPending} onClick={()=>{setSecret('');setRevision(data.authRevision);save.reset();}}>使用最新凭证修订</Button></div>}
    <DialogRoot open={clearing} onOpenChange={value=>{if(!save.isPending)setClearing(value);}}><DialogTrigger asChild><Button variant="outline" disabled={!data.storedCredentialConfigured||save.isPending} onClick={()=>{setClearRevision(data.authRevision);save.reset();setClearing(true);}}>清除本地默认凭证</Button></DialogTrigger><DialogContent><DialogTitle>清除本地默认凭证</DialogTitle><DialogDescription>删除本地保存的默认 DeepSeek 凭证；自定义 Provider 凭证及进程启动参数仍各自有效。</DialogDescription><p className="text-sm">凭证修订 {clearRevision}</p>{save.isError&&<p role="alert" className="text-danger">{save.error.message}</p>}<DialogActions><DialogClose asChild><Button variant="outline" disabled={save.isPending}>取消清除</Button></DialogClose><Button variant="destructive" busy={save.isPending} disabled={save.isError} onClick={()=>save.mutate(true)}>确认清除凭证</Button></DialogActions></DialogContent></DialogRoot>
    {save.isError&&!clearing&&<p role="alert" className="break-all text-sm text-danger">保存未确认：{save.error.message}。密钥输入已清除；请核对状态后重新输入，不会自动重试。</p>}{save.isSuccess&&<p role="status" className="text-sm">凭证操作已保存。</p>}
  </section>;
}
type SettingsDraft = Pick<SavedSettings,'model'|'baseUrl'|'search'|'autoCompact'>;
function SettingsEditor({ data }: { data: SettingsView }) {
  const [draft,setDraft] = useState<SettingsDraft>(()=>({model:data.model,baseUrl:data.baseUrl,search:{...data.search},autoCompact:data.autoCompact})),[revision,setRevision] = useState(data.revision);
  const [open,setOpen] = useState(false),[review,setReview] = useState<{draft:SettingsDraft;revision:number}>();
  const refresh = useSettingsRefresh(), trigger = useRef<HTMLButtonElement>(null), modelInput = useRef<HTMLInputElement>(null);
  const save = useMutation({ mutationFn: () => {
    if(!review)throw new Error('请重新审阅设置');
    return api<SavedSettings>('/settings',{kind:'settings',revision:review.revision,...review.draft});
  },onSuccess:result=>{setRevision(result.revision);setOpen(false);},onSettled:refresh });
  const field = (name:'model'|'baseUrl',value:string)=>setDraft(previous=>({...previous,[name]:value}));
  return <section aria-label="默认模型与执行设置" className="space-y-3 rounded-lg border border-line p-4"><h2 className="text-base">默认模型与执行设置</h2>
    <p className="text-sm">用户范围；模型用途已选择自定义配置时，以相应用途配置为准。以下设置保存不会立即发起模型调用。</p>
    <form className="space-y-3" onSubmit={event=>{event.preventDefault();setReview({draft:structuredClone(draft),revision});save.reset();setOpen(true);}}>
      <label className="block text-sm">默认模型<Input ref={modelInput} aria-label="默认模型" required maxLength={100} value={draft.model} disabled={save.isPending} onChange={event=>field('model',event.target.value)} /></label>
      <label className="block text-sm">默认服务地址<Input aria-label="默认服务地址" type="url" required value={draft.baseUrl} disabled={save.isPending} onChange={event=>field('baseUrl',event.target.value)} /></label>
      <Button type="button" variant="outline" role="switch" aria-checked={draft.search.enabled} disabled={save.isPending} onClick={()=>setDraft(previous=>({...previous,search:{...previous.search,enabled:!previous.search.enabled}}))}>网页搜索：{draft.search.enabled?'开启':'关闭'}</Button>
      <details className="space-y-2 text-sm"><summary>搜索模型与端点</summary><label className="block">搜索模型<Input aria-label="搜索模型" required maxLength={100} value={draft.search.model} disabled={save.isPending} onChange={event=>setDraft(previous=>({...previous,search:{...previous.search,model:event.target.value}}))} /></label><label className="block">搜索服务地址<Input aria-label="搜索服务地址" type="url" required value={draft.search.baseUrl} disabled={save.isPending} onChange={event=>setDraft(previous=>({...previous,search:{...previous.search,baseUrl:event.target.value}}))} /></label></details>
      <div><Button type="button" variant="outline" role="switch" aria-checked={draft.autoCompact} disabled={save.isPending} onClick={()=>setDraft(previous=>({...previous,autoCompact:!previous.autoCompact}))}>自动整理上下文：{draft.autoCompact?'开启':'关闭'}</Button><p className="mt-2 text-xs">接近容量时整理早期内容并保留原始记录；整理会产生模型用量。关闭后仍可明确执行 /compact。</p></div>
      <Button ref={trigger} type="submit" disabled={save.isPending||revision!==data.revision}>审阅并保存设置</Button>
    </form>
    {revision!==data.revision&&<section className="space-y-2 text-sm" aria-label="设置修订冲突"><p>本地草稿基于修订 {revision}，服务端现为 {data.revision}。草稿已保留，采用最新修订后保存会覆盖以下服务端设置。</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify({model:data.model,baseUrl:data.baseUrl,search:data.search,autoCompact:data.autoCompact},null,2)}</pre><Button variant="outline" disabled={save.isPending} onClick={()=>{setRevision(data.revision);save.reset();}}>保留草稿并采用最新修订</Button></section>}
    <DialogRoot open={open} onOpenChange={value=>{if(!save.isPending)setOpen(value);}}><DialogContent onCloseAutoFocus={event=>{event.preventDefault();if(trigger.current?.disabled)modelInput.current?.focus();else trigger.current?.focus();}}><DialogTitle>确认默认模型与执行设置</DialogTitle><DialogDescription>按已审阅的用户配置修订保存；启动参数覆盖的字段须重启并调整参数后才能改变实际行为。</DialogDescription><pre className="my-3 max-h-[40dvh] overflow-auto whitespace-pre-wrap break-all text-xs">{review&&JSON.stringify({revision:review.revision,...review.draft},null,2)}</pre>{save.isError&&<p role="alert" className="text-sm text-danger">保存失败：{save.error.message}。草稿保留，请关闭后核对服务端状态；不会自动重试。</p>}<DialogActions><DialogClose asChild><Button variant="outline" disabled={save.isPending}>取消保存</Button></DialogClose><Button busy={save.isPending} disabled={save.isError} onClick={()=>save.mutate()}>确认保存设置</Button></DialogActions></DialogContent></DialogRoot>
    {save.isSuccess&&<p role="status" className="text-sm">设置已保存。</p>}
  </section>;
}
export function SettingsPage() {
  const query=useQuery({queryKey:settingsKey(),queryFn:({signal})=>api<SettingsView>('/config',undefined,signal)});
  if(query.isPending)return <EmptyState title="正在读取基础设置…" busy />;
  if(!query.data)return <ErrorState title="基础设置不可读" detail={String(query.error)} actions={<Button onClick={()=>void query.refetch()}>重新读取设置</Button>} />;
  const runtime=query.data.runtimeDefault;
  return <div className="min-w-0 space-y-4"><header className="space-y-2"><h1 className="text-xl">基础设置</h1><Button variant="outline" onClick={()=>void query.refetch()}>刷新设置状态</Button></header>{query.isError&&<p role="alert">刷新失败，保留草稿及上次读取的状态：{String(query.error)}</p>}
    <section aria-label="运行时默认配置" className="break-all text-sm"><p>运行时默认模型：{runtime.model} · {runtime.baseUrl} · Responses</p><p>启动参数覆盖：{Object.entries(runtime.overrides).filter(([,enabled])=>enabled).map(([name])=>({model:'模型',baseUrl:'服务地址',credential:'凭证'} as Record<string,string>)[name]).join('、')||'无'}</p></section>
    <CredentialSettings data={query.data}/><SettingsEditor data={query.data}/>
  </div>;
}
