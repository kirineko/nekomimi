import { useCallback, useEffect, useRef, useState } from "react";
import { PanelManagement, CustomPanel, type PanelView, type PanelMount } from "./CustomPanel";
import { api } from "../api";
import { WorkflowManagement, type WorkflowView, type WorkflowDefinitionView } from "./WorkflowManagement";
import type {
  ResourceDescriptor,
  Contribution,
} from "../../customization/types";
interface Management {
  panels: PanelView[];
  workflows: WorkflowView[];
  workflowDefinitions: WorkflowDefinitionView[];
  providers: { id: string; resourceId?: string; revision: string; models: { id: string; name: string; protocol: string }[] }[];
  providerProfiles: { revision: number; entries: Record<string, { id: string; providerId: string; model: string; baseUrl: string }>; selection: { main?: string; auxiliary?: string; naming?: string } };
  oauth: { server: string; status: string; issuer?: string; clientId?: string }[];
  packages: { packageId: string; scope: "project" | "user"; revision: string; previous?: string; manifest: { name: string; version: string } }[];
  packageCandidates: { id: string; scope: "project" | "user"; name: string; revision: string }[];
  candidates: string[];
  managed: { name: string; revision: string; previous?: string }[];
  resources: ResourceDescriptor[];
  userWrites: boolean;
  settingsRevision: number;
  activeRevision?: string;
  busy: boolean;
  degraded?: string;
  mcp: {
    id: string;
    diagnostics: string;
    toolErrors: { name: string; error: string }[];
  }[];
  activeResources: ResourceDescriptor[];
  receipts: { id: string; status: string; error?: string }[];
}
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
export function Customization({ close, sessionId, branched }: { close: () => void; sessionId?: string; branched?: (id: string) => void }) {
  const [data, setData] = useState<Management>();
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CandidatePreview>();
  const [panelProps,setPanelProps]=useState("{}");
  const [candidatePanel,setCandidatePanel]=useState<{panel:PanelView;frame:PanelMount;props:string}>();
  const [packagePreview, setPackagePreview] = useState<PackagePreview>();
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [profileId, setProfileId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [providerPaths, setProviderPaths] = useState("/responses");
  const [providerKey, setProviderKey] = useState("");
  const [omitReasoning, setOmitReasoning] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setData(await api<Management>("/customization", undefined, signal));
  }, []);
  useEffect(() => {
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh(c.signal);
      } catch (e) {
        if (!c.signal.aborted) setError(String(e));
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
    setBusy(true);
    setError("");
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
    } finally {
      setBusy(false);
    }
  };
  const inspect = async (id: string) => {
    setBusy(true); setError(""); setPreview(undefined);
    try { setPreview(await api<CandidatePreview>("/customization", { action: "candidate-inspect", id })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const inspectPackage = async (id: string, scope: string) => {
    setBusy(true); setError(""); setPackagePreview(undefined);
    try { setPackagePreview(await api<PackagePreview>("/customization", { action: "package-inspect", id, scope })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const saveProfile = async () => {
    const provider = data?.providers.find(p => p.id === providerId);
    if (!provider?.resourceId || !data) return;
    setBusy(true); setError("");
    try {
      if (providerKey) await api("/customization", { action: "provider-credential", ref: profileId, secret: providerKey });
      await api("/customization", { action: "provider-save", revision: data.providerProfiles.revision, profile: { id: profileId, providerId, resourceId: provider.resourceId, model: modelId, baseUrl: providerUrl, paths: providerPaths.split(",").map(p => p.trim()), ...(providerKey ? { credentialRef: profileId } : {}) } });
      setProviderKey(""); setResult("模型配置已保存；选择用途后生效。"); await refresh();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="settings-panel customization-panel"
        role="dialog"
        aria-modal="true"
        aria-label="定制能力"
      >
        <header>
          <h2>定制能力</h2>
          <button onClick={close} aria-label="关闭定制能力">
            关闭
          </button>
        </header>
        <p>扩展、技能、规则与 MCP。项目中的可执行扩展和连接须先授权启用。</p>
        <p>
          本地扩展是可信代码，具有本机权限；通过宿主执行的操作有记录，直接调用
          Node API 的行为不保证被记录。
        </p>
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
        <button
          disabled={busy}
          onClick={() => void action({ action: "reload" })}
        >
          重新加载资源
        </button>
        {data?.busy && <p>任务运行中，资源变更将在任务结束后生效。</p>}
        {(error || data?.degraded) && (
          <p role="alert">{error || data?.degraded}</p>
        )}
        {result && <p role="status">{result}</p>}
        {authorizationUrl && <p><a href={authorizationUrl} target="_blank" rel="noreferrer noopener">打开 MCP 授权页面</a>（五分钟内有效）</p>}
        {!!data?.oauth?.length && <section aria-label="MCP 授权">
          <h3>MCP 授权</h3>
          {data.oauth.map(o => <article key={o.server}>
            <p>{data.resources.find(r => r.id === o.server)?.name ?? o.server} · {o.status} · {o.issuer}</p>
            <button disabled={busy || o.status === "authorizing"} onClick={() => void action({ action: "mcp-authorize", id: o.server })}>授权 MCP {data.resources.find(r => r.id === o.server)?.name}</button>
            <button disabled={busy} onClick={() => void action({ action: "mcp-disconnect", id: o.server })}>断开 MCP 授权</button>
          </article>)}
        </section>}
        {data?.receipts.slice(-3).map((r) => (
          <p key={r.id} role="status">
            重载：{labels[r.status] ?? r.status} {r.error}
          </p>
        ))}
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
            <button disabled={busy || !preview.report.passed} onClick={() => void action({ action: "candidate-activate", id: preview.id, contentHash: preview.contentHash, authorize: true })}>授权并启用此版本</button>
          </article>}
          {data.managed?.filter(entry => entry.previous).map(entry => <button key={entry.name} disabled={busy} onClick={() => void action({ action: "candidate-rollback", name: entry.name, authorize: true })}>回退 {entry.name} 到 {entry.previous!.slice(0, 12)}</button>)}
        </section>}
        {data?.providerProfiles && <section aria-label="模型提供商">
          <h3>模型提供商</h3>
          {sessionId && <div>
            <p>跨协议继续时可创建历史分支。原会话和原始证据会保留，工具不会重跑。</p>
            <label><input type="checkbox" checked={omitReasoning} onChange={e => setOmitReasoning(e.target.checked)} />允许新分支省略供应商专属 reasoning，保留其原始证据</label>
            <button disabled={busy || data.busy} onClick={() => void action({ action: "history-branch", sessionId, omitReasoning })}>创建跨 Provider 历史分支</button>
          </div>}
          {([['main', '主对话模型'], ['auxiliary', '辅助调用模型'], ['naming', '自动命名模型']] as const).map(([purpose, label]) => <label key={purpose}>{label}
            <select aria-label={label} disabled={busy} value={data.providerProfiles.selection[purpose] ?? ""} onChange={e => void action({ action: "provider-select", purpose, id: e.target.value, revision: data.providerProfiles.revision })}>
              <option value="">默认 DeepSeek（使用原设置）</option>
              {Object.values(data.providerProfiles.entries).map(p => <option key={p.id} value={p.id}>{p.id} · {p.providerId}/{p.model}</option>)}
            </select>
          </label>)}
          {!data.providerProfiles.entries['legacy-deepseek'] && <button disabled={busy} onClick={() => void action({ action: "provider-migrate", revision: data.providerProfiles.revision })}>备份并迁移原 DeepSeek 配置</button>}
          <form onSubmit={e => { e.preventDefault(); void saveProfile(); }}>
            <h4>添加自定义模型配置</h4>
            <label>配置名称<input aria-label="模型配置名称" value={profileId} onChange={e => setProfileId(e.target.value)} required pattern="[a-z][a-z0-9-]{0,47}" /></label>
            <label>Provider<select aria-label="自定义 Provider" value={providerId} required onChange={e => { setProviderId(e.target.value); const model = data.providers.find(p => p.id === e.target.value)?.models[0]; setModelId(model?.id ?? ""); setProviderPaths(model?.protocol === "chat-completions" ? "/chat/completions" : "/responses"); }}><option value="">选择已启用的 Provider</option>{data.providers.filter(p => p.resourceId).map(p => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label>
            <label>模型<select aria-label="自定义模型" value={modelId} required onChange={e => setModelId(e.target.value)}><option value="">选择模型</option>{data.providers.find(p => p.id === providerId)?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>服务地址<input aria-label="Provider 服务地址" type="url" required value={providerUrl} onChange={e => setProviderUrl(e.target.value)} placeholder="https://example.com/v1" /></label>
            <label>授权请求路径<input aria-label="Provider 请求路径" required value={providerPaths} onChange={e => setProviderPaths(e.target.value)} /></label>
            <label>API key（可选）<input aria-label="Provider API key" type="password" autoComplete="off" value={providerKey} onChange={e => setProviderKey(e.target.value)} /></label>
            <p>保存即授权此 Provider 使用上述端点。凭证只保存到服务端，不交给扩展。</p>
            <button disabled={busy || !providerId}>授权并保存模型配置</button>
          </form>
        </section>}
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
            {p.previous && <button disabled={busy} onClick={() => void action({ action: "package-rollback", id: p.packageId, scope: p.scope, authorize: true })}>回退能力包 {p.manifest.name}</button>}
            <button disabled={busy} onClick={() => void action({ action: "package-export", id: p.packageId, scope: p.scope, output: `${p.manifest.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${p.revision.slice(0, 12)}.tgz` })}>导出能力包到工作区</button>
            <button disabled={busy} onClick={() => void action({ action: "package-uninstall", id: p.packageId, scope: p.scope })}>卸载能力包 {p.manifest.name}</button>
          </article>)}
        </section>}
        {data && <PanelManagement panels={data.panels ?? []} flows={data.workflows ?? []} />}
        {data && <WorkflowManagement flows={data.workflows ?? []} definitions={data.workflowDefinitions ?? []} busy={busy} action={action} />}
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
              · {labels[r.status]}
            </p>
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
            {r.error && <p role="alert">{r.error}</p>}
            {r.shadowedBy && <p>由 {r.shadowedBy} 覆盖</p>}
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
      </section>
    </div>
  );
}
interface Item {
  id: string;
  runId: string;
  resourceId: string;
  value: Contribution;
}
export function ExtensionInteractions({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api<{ items: Item[] }>(
          `/sessions/${sessionId}/interactions`,
          undefined,
          c.signal,
        );
        setItems(r.items);
      } catch (e) {
        if (!c.signal.aborted) setError(String(e));
      }
      if (!c.signal.aborted) timer = setTimeout(poll, 800);
    };
    void poll();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [sessionId]);
  return (
    <section aria-label="扩展交互">
      {error && <p role="alert">{error}</p>}
      {items.map((item) => (
        <ExtensionForm
          key={item.id}
          item={item}
          sessionId={sessionId}
          done={() => setItems((old) => old.filter((i) => i.id !== item.id))}
        />
      ))}
    </section>
  );
}
function ExtensionForm({
  item,
  sessionId,
  done,
}: {
  item: Item;
  sessionId: string;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submission = useRef<{ payload: string; id: string }>(undefined);
  return (
    <form
      className="extension-form"
      onSubmit={(e) => {
        e.preventDefault();
        const answer = Object.fromEntries(new FormData(e.currentTarget));
        const payload = JSON.stringify(answer);
        if (submission.current?.payload !== payload)
          submission.current = { payload, id: crypto.randomUUID() };
        setBusy(true);
        setError("");
        void api(`/sessions/${sessionId}/answer`, {
          id: item.id,
          commandId: submission.current.id,
          answer,
        })
          .then(done)
          .catch((e) => setError(String(e)))
          .finally(() => setBusy(false));
      }}
    >
      <h3>{item.value.title}</h3>
      <p>{item.value.text}</p>
      {item.value.fields?.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.options ? (
            <select name={field.name} required={field.required} disabled={busy}>
              <option value="">请选择</option>
              {field.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              name={field.name}
              required={field.required}
              disabled={busy}
            />
          )}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>提交回答</button>
    </form>
  );
}
