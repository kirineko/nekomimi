import { useState } from 'react';
import type { Management, ManagementAction } from './types';
const phases: Record<string,string> = {pending:'等待任务结束后加载',authorization:'待确认权限',draft:'待加载',load:'待加载',apply:'待应用',applied:'已应用',enabled:'可用',disabled:'已停用',available:'可用',error:'需要处理',shadowed:'已被覆盖'};
const types: Record<string,string> = {themes:'主题',commands:'命令',panels:'面板',views:'视图',workflows:'工作流',tools:'工具',providers:'模型提供商',skill:'技能',rule:'规则',mcp:'连接'};
export function AbilityCards({data,sessionId,busy,action,onManage,onSource,target}:{target?:{resourceId:string;revision:string};data:Management;sessionId?:string;busy:boolean;action:ManagementAction;onManage:()=>void;onSource?: (id:string)=>void}) {
 const [scope,setScope]=useState(target?'all':'project'),[type,setType]=useState('all'),[confirm,setConfirm]=useState<string>();
 const [filterTarget,setFilterTarget]=useState(target);
 const items=(data.abilities ?? []).filter(a => (!filterTarget||a.resourceId===filterTarget.resourceId)&&(scope==='all'||scope==='project'&&a.scope==='project'||scope==='user'&&a.scope==='user'||scope==='session'&&!!sessionId&&a.relatedSessions?.includes(sessionId))&&(type==='all'||a.type===type));
 return <section aria-label="我的定制">
  <div className="customization-section-heading"><div><h3>我的定制</h3><p>会话里创造的灵感，都在这里。</p></div><button onClick={onManage}>管理资源</button></div>
  {filterTarget&&<p role="status">{!(data.abilities??[]).some(a=>a.resourceId===filterTarget.resourceId&&a.revision===filterTarget.revision)?'历史版本已更新或不可用，下面显示当前可管理内容。':'已核对当前资源版本。'}<button onClick={()=>setFilterTarget(undefined)}>查看全部定制</button></p>}
  <div className="ability-filters" role="group" aria-label="定制范围">{[['session','本会话'],['project','当前项目'],['user','用户级'],['all','全部']].map(([id,label])=><button key={id} aria-pressed={scope===id} onClick={()=>setScope(id!)}>{label}</button>)}</div>
  <div className="ability-filters" role="group" aria-label="能力类型"><button aria-pressed={type==='all'} onClick={()=>setType('all')}>所有类型</button>{[...new Set((data.abilities??[]).map(a=>a.type))].map(t=><button key={t} aria-pressed={type===t} onClick={()=>setType(t)}>{types[t]??'扩展能力'}</button>)}</div>
  {!items.length&&<p className="customization-empty">这里还没有定制能力。可在对话中描述想要的风格或功能。</p>}
  <div className="ability-grid">{items.map(a=><article className="ability-card" key={a.key}>
   <div className="ability-heading"><strong>{a.name}</strong><span>{types[a.type]??'扩展能力'}</span></div>
   <small className="ability-scope">{a.scope==='user'?'用户级 · 跨项目可用':'项目级 · 仅当前项目'}</small>
   <p className={`ability-phase phase-${a.phase}`}>{phases[a.phase]??a.phase}</p>
   <small>{a.source ? `${a.source.stage==='created'?'会话创建':'会话更新'} · ${new Date(a.source.at).toLocaleString()}` : '创建来源未知'}{!a.source&&a.updatedAt?` · 更新于 ${new Date(a.updatedAt).toLocaleString()}`:''}</small>
   {a.source?.sessionId&&onSource&&<button disabled={!a.sourceAvailable} onClick={()=>onSource(a.source!.sessionId!)}>{a.sourceAvailable?"来源会话":"来源会话已不可访问"}</button>}
   {a.phase==='authorization' ? <><button disabled={busy} onClick={()=>setConfirm(a.key)}>查看所需权限</button>{confirm===a.key&&<div className="customization-notice"><p>此资源新增：{a.missing.join('、')||'本地代码执行'}。授权适用于资源内全部能力，本地代码具有本机权限。</p><button disabled={busy} onClick={()=>void action(a.candidateId?{action:'candidate-activate',id:a.candidateId,contentHash:a.revision,authorize:true,revision:data.settingsRevision}:{action:'authorize-version',id:a.resourceId,contentHash:a.revision,revision:data.settingsRevision}).then(()=>setConfirm(undefined))}>确认授权</button><button onClick={()=>setConfirm(undefined)}>取消</button></div>}</> : a.type==='themes'&&a.localId ? <button onClick={()=>window.dispatchEvent(new CustomEvent('nekomimi-theme-open',{detail:{resourceId:a.resourceId,revision:a.revision,id:a.localId}}))}>预览与应用</button> : <button onClick={onManage}>打开管理</button>}
   <details><summary>版本与验证</summary><p>发现版本 {a.revision.slice(0,12)} · 活动版本 {a.activeRevision?.slice(0,12)??'未加载'}</p><p>宿主验收：{a.evidence.some(e=>e.stage==='host'&&e.passed)?'通过':'未验证'}</p>{a.evidence.map((e,i)=><p key={i}>{e.stage} · {e.passed===undefined?'已记录':e.passed?'通过':'未通过'}</p>)}{a.previousEvidence?.map((e,i)=><p key={`old-${i}`}>旧版本或宿主 {e.revision.slice(0,8)} · {e.stage}（不代表当前版本）</p>)}{a.error&&<p>{a.error}</p>}</details>
  </article>)}</div>
 </section>;
}
