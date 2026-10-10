import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Input';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { useCustomization, type CustomizationDescribe } from '../state/create';
import type { ResourceDescriptor } from '../../../customization/types';
import { ManagementConfirm } from './management-confirm';

const phases: Record<string, string> = { pending: '等待任务结束后加载', authorization: '待确认权限', draft: '待加载', load: '待加载', apply: '待应用', applied: '已应用', enabled: '可用', disabled: '已停用', available: '可用', error: '需要处理', shadowed: '被其他资源遮蔽', untrusted: '待授权' };
const scopes: Record<string, string> = { project: '当前项目', user: '用户范围', builtin: '内置' };
const kinds: Record<string, string> = { extension: '扩展', skill: '技能', rule: '规则', mcp: 'MCP 连接', doc: '资料', provider: '模型提供商', workflow: '工作流', panel: '面板' };

function ResourceCard({ resource, data, sessionId }: { resource: ResourceDescriptor; data: CustomizationDescribe; sessionId?: string }) {
  const abilities = data.abilities.filter(ability => ability.resourceId === resource.id && ability.revision === resource.hash && !ability.candidateId);
  const required = [...new Set(abilities.flatMap(ability => ability.required))], granted = [...new Set(abilities.flatMap(ability => ability.granted))];
  const active = data.activeResources.find(item => item.id === resource.id), mutable = resource.scope !== 'builtin' && !['error', 'shadowed'].includes(resource.status);
  return <article aria-label={`资源 ${resource.name}`} className="space-y-3 rounded-xl border border-line p-4">
    <div className="flex flex-wrap items-center gap-2"><h2 className="break-all text-base font-semibold">{resource.name}</h2><Badge state={['untrusted','error'].includes(resource.status) ? 'warning' : 'default'}>{phases[resource.status] ?? resource.status}</Badge></div>
    <p className="text-xs text-muted">{scopes[resource.scope]} · {kinds[resource.kind]}</p>
    {resource.description && <p className="break-words text-sm">{resource.description}</p>}
    {!!abilities.length && <ul aria-label="资源能力" className="list-none space-y-1 p-0 text-sm">{abilities.map(ability => <li key={ability.key} className="break-words">{ability.name} · {ability.type} · {phases[ability.phase] ?? ability.phase}{ability.error && <p role="alert" className="text-danger">{ability.error}</p>}</li>)}</ul>}
    {resource.error && <p role="alert" className="break-all text-sm text-danger">{resource.error}</p>}
    <details className="break-all text-xs"><summary className="cursor-pointer">来源、版本与权限</summary><div className="mt-2 space-y-2"><p>来源 {resource.source}</p><p>发现版本 {resource.hash}</p><p>活动版本 {active?.hash ?? '未加载'}</p>{resource.shadowedBy && <p>遮蔽来源 {resource.shadowedBy}</p>}<p>请求权限 {required.join('、') || '未声明额外能力'}</p><p>已授权 {granted.join('、') || '无'}</p>
      {abilities.flatMap(ability => ability.evidence.map((evidence, index) => <p key={`${ability.key}:${index}`}>{evidence.stage} · {evidence.status ?? (evidence.passed === true ? '通过' : evidence.passed === false ? '未通过' : '已记录')} · {evidence.at}</p>))}
      {abilities.some(ability => ability.previousEvidence?.length) && <p>存在旧版本验证；不计入当前版本。</p>}
    </div></details>
    <div className="flex flex-wrap gap-2">
      {mutable && resource.status === 'enabled' && <ManagementConfirm label="停用并撤销授权" dangerous sessionId={sessionId} description="停用此资源的全部能力；运行期间按服务端收据等待生效。" review={() => ({ request: { action: 'set', id: resource.id, enabled: false, trusted: false, revision: data.settingsRevision }, detail: <><p>{resource.name} · {resource.hash}</p><p>授权修订 {data.settingsRevision}</p></> })} />}
      {mutable && (resource.status !== 'enabled' || active?.hash !== resource.hash || abilities.some(ability => ability.missing.length)) && <ManagementConfirm label="授权并启用资源" sessionId={sessionId} disabled={!sessionId} description="授权适用于此版本内全部能力。本地扩展具有本机权限；直接调用 Node API 的行为不保证被记录。" review={() => ({ request: { action: 'authorize-version', id: resource.id, contentHash: resource.hash, revision: data.settingsRevision }, detail: <><p>{resource.name} · {resource.hash}</p><p>来源 {resource.source}</p><p>权限 {required.join('、') || '未声明额外能力'}</p><p>授权修订 {data.settingsRevision}</p></> })} />}
      {resource.kind === 'extension' && <ManagementConfirm label="静态校验资源" sessionId={sessionId} disabled={!sessionId || data.busy} description="仅显式执行类型与契约检查，不运行扩展工厂。" review={() => ({ request: { action: 'validate', id: resource.id }, detail: <p>{resource.name} · {resource.hash}</p> })} />}
    </div>
  </article>;
}

