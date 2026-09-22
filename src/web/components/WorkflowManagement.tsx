import { useRef, useState } from "react";
import { api } from "../api";
import type { Contribution } from "../../customization/types";
export interface WorkflowDefinitionView { resourceId: string; resourceName: string; id: string; revision: string; schemaVersion: number; entry: string; steps: string[]; inputSchema: unknown }
export interface WorkflowView { id: string; resourceId: string; definitionId: string; definitionRevision: string; schemaVersion: number; status: string; revision: number; step: string; wait?: { id: string; form: Contribution }; error?: string; outputPreview?: string }
type Action = (value: object) => Promise<unknown>;
const labels: Record<string, string> = { queued: "待执行", ready: "可继续", running: "执行中", unknown: "结果未知，需核对", waiting: "等待回答", completed: "已完成", cancelled: "已取消" };
function DurableForm({ flow, action, busy }: { flow: WorkflowView; action: Action; busy: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const commandId = useRef(crypto.randomUUID());
  return <form aria-label={flow.wait!.form.title} onSubmit={e => { e.preventDefault(); void action({ action: "workflow-answer", id: flow.id, revision: flow.revision, waitId: flow.wait!.id, commandId: commandId.current, answer: values, resume: true }); }}>
    <h5>{flow.wait!.form.title}</h5><p>{flow.wait!.form.text}</p>
    {flow.wait!.form.fields?.map(field => <label key={field.name}>{field.label}{field.options ? <select aria-label={field.label} required={field.required} value={values[field.name] ?? ""} onChange={e => setValues(old => ({ ...old, [field.name]: e.target.value }))}><option value="">请选择</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : <input aria-label={field.label} required={field.required} value={values[field.name] ?? ""} onChange={e => setValues(old => ({ ...old, [field.name]: e.target.value }))} />}</label>)}
    <button disabled={busy}>提交并继续工作流</button>
  </form>;
}
function WorkflowItem({ flow, definitions, action, busy }: { flow: WorkflowView; definitions: WorkflowDefinitionView[]; action: Action; busy: boolean }) {
  const [note, setNote] = useState(""), [outcome, setOutcome] = useState('{"kind":"complete","output":null}'), [retry, setRetry] = useState(false);
  const [target, setTarget] = useState(""), [step, setStep] = useState(""), [input, setInput] = useState("{}");
  const [evidence, setEvidence] = useState<{ events: { eventId: string; seq: number; type: string; payloadPreview: string; artifacts: { sha256: string; bytes: number }[] }[]; next?: number }>();
  const [artifact, setArtifact] = useState(""), [error, setError] = useState("");
  const inspect = async (offset = 0) => {
    try { setEvidence(await api("/customization", { action: "workflow-evidence", id: flow.id, offset })); setError(""); } catch (e) { setError(String(e)); }
  };
  return <article aria-label={`工作流 ${flow.definitionId}`}>
    <h4>{flow.definitionId} · {labels[flow.status] ?? flow.status}</h4>
    <p>步骤 {flow.step} · 定义 {flow.definitionRevision.slice(0, 12)} · <code>{flow.id}</code></p>
    {flow.error && <p role="alert">{flow.error}</p>}{flow.outputPreview && <pre>{flow.outputPreview}</pre>}
    {flow.wait && flow.status === "waiting" && <DurableForm key={flow.wait.id} flow={flow} action={action} busy={busy} />}
    {["ready", "queued"].includes(flow.status) && <button disabled={busy} onClick={() => void action({ action: "workflow-resume", id: flow.id, revision: flow.revision })}>继续工作流</button>}
    {!["completed", "cancelled"].includes(flow.status) && <button disabled={busy} onClick={() => void action({ action: "workflow-cancel", id: flow.id, revision: flow.revision })}>取消工作流</button>}
    {flow.status === "unknown" && <section aria-label="核对未知结果">
      <p>先检查外部效果。提交已核对的结果不会重跑步骤；重新尝试可能重复外部效果。</p>
      <label>核对记录<input aria-label="核对记录" value={note} onChange={e => setNote(e.target.value)} /></label>
      <label>核对后的结果 JSON<textarea aria-label="核对后的结果 JSON" value={outcome} onChange={e => setOutcome(e.target.value)} /></label>
      <button disabled={busy || !note.trim()} onClick={() => { try { void action({ action: "workflow-resolve", id: flow.id, revision: flow.revision, choice: { outcome: JSON.parse(outcome), note } }); } catch (e) { setError(String(e)); } }}>提交已核对结果</button>
      <label><input type="checkbox" checked={retry} onChange={e => setRetry(e.target.checked)} />我已核对外部效果，明确授权再次执行此步骤</label>
      <button disabled={busy || !retry || !note.trim()} onClick={() => void action({ action: "workflow-resolve", id: flow.id, revision: flow.revision, choice: { retry: true, note } })}>授权一次新尝试</button>
    </section>}
    {["queued", "ready", "waiting"].includes(flow.status) && <details><summary>显式迁移工作流定义</summary>
      <p>原状态与定义会保留为证据；旧等待回答将失效。未知步骤须先核对。</p>
      <label>迁移目标<select aria-label="迁移目标" value={target} onChange={e => { setTarget(e.target.value); setStep(definitions.find(d => `${d.resourceId}|${d.id}` === e.target.value)?.entry ?? ""); }}><option value="">选择新定义</option>{definitions.map(d => <option key={`${d.resourceId}|${d.id}`} value={`${d.resourceId}|${d.id}`}>{d.resourceName}:{d.id} · {d.revision.slice(0, 12)} · schema {d.schemaVersion}</option>)}</select></label>
      <label>目标步骤<input aria-label="目标步骤" value={step} onChange={e => setStep(e.target.value)} /></label>
      <label>迁移输入<textarea aria-label="迁移输入" value={input} onChange={e => setInput(e.target.value)} /></label>
      <label>迁移说明<input aria-label="迁移说明" value={note} onChange={e => setNote(e.target.value)} /></label>
      <button disabled={busy || !target || !note.trim()} onClick={() => { try { const [resourceId, definitionId] = target.split("|"); void action({ action: "workflow-migrate", id: flow.id, revision: flow.revision, target: { resourceId, definitionId, fromSchemaVersion: flow.schemaVersion, step, input: JSON.parse(input), note } }); } catch (e) { setError(String(e)); } }}>检查并迁移</button>
    </details>}
    <button disabled={busy} onClick={() => void action({action:"workflow-recover",id:flow.id})}>补投待办记录</button>
    <button onClick={() => void inspect()}>查看工作流证据</button>
    {error && <p role="alert">{error}</p>}
    {evidence && <section aria-label="工作流证据">{evidence.events.map(e => <details key={e.eventId}><summary>{e.seq} · {e.type}</summary><pre>{e.payloadPreview}</pre>{e.artifacts.map(a => <button key={a.sha256} onClick={() => { void api<{ text: string; truncated: boolean }>("/customization", { action: "workflow-artifact", id: flow.id, hash: a.sha256 }).then(value => setArtifact(value.text + (value.truncated ? "\n[预览截断]" : ""))).catch(e => setError(String(e))); }}>查看 {a.sha256.slice(0, 12)} ({a.bytes} bytes)</button>)}</details>)}{evidence.next !== undefined && <button onClick={() => void inspect(evidence.next)}>后续证据</button>}{artifact && <pre>{artifact}</pre>}</section>}
  </article>;
}
export function WorkflowManagement({ flows, definitions, busy, action }: { flows: WorkflowView[]; definitions: WorkflowDefinitionView[]; busy: boolean; action: Action }) {
  const [target, setTarget] = useState(""), [input, setInput] = useState("{}"), [error, setError] = useState("");
  const command = useRef(crypto.randomUUID());
  return <section aria-label="持久工作流"><h3>持久工作流</h3>
    {!!definitions.length && <form onSubmit={e => { e.preventDefault(); try { const [resourceId, definitionId] = target.split("|"); void action({ action: "workflow-start", resourceId, definitionId, input: JSON.parse(input), commandId: command.current }).then(result => { if (result) command.current = crypto.randomUUID(); }); } catch (e) { setError(String(e)); } }}>
      <label>工作流定义<select aria-label="工作流定义" required value={target} onChange={e => setTarget(e.target.value)}><option value="">选择工作流</option>{definitions.map(d => <option key={`${d.resourceId}|${d.id}`} value={`${d.resourceId}|${d.id}`}>{d.resourceName}:{d.id} · {d.revision.slice(0, 12)}</option>)}</select></label>
      <label>工作流输入 JSON<textarea aria-label="工作流输入 JSON" value={input} onChange={e => setInput(e.target.value)} /></label><button disabled={busy}>启动工作流</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {flows.map(flow => <WorkflowItem key={flow.id} flow={flow} definitions={definitions} busy={busy} action={action} />)}
  </section>;
}
