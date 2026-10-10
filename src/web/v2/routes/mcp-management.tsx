import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { useCustomization, type CustomizationDescribe } from '../state/create';
import type { ResourceDescriptor } from '../../../customization/types';
import { ManagementConfirm } from './management-confirm';

const statuses: Record<string, string> = { authorized: '已授权', authorizing: '等待授权回调', reauthorize: '需要重新授权', disconnected: '已断开授权', invalid_configuration: '授权配置无效' };
function McpCard({ resource, data, sessionId }: { resource: ResourceDescriptor; data: CustomizationDescribe; sessionId?: string }) {
  const auth = data.oauth.find(item => item.server === resource.id), runtime = data.mcp.find(item => item.id === resource.id);
  const [pending, setPending] = useState<{ url: string; expiresAt: number; hash: string }>();
  return <article aria-label={`MCP ${resource.name}`} className="space-y-3 rounded-xl border border-line p-4">
    <h2 className="break-all text-base font-semibold">{resource.name}</h2><p className="break-all text-xs">{resource.scope === 'user' ? '用户范围' : '项目范围'} · {resource.source}</p>
    <Badge state={runtime ? 'ok' : 'warning'}>{runtime ? '已加载连接' : '未加载连接'}</Badge>
    {resource.error && <p role="alert" className="break-all text-danger">{resource.error}</p>}
    {auth ? <section aria-label={`授权 ${resource.name}`} className="space-y-2">
      <p role="status" className="text-sm">{statuses[auth.status] ?? auth.status}</p><p className="break-all text-xs">授权服务 {auth.issuer ?? '不可读'}</p>
      <div className="flex flex-wrap gap-2"><ManagementConfirm label="开始 MCP 授权" disabled={auth.status === 'authorizing' || auth.status === 'invalid_configuration'} sessionId={sessionId} description="向此配置的授权服务发起授权。完成浏览器回调后仍需另行启用资源；不会自动执行工具。" review={() => ({ request: { action: 'mcp-authorize', id: resource.id, contentHash: resource.hash }, detail: <><p>{resource.name} · {resource.hash}</p><p>授权服务 {auth.issuer}</p></> })} onResult={result => {
        if (!result.authorizationUrl || !result.expiresAt) return;
        const url = new URL(result.authorizationUrl);
        if (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)) setPending({ url: url.href, expiresAt: result.expiresAt, hash: resource.hash });
      }} />
      <ManagementConfirm label="断开 MCP 授权" dangerous sessionId={sessionId} disabled={auth.status === 'invalid_configuration'} description="撤销本机保存的此连接凭证并终止未完成的授权回调。不改变其他连接的授权。" review={() => ({ request: { action: 'mcp-disconnect', id: resource.id, contentHash: resource.hash }, detail: <p>{resource.name} · {auth.issuer}</p> })} onResult={() => setPending(undefined)} /></div>
      {pending && pending.hash === resource.hash && auth.status === 'authorizing' && pending.expiresAt > Date.now() && <p className="text-sm"><a href={pending.url} target="_blank" rel="noopener noreferrer" className="underline">打开 MCP 授权页面</a> · 有效至 {new Date(pending.expiresAt).toLocaleTimeString()}</p>}
      {auth.status === 'authorizing' && !pending && <p className="text-xs">授权仍在等待。请完成已打开的授权页面；链接不会持久保存。若页面已丢失，可显式断开后重新授权。</p>}
    </section> : <p className="text-sm">此连接未配置 OAuth；凭证与资源启用在配置中分别管理。</p>}
    <details className="break-all text-xs"><summary>连接诊断与可发现内容</summary><p>发现版本 {resource.hash}</p><p>活动版本 {data.activeResources.find(item => item.id === resource.id)?.hash ?? '无'}</p>{runtime ? <><pre className="whitespace-pre-wrap break-all">{runtime.diagnostics || '暂无连接诊断。'}</pre>{runtime.toolErrors.map(item => <p key={item.name} role="alert">{item.name}：{item.error}</p>)}<details><summary>已保存的目录数据</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(runtime.content ?? {}, null, 2)}</pre></details></> : <p>尚无运行目录；查看此页不会连接 MCP 或读取远端内容。</p>}</details>
  </article>;
}
export function McpManagementPage({ sessionId }: { sessionId?: string }) {
  const query = useCustomization(sessionId);
  if (query.isPending) return <EmptyState title="正在读取 MCP 连接…" busy />;
  if (!query.data) return <ErrorState title="MCP 连接不可读" detail={String(query.error)} actions={<Button onClick={() => void query.refetch()}>重新读取 MCP</Button>} />;
  const data = query.data, resources = data.resources.filter(resource => resource.kind === 'mcp');
  return <div className="min-w-0"><header className="sticky top-0 z-10 space-y-3 bg-background pb-3"><h1 className="text-xl">MCP 连接与授权</h1><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void query.refetch()}>刷新 MCP 状态</Button>{sessionId ? <Link className="text-sm underline" to="/create/session/$sessionId/resources" params={{ sessionId }}>管理资源启停与权限</Link> : <Link className="text-sm underline" to="/create/resources">管理资源启停与权限</Link>}</div></header>
    <p className="mb-3 text-sm">OAuth 凭证授权与资源代码/连接启用相互独立。浏览和刷新不执行工具或远端内容读取。</p>
    {query.isError && <p role="alert">刷新失败：{String(query.error)}</p>}
    {!resources.length && <EmptyState title="尚未发现 MCP 连接" detail="在目标配置中声明连接后，其状态会显示在这里。" />}
    <section aria-label="MCP 连接列表" className="space-y-3">{resources.map(resource => <McpCard key={resource.id} resource={resource} data={data} sessionId={sessionId} />)}</section>
  </div>;
}
