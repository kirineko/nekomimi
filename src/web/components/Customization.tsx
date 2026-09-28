import { AbilityCards } from './customization/AbilityCards';
import type { Management } from "./customization/types";
import { CustomizationShell, CategoryPanel, type Category } from "./customization/Shell";
import { ModelSettings } from "./customization/ModelSettings";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelManagement, CustomPanel, type PanelView, type PanelMount } from "./CustomPanel";
import { api } from "../api";
import { WorkflowManagement } from "./WorkflowManagement";
import type {
  Contribution,
} from "../../customization/types";
interface CandidatePreview {
  id: string; name: string; contentHash: string; previousRevision?: string;
  addedCapabilities: string[]; requestedCapabilities: string[];
  report: { passed: boolean; diagnostics: { stage: string; file?: string; line?: number; column?: number; message: string }[] };
  files: { name: string; change: string; before?: string; after?: string; truncated: boolean }[];
}
interface PackagePreview {
  candidate: { id: string; scope: string; revision: string; manifest: { name: string } };
  passed: boolean; addedPermissions: string[]; changedFiles: number;
  checks: CandidatePreview["report"][];
  files: { name: string; preview?: string }[];
}
const labels: Record<string, string> = {
  enabled: "已启用",
  disabled: "已停用",
  untrusted: "待授权",
  shadowed: "已被覆盖",
  error: "错误",
  available: "可用",
  pending: "待生效",
  activated: "已生效",
  failed: "失败",
};
export function Customization({ close, sessionId, branched, target }: { target?: {resourceId:string;revision:string}; close: () => void; sessionId?: string; branched?: (id: string) => void }) {
  const [data, setData] = useState<Management>();
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [feedbackTarget,setFeedbackTarget] = useState<{category:Category;id?:string;revision?:string}>();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CandidatePreview>();
  const [panelProps,setPanelProps]=useState("{}");
  const [candidatePanel,setCandidatePanel]=useState<{panel:PanelView;frame:PanelMount;props:string}>();
  const [packagePreview, setPackagePreview] = useState<PackagePreview>();
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [category, setCategory] = useState<Category>("mine");
  const [modelIssue, setModelIssue] = useState(false);
  const [loadError, setLoadError] = useState("");
  const refreshSequence = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++refreshSequence.current;
    const snapshot = await api<Management>("/customization", undefined, signal);
    if (sequence === refreshSequence.current && !signal?.aborted) { setData(snapshot); setLoadError(""); }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh(c.signal);
      } catch (e) {
        if (!c.signal.aborted) setLoadError(String(e));
      }
      if (!c.signal.aborted) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  const action = async (value: object) => {
    const target = value as {id?:string};
    setFeedbackTarget({category,id:target.id,revision:data?.resources.find(r => r.id === target.id)?.hash});
    setBusy(true);
    setError(""); setResult("");
    try {
      const r = await api<{ errors?: string[]; authorizationUrl?: string; path?: string; sessionId?: string }>("/customization", value);
      if (r.errors) setResult(r.errors.join("\n") || "静态校验通过");
      if (r.authorizationUrl) setAuthorizationUrl(r.authorizationUrl);
      if (r.path) setResult(`已导出：${r.path}`);
      if (r.sessionId) { branched?.(r.sessionId); return; }
      await refresh();
      return r;
    } catch (e) {
      setError(String(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const inspect = async (id: string) => {
    setFeedbackTarget({category:"resources",id}); setBusy(true); setError(""); setPreview(undefined);
    try { setPreview(await api<CandidatePreview>("/customization", { action: "candidate-inspect", id })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const inspectPackage = async (id: string, scope: string) => {
    setFeedbackTarget({category:"packages",id}); setBusy(true); setError(""); setPackagePreview(undefined);
    try { setPackagePreview(await api<PackagePreview>("/customization", { action: "package-inspect", id, scope })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return (
    <CustomizationShell close={close} category={category} onCategory={setCategory} data={data} modelIssue={modelIssue}>
      <div className="customization-feedback">
        {!data && !loadError && <p role="status">正在整理你的定制能力…</p>}
        {loadError && <p role="alert">加载失败：{loadError} <button onClick={() => void refresh().catch(e => setLoadError(String(e)))}>重试加载</button></p>}
        {data?.busy && <p role="status">任务运行中，资源变更将在任务结束后生效。</p>}
        {data?.degraded && <p role="alert">{data.degraded}</p>}
        {error && <p role="status">操作未完成 <button onClick={() => setCategory(feedbackTarget?.category ?? "resources")}>查看详情</button></p>}

      </div>
      <CategoryPanel id="mine" active={category}>
        {feedbackTarget?.category==='mine' && error && <p role="alert">{error}</p>}
        {data && <AbilityCards target={target} data={data} sessionId={sessionId} busy={busy} action={action} onManage={() => setCategory('resources')} onSource={branched} />}
      </CategoryPanel>
      <CategoryPanel id="models" active={category}>
        {feedbackTarget?.category==='models' && error && <p role="alert">{error}</p>}
        {data && <ModelSettings onIssue={setModelIssue} active={category === "models"} data={data} busy={busy} action={action} refresh={refresh} sessionId={sessionId} onResources={() => setCategory("resources")} />}
      </CategoryPanel>
      <CategoryPanel id="resources" active={category}>
        {error && (feedbackTarget?.category??'resources')==='resources' && !data?.resources.some(r=>r.id===feedbackTarget?.id) && <p role="alert">{error}</p>}
        {!!data?.receipts.length && <details className="customization-disclosure"><summary>加载记录</summary>{data.receipts.slice(-10).map(r => <p key={r.id}>重载：{labels[r.status] ?? r.status} {r.error}</p>)}</details>}
        {result && !feedbackTarget?.id && feedbackTarget?.category === category && <p role="status">{result}<button onClick={() => setResult('')}>关闭提示</button></p>}
        <div className="customization-section-heading"><div><h3>我的资源</h3><p>为你的搭档，添一点新本领。</p></div>
          <button disabled={busy || !data} onClick={() => void action({ action: "reload" })}>重新加载资源</button>
        </div>
        <p className="customization-notice">本地扩展具有本机权限。宿主操作有记录，直接调用 Node API 的行为不保证被记录。项目扩展和连接须先授权。</p>
        <details className="customization-disclosure"><summary>用户目录写入授权</summary>
        {data && (
          <button
            disabled={busy}
            onClick={() =>
              void action({
                action: "user-writes",
                enabled: !data.userWrites,
                revision: data.settingsRevision,
              })
            }
          >
            {data.userWrites
              ? "撤销用户资源写入授权"
              : "允许此项目写入用户定制目录"}
          </button>
        )}
        </details>
        {authorizationUrl && <p><a href={authorizationUrl} target="_blank" rel="noreferrer noopener">打开 MCP 授权页面</a>（五分钟内有效）</p>}
        {!!data?.oauth?.length && <section aria-label="MCP 授权">
          <h3>MCP 授权</h3>
          {data.oauth.map(o => <article key={o.server}>
            <p>{data.resources.find(r => r.id === o.server)?.name ?? o.server} · {o.status} · {o.issuer}</p>
            <button disabled={busy || o.status === "authorizing"} onClick={() => void action({ action: "mcp-authorize", id: o.server })}>授权 MCP {data.resources.find(r => r.id === o.server)?.name}</button>
            <button className="customization-danger" disabled={busy} onClick={() => void action({ action: "mcp-disconnect", id: o.server })}>断开 MCP 授权</button>
          </article>)}
        </section>}
        {!!data?.candidates?.length && <section aria-label="候选版本">
          <h3>候选版本</h3>
          {data.candidates.map(id => <button key={id} disabled={busy} onClick={() => void inspect(id)}>检查候选 {id}</button>)}
          {preview && <article>
            <h4>{preview.name}</h4>
            <p>候选版本 {preview.contentHash.slice(0, 12)} · 当前版本 {preview.previousRevision?.slice(0, 12) ?? "未激活"}</p>
            <p role="status">{preview.report.passed ? "完整类型检查通过" : "类型检查未通过"}</p>
            <p>请求能力：{preview.requestedCapabilities.join(", ") || "无"}。新增授权：{preview.addedCapabilities.join(", ") || "无"}。</p>
            {preview.report.diagnostics.map((d, i) => <p key={i} role="alert">{d.file}:{d.line}:{d.column} · {d.stage} · {d.message}</p>)}
            {preview.files.map(file => <details key={file.name}><summary>{file.change}: {file.name}</summary>
              {file.before !== undefined && <><p>原内容</p><pre>{file.before}</pre></>}
              {file.after !== undefined && <><p>候选内容</p><pre>{file.after}</pre></>}
              {file.truncated && <p>预览已截断，请打开候选源文件查看全文。</p>}
            </details>)}
            {preview.requestedCapabilities.includes('panels')&&<><label>候选面板数据 JSON<textarea aria-label="候选面板数据 JSON" value={panelProps} onChange={e=>setPanelProps(e.target.value)}/></label><p>预览会在独立进程执行可信 Node 工厂；面板桥接动作禁用，活动版本不变。</p><button disabled={busy||!preview.report.passed} onClick={()=>{void Promise.resolve().then(()=>api<{panel:PanelView;frame:PanelMount}>("/customization",{action:'candidate-panel-preview',id:preview.id,contentHash:preview.contentHash,props:JSON.parse(panelProps),authorize:true})).then(result=>setCandidatePanel({...result,props:panelProps})).catch(e=>setError(String(e)));}}>授权执行候选工厂并预览面板</button></>}
            {candidatePanel&&<CustomPanel key={candidatePanel.frame.instanceId} panel={candidatePanel.panel} propsJson={candidatePanel.props} prepared={candidatePanel.frame} preview/>}
            <button disabled={busy || !preview.report.passed} onClick={() => void action({ action: "candidate-activate", id: preview.id, contentHash: preview.contentHash, authorize: true, revision: data?.settingsRevision })}>授权并启用此版本</button>
          </article>}
          {data.managed?.filter(entry => entry.previous).map(entry => <button key={entry.name} disabled={busy} onClick={() => void action({ action: "candidate-rollback", name: entry.name, authorize: true })}>回退 {entry.name} 到 {entry.previous!.slice(0, 12)}</button>)}
        </section>}
        {data?.resources.map((r) => (
          <article className="customization-resource" key={r.id}>
            <h3>
              {r.name} <small>{r.kind}</small>
            </h3>
            <p>
              {r.scope === "project"
                ? "项目"
                : r.scope === "user"
                  ? "用户"
                  : "内置"}{" "}
              <span className="customization-state" data-state={r.status}>{labels[r.status] ?? r.status}</span>
            </p>
            {r.error && <p role="alert">{r.error}</p>}
            {!!data.mcp?.find(m => m.id === r.id)?.toolErrors.length && <p role="alert">工具诊断异常，请展开资源详情。</p>}
            {data.busy && <p role="status">配置待生效</p>}
            <details><summary>资源详情 · 来源与诊断</summary>
            <code>{r.source}</code>
            {r.description && <p>{r.description}</p>}
            <p>
              发现版本 {r.hash.slice(0, 12)} · 当前版本{" "}
              {data.activeResources
                .find((a) => a.id === r.id)
                ?.hash.slice(0, 12) ?? "未激活"}
            </p>
            {data.mcp
              ?.find((m) => m.id === r.id)
              ?.toolErrors.map((t) => (
                <p key={t.name} role="alert">
                  {t.name}: {t.error}
                </p>
              ))}
            {r.shadowedBy && <p>由 {r.shadowedBy} 覆盖</p>}
            </details>
            {error && feedbackTarget?.id === r.id && <p role="alert">{error}</p>}
            {result && feedbackTarget?.id === r.id && <p role="status">{feedbackTarget.revision !== r.hash ? '旧版本结果：' : ''}{result}<button onClick={() => setResult('')}>关闭提示</button></p>}
            {r.kind === "extension" && (
              <button
                disabled={busy}
                onClick={() => void action({ action: "validate", id: r.id })}
              >
                静态校验 {r.name}
              </button>
            )}
            {!["shadowed", "error"].includes(r.status) &&
              r.scope !== "builtin" && (
                <button
                  className={r.status === "enabled" ? "customization-danger" : undefined}
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: "set",
                      id: r.id,
                      revision: data.settingsRevision,
                      enabled: r.status !== "enabled",
                      trusted: r.status !== "enabled",
                    })
                  }
                >
                  {r.status === "enabled"
                    ? "停用并撤销授权"
                    : r.status === "untrusted"
                      ? "信任并启用"
                      : "启用"}{" "}
                  {r.name}
                </button>
              )}
          </article>
        ))}
        {data && !data.resources.length && (
          <p>
            尚未发现资源。在项目 .nekomimi/extensions 或 .agents/skills
            中创建定制内容。
          </p>
        )}
      </CategoryPanel>
      <CategoryPanel id="packages" active={category}>
        {feedbackTarget?.category==='packages' && (error||result) && <p role={error?'alert':'status'}>{error||result}<button onClick={()=>{setResult('');setError('');}}>关闭提示</button></p>}
        <div className="customization-section-heading"><div><h3>能力包</h3><p>把喜欢的能力，收进工具箱。</p></div></div>
        <p className="customization-notice">能力包中的本地扩展具有本机权限；宿主操作有记录，直接 Node API 行为不保证被记录。安装与回退需显式授权。</p>
        {!!data?.packageCandidates?.length && <section aria-label="能力包候选">
          <h3>能力包候选</h3>
          {data.packageCandidates.map(p => <button key={p.id} disabled={busy} onClick={() => void inspectPackage(p.id, p.scope)}>检查能力包 {p.name} · {p.revision.slice(0, 12)}</button>)}
          {packagePreview && <article>
            <h4>{packagePreview.candidate.manifest.name}</h4>
            <p role="status">{packagePreview.passed ? "能力包检查通过" : "能力包检查未通过"}</p>
            <p>新增授权：{packagePreview.addedPermissions.join(", ") || "无"}。变更文件：{packagePreview.changedFiles}。</p>
            {packagePreview.checks.flatMap(c => c.diagnostics).map((d, i) => <p key={i} role="alert">{d.file}:{d.line}:{d.column} · {d.message}</p>)}
            {packagePreview.files.map(f => <details key={f.name}><summary>{f.name}</summary><pre>{f.preview ?? "文件删除或非文本内容"}</pre></details>)}
            <p>文本预览最多显示每个文件的前 4000 字符。</p>
            <button disabled={busy || !packagePreview.passed} onClick={() => void action({ action: "package-activate", id: packagePreview.candidate.id, scope: packagePreview.candidate.scope, authorize: true })}>授权并安装能力包</button>
          </article>}
        </section>}
        {!!data?.packages?.length && <section aria-label="已安装能力包">
          <h3>已安装能力包</h3>
          {data.packages.map(p => <article key={p.packageId}>
            <h4>{p.manifest.name} {p.manifest.version}</h4>
            <p>{p.scope === "project" ? "项目" : "用户"} · {p.revision.slice(0, 12)}</p>
            <details><summary>管理能力包</summary>
            {p.previous && <button disabled={busy} onClick={() => void action({ action: "package-rollback", id: p.packageId, scope: p.scope, authorize: true })}>回退能力包 {p.manifest.name}</button>}
            <button disabled={busy} onClick={() => void action({ action: "package-export", id: p.packageId, scope: p.scope, output: `${p.manifest.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${p.revision.slice(0, 12)}.tgz` })}>导出能力包到工作区</button>
            <button className="customization-danger" disabled={busy} onClick={() => void action({ action: "package-uninstall", id: p.packageId, scope: p.scope })}>卸载能力包 {p.manifest.name}</button></details>
          </article>)}
        </section>}
        {data && !data.packages?.length && !data.packageCandidates?.length && <p className="customization-empty">还没有能力包。准备好的候选会出现在这里。</p>}
      </CategoryPanel>
      <CategoryPanel id="workflows" active={category}>
        {feedbackTarget?.category==='workflows' && error && <p role="alert">{error}</p>}
        <div className="customization-section-heading"><div><h3>工作流与面板</h3><p>让重复的事情，有自己的节奏。</p></div></div>
        {data && <PanelManagement panels={data.panels ?? []} flows={data.workflows ?? []} />}
        {data && <WorkflowManagement flows={data.workflows ?? []} definitions={data.workflowDefinitions ?? []} busy={busy} action={action} />}
      </CategoryPanel>
    </CustomizationShell>
  );
}
