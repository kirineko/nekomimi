import { useRef, useState } from "react";
import { api } from "../../api";
import { Choice } from "./Choice";
import type { Management, ManagementAction } from "./types";

const purposes = [
  ["main", "主对话模型", "与你思考、对话和执行任务", "✧"],
  ["auxiliary", "辅助调用模型", "为扩展中的辅助调用提供支持", "◇"],
  ["naming", "自动命名模型", "为每一次对话起个名字", "Aa"],
] as const;
const emptyDraft = { id: "", provider: "", model: "", url: "", paths: "/responses", key: "" };
export function ModelSettings({ data, busy, action, refresh, sessionId, onResources, active, onIssue }: {
  data: Management; busy: boolean; action: ManagementAction; refresh: () => Promise<void>;
  sessionId?: string; onResources: () => void; active: boolean; onIssue: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [result, setResult] = useState("");
  const reportError = (message: string) => { setError(message); onIssue(Boolean(message)); };
  const [credential, setCredential] = useState<string>();
  const [credentialUnknown, setCredentialUnknown] = useState(false);
  const [omitReasoning, setOmitReasoning] = useState(false);
  const submitLock = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const providers = data.providers.filter(p => p.resourceId);
  const provider = providers.find(p => p.id === draft.provider);
  const entries = Object.values(data.providerProfiles.entries);
  const options = [{ value: "", label: "默认 DeepSeek", description: "使用原设置" }, ...entries.map(p => ({ value: p.id, label: p.id, description: `${p.providerId} / ${p.model}` }))];
  const locked = busy || saving;
  const reset = () => { setDraft(emptyDraft); setCredential(undefined); setCredentialUnknown(false); setEditing(false); reportError(""); requestAnimationFrame(() => addButton.current?.focus()); };
  const save = async () => {
    if (submitLock.current || !provider?.resourceId || !provider.models.some(m => m.id === draft.model)) return;
    if (credentialUnknown && !draft.key) { reportError("上次凭证写入结果未知，请重新输入 API key 后显式保存。"); return; }
    submitLock.current = true; setSaving(true); reportError(""); setResult("");
    // Capture a single submitted draft; polling and navigation never mutate this request.
    const submitted = { ...draft };
    let credentialRef = credential;
    let stage: "credential" | "profile" | "refresh" = "profile";
    try {
      if (submitted.key) {
        stage = "credential";
        await api("/customization", { action: "provider-credential", ref: submitted.id, secret: submitted.key });
        credentialRef = submitted.id; setCredential(credentialRef); setCredentialUnknown(false);
      }
      stage = "profile";
      await api("/customization", { action: "provider-save", revision: data.providerProfiles.revision, profile: {
        id: submitted.id, providerId: submitted.provider, resourceId: provider.resourceId,
        model: submitted.model, baseUrl: submitted.url, paths: submitted.paths.split(",").map(path => path.trim()),
        ...(credentialRef ? { credentialRef } : {}),
      } });
      reset(); setResult("模型配置已保存；选择用途后生效。");
      stage = "refresh"; await refresh();
    } catch (cause) {
      if (stage === "credential") setCredentialUnknown(true);
      const message = String(cause).replaceAll(submitted.key || "\u0000", "[已隐藏]");
      reportError(stage === "refresh" ? `配置已提交，刷新失败，请重新加载查看：${message}` : `配置未确认保存：${message}${stage === "credential" ? "。凭证写入结果未确认，请重新输入后重试。" : ""}`);
      await refresh().catch(() => {});
    } finally {
      setDraft(old => ({ ...old, key: "" })); setSaving(false); submitLock.current = false;
    }
  };
  return <section aria-label="模型提供商">
    <div className="customization-section-heading"><div><h3>模型搭配 <span aria-hidden="true">✦</span></h3><p>选好搭档，让灵感轻轻落地。</p></div><button ref={addButton} className="customization-primary" disabled={locked || editing} onClick={() => { setEditing(true); setResult(""); }}>＋ 新增配置</button></div>
    <div className="customization-models">{purposes.map(([purpose, label, description, symbol]) => <div className="customization-model-row" key={purpose}>
      <span className={`customization-purpose-icon ${purpose}`} aria-hidden="true">{symbol}</span><div className="customization-purpose"><strong>{label}</strong><small>{description}</small></div>
      <Choice label={label} active={active} disabled={locked} value={data.providerProfiles.selection[purpose] ?? ""} options={options} onChange={id => { void action({ action: "provider-select", purpose, id, revision: data.providerProfiles.revision }); }} />
    </div>)}</div>
    {result && <p role="status">{result}</p>}
    {error && <p role="alert">{error}</p>}
    {editing && <section className="customization-editor" aria-label="添加自定义模型配置">
      <div className="customization-section-heading"><div><h4>添加自定义模型配置</h4><p>连接你喜欢的模型，组成新的搭配。</p></div><button type="button" disabled={saving} onClick={reset}>取消编辑</button></div>
      {!providers.length ? <div className="customization-empty"><p>还没有已启用的自定义 Provider。</p><button onClick={onResources}>前往资源，启用 Provider</button></div> : <form aria-label="模型配置" onInvalidCapture={event => {
        const input = event.target as HTMLInputElement;
        const details = input.closest("details");
        if (details) details.open = true;
        reportError(`请检查${input.getAttribute("aria-label") ?? "输入"}：${input.validationMessage}`);
      }} onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={locked}>
          <div className="customization-form-grid">
            <label>配置名称<input aria-label="模型配置名称" autoFocus value={draft.id} onChange={event => { setDraft(old => ({ ...old, id: event.target.value })); }} required pattern={"[a-z][a-z0-9\\-]{0,47}"} placeholder="例如 my-model" /><small>小写字母开头，可含数字和连字符。</small></label>
            <div className="customization-field"><span>Provider</span><Choice label="自定义 Provider" active={active} disabled={locked} value={draft.provider} placeholder="选择已启用的 Provider" options={providers.map(p => ({ value: p.id, label: p.id }))} onChange={id => {
              const model = providers.find(p => p.id === id)?.models[0];
              setDraft(old => ({ ...old, provider: id, model: model?.id ?? "", paths: model?.protocol === "chat-completions" ? "/chat/completions" : "/responses" }));
            }} /></div>
            <div className="customization-field"><span>模型</span><Choice label="自定义模型" active={active} disabled={locked || !provider} value={draft.model} placeholder="选择模型" options={(provider?.models ?? []).map(m => ({ value: m.id, label: m.name, description: m.id }))} onChange={id => {
              const model = provider?.models.find(m => m.id === id);
              setDraft(old => ({ ...old, model: id, paths: model?.protocol === "chat-completions" ? "/chat/completions" : "/responses" }));
            }} />{provider && !provider.models.length && <small>此 Provider 暂无可用模型。</small>}</div>
            <label>服务地址<input aria-label="Provider 服务地址" type="url" required value={draft.url} onChange={event => setDraft(old => ({ ...old, url: event.target.value }))} placeholder="https://example.com/v1" /></label>
            <label className="customization-full">API key <span className="customization-optional">可选 · 仅保存到服务端</span><input aria-label="Provider API key" type="password" autoComplete="off" value={draft.key} onChange={event => setDraft(old => ({ ...old, key: event.target.value }))} placeholder={credential ? "已提交凭证，留空保留该引用" : "输入密钥"} /></label>
          </div>
          <details className="customization-disclosure"><summary>高级请求设置</summary><label>授权请求路径<input aria-label="Provider 请求路径" required value={draft.paths} onChange={event => setDraft(old => ({ ...old, paths: event.target.value }))} /></label></details>
          <p className="customization-notice">保存即授权此 Provider 使用端点 <strong>{draft.url || "（请填写服务地址）"}</strong>，请求路径 <strong>{draft.paths || "（请填写请求路径）"}</strong>。凭证只保存到服务端，不交给扩展。</p>
          <button className="customization-primary" disabled={locked || !provider?.models.some(model => model.id === draft.model)} type="submit">{saving ? "正在保存…" : "授权并保存模型配置"}</button>
        </fieldset>
      </form>}
    </section>}
    <section className="customization-profiles" aria-label="已保存模型配置"><h4>已保存配置 <span>{entries.length}</span></h4>
      {entries.length ? <div className="customization-profile-grid">{entries.map(profile => <article key={profile.id}><span aria-hidden="true">◇</span><div><strong>{profile.id}</strong><small>{profile.providerId} / {profile.model}</small></div></article>)}</div> : <p className="customization-empty">默认 DeepSeek 已就位。也可以添加你喜欢的模型。</p>}
    </section>
    <details className="customization-disclosure"><summary>高级模型操作</summary>
      {!data.providerProfiles.entries["legacy-deepseek"] && <button disabled={locked} onClick={() => void action({ action: "provider-migrate", revision: data.providerProfiles.revision })}>备份并迁移原 DeepSeek 配置</button>}
      {sessionId && <div><p>跨协议继续时可创建历史分支。原会话和原始证据会保留，工具不会重跑。</p><label className="customization-check"><input type="checkbox" checked={omitReasoning} onChange={event => setOmitReasoning(event.target.checked)} />允许新分支省略供应商专属 reasoning，保留其原始证据</label><button disabled={locked || data.busy} onClick={() => void action({ action: "history-branch", sessionId, omitReasoning })}>创建跨 Provider 历史分支</button></div>}
    </details>
  </section>;
}
