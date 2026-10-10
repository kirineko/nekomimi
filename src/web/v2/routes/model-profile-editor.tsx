import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { ModelManagement, ModelProfile } from '../../../shared/model-management';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Input, Select } from '../../ui/Input';
import { modelsKey } from '../state/models';
export function ModelProfileEditor({ data, sessionId, close }: { data: ModelManagement; sessionId?: string; close: () => void }) {
  const newCredential = useRef(`profile-${crypto.randomUUID()}`);
  const client = useQueryClient(), [id,setId] = useState(''), [providerId,setProvider] = useState(''), [identity,setModel] = useState(''), [url,setUrl] = useState(''), [paths,setPaths] = useState('/responses'), [secret,setSecret] = useState('');
  const [credential,setCredential] = useState<string>(), [credentialUnknown,setCredentialUnknown] = useState(false), [revision,setRevision] = useState(data.providerProfiles.revision);
  const providers = data.providers.filter(provider => provider.resourceId), provider = providers.find(value => value.id === providerId), model = provider?.models.find(value => value.identity === identity);
  const save = useMutation({ mutationFn: async () => {
    const submittedSecret = secret; let stage = 'profile';
    try {
      if (id === 'deepseek') throw Error('deepseek 是内置默认配置标识，请使用其他名称');
      if (data.providerProfiles.entries[id]) throw Error('配置名称已存在，请使用新的名称');
      if (!provider?.resourceId || !model) throw Error('请选择已启用 Provider 的具体模型和操作类型');
      if (credentialUnknown && !submittedSecret) throw Error('凭证写入结果未确认，请重新输入密钥后显式保存');
      let credentialRef = credential;
      if (submittedSecret) { stage = 'credential'; await api('/customization', { action: 'provider-credential', sessionId, ref: newCredential.current, secret: submittedSecret }); credentialRef = newCredential.current; setCredential(credentialRef); setCredentialUnknown(false); }
      stage = 'profile';
      const profile: ModelProfile = { id, providerId, resourceId: provider.resourceId, model: model.id, operation: model.operation, routing: 'physical', baseUrl: url, paths: paths.split(',').map(value => value.trim()), ...(credentialRef ? { credentialRef } : {}) };
      await api('/customization', { action: 'provider-save', sessionId, revision, profile });
    } catch (error) { if (stage === 'credential') setCredentialUnknown(true); const message = error instanceof Error ? error.message : String(error); throw Error(submittedSecret ? message.split(submittedSecret).join('[已隐藏]') : message); }
    finally { setSecret(''); }
  }, onSuccess: close, onSettled: () => client.invalidateQueries({ queryKey: modelsKey(sessionId) }) });
  return <section aria-label="新增模型配置" className="my-4 space-y-3 rounded-lg border border-line p-4"><h2 className="text-base font-semibold">新增模型配置</h2>
    {!providers.length ? <><p>没有已启用的自定义 Provider。先在能力目录检查资源及授权。</p><Link className="text-sm underline" to="/create">前往能力目录</Link><Button variant="outline" onClick={close}>取消编辑</Button></> : <form className="space-y-3" onInvalidCapture={event => { (event.target as HTMLElement).closest("details")?.setAttribute("open", ""); }} onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <fieldset disabled={save.isPending} className="space-y-3">
        <label className="block text-sm">配置名称<Input required pattern="[a-z](?:[a-z0-9]|-){0,47}" aria-label="模型配置名称" value={id} onChange={event => setId(event.target.value)} /></label>
        <label className="block text-sm">Provider<Select required aria-label="模型 Provider" value={providerId} onChange={event => { setProvider(event.target.value); setModel(''); }}><option value="">请选择</option>{providers.map(value => <option key={value.id} value={value.id}>{value.id}</option>)}</Select></label>
        <label className="block text-sm">模型与操作<Select required aria-label="模型与操作" value={identity} onChange={event => { setModel(event.target.value); const selected = provider?.models.find(value => value.identity === event.target.value); setPaths(selected?.protocol === 'chat-completions' ? '/chat/completions' : selected?.protocol === 'responses' ? '/responses' : ''); }}><option value="">请选择</option>{provider?.models.map(value => <option key={value.identity} value={value.identity}>{value.name} · {value.operation} · {value.id}</option>)}</Select></label>
        <label className="block text-sm">服务地址<Input required type="url" aria-label="Provider 服务地址" value={url} onChange={event => setUrl(event.target.value)} /></label>
        <label className="block text-sm">API key<Input type="password" autoComplete="off" aria-label="Provider API key" value={secret} onChange={event => setSecret(event.target.value)} placeholder={credential ? '留空保留已保存的凭证引用' : '仅提交到服务端'} /></label>
        <details><summary className="text-sm">高级请求范围</summary><label className="block text-sm">请求路径（逗号分隔）<Input required aria-label="Provider 请求路径" value={paths} onChange={event => setPaths(event.target.value)} /></label></details>
        <p className="break-all text-xs">授权端点：{url || '尚未填写'}；请求路径：{paths}。保存配置后仍需单独选择用途。</p>
        {save.isError && <p role="alert" className="text-sm text-danger">配置未确认保存：{save.error instanceof Error ? save.error.message : String(save.error)}。密钥输入已清除，非敏感草稿保留。</p>}
        {data.providerProfiles.revision !== revision && <div className="space-y-2"><p className="text-xs text-warning">配置修订已变化，请核对后再保存。草稿修订 {revision}，当前 {data.providerProfiles.revision}。</p><Button type="button" variant="outline" onClick={() => { setRevision(data.providerProfiles.revision); save.reset(); }}>采用当前修订继续编辑</Button></div>}
        <div className="flex flex-wrap gap-2"><Button type="submit" busy={save.isPending} disabled={!model}>授权并保存模型配置</Button><Button type="button" variant="outline" onClick={close}>取消编辑</Button></div>
      </fieldset>
    </form>}
  </section>;
}