export function ResourcesPage({ sessionId }: { sessionId?: string }) {
  const query = useCustomization(sessionId), [scope, setScope] = useState('all'), [kind, setKind] = useState('all');
  if (query.isPending) return <EmptyState title="正在读取能力与权限…" busy />;
  if (!query.data) return <ErrorState title="能力目录不可读" detail={String(query.error)} actions={<Button onClick={() => void query.refetch()}>重新读取能力目录</Button>} />;
  const data = query.data, resources = data.resources.filter(resource => (scope === 'all' || resource.scope === scope) && (kind === 'all' || resource.kind === kind));
  return <div className="min-w-0"><header className="sticky top-0 z-10 space-y-3 bg-background pb-3"><h1 className="text-xl">能力与权限</h1><div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => void query.refetch()}>刷新能力目录</Button>{!sessionId && <Link className="text-sm underline" to="/create">选择创造目标</Link>}</div>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs">资源范围<Select aria-label="资源范围" value={scope} onChange={event => setScope(event.target.value)}><option value="all">全部范围</option>{Object.entries(scopes).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select></label><label className="text-xs">资源类型<Select aria-label="资源类型" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部类型</option>{Object.entries(kinds).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select></label></div>
    </header>
    {!sessionId && <p className="my-3 text-sm">当前为项目只读目录与撤销入口。授权、校验与重载需要先选择绑定的创造目标。</p>}
    {query.isError && <p role="alert" className="text-danger">刷新失败，保留上次快照：{String(query.error)}</p>}{data.degraded && <p role="alert" className="break-words text-danger">{data.degraded}</p>}{data.busy && <p role="status">任务运行中，变更以加载收据为准。</p>}
    <section aria-label="资源管理" className="my-3 flex flex-wrap gap-3">
      <ManagementConfirm label="重新加载资源" disabled={!sessionId || data.busy} sessionId={sessionId} description="重新发现并加载已授权的资源；可能初始化本地扩展代码及连接。未授权的资源不会自动获权。" review={() => ({ request: { action: 'reload' }, detail: <p>目标：{sessionId ?? '当前项目'}；此操作不会发起模型任务。</p> })} />
      <ManagementConfirm label={data.userWrites ? '撤销用户目录写入' : '允许用户目录写入'} dangerous={data.userWrites} disabled={!sessionId} sessionId={sessionId} description="更改此项目对用户定制目录的写入授权；用户资源可被其他项目使用。" review={() => ({ request: { action: 'user-writes', enabled: !data.userWrites, revision: data.settingsRevision }, detail: <p>当前状态：{data.userWrites ? '已允许' : '未允许'}；授权修订 {data.settingsRevision}</p> })} />
    </section>
    {!resources.length && <EmptyState title="此范围暂无资源" detail="更改筛选或在独立开发目标准备资源；查看目录不会执行候选。" />}
    <section aria-label="能力目录" className="space-y-3">{resources.map(resource => <ResourceCard key={resource.id} resource={resource} data={data} sessionId={sessionId} />)}</section>
    <details className="my-4 break-all text-xs"><summary>加载记录与诊断</summary>{!data.receipts.length && <p>尚无加载收据。</p>}{data.receipts.slice(-10).map(receipt => <p key={receipt.id}>{receipt.id} · {receipt.status}{receipt.error && ` · ${receipt.error}`}</p>)}</details>
  </div>;
}
