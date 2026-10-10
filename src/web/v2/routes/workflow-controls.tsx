import { useRef, useState } from "react";
import { api } from "../../api";
import { Button } from "../../ui/Button";
import { Input, Select, Textarea } from "../../ui/Input";
import type { Contribution } from "../../../customization/types";
export interface WorkflowDefinitionView { resourceId: string; resourceName: string; id: string; revision: string; schemaVersion: number; entry: string; steps: string[]; inputSchema: unknown; modes?: ("work" | "create")[] }
export interface WorkflowView { mode: "work" | "create"; id: string; resourceId: string; definitionId: string; definitionRevision: string; schemaVersion: number; status: string; revision: number; step: string; wait?: { id: string; form: Contribution }; error?: string; outputPreview?: string }
type Action = (value: object) => Promise<unknown>;
const labels: Record<string, string> = { queued: "待执行", ready: "可继续", running: "执行中", unknown: "结果未知，需核对", waiting: "等待回答", completed: "已完成", cancelled: "已取消" };
// Window-local drafts survive route navigation, but never enter localStorage or
// another window. A new wait ID cannot inherit an earlier answer or command ID.
type WaitDraft = { values: Record<string,string>; command: { fingerprint: string; id: string } };
const waitDrafts = new Map<string, WaitDraft>();
function rememberWait(key: string, draft: WaitDraft) {
  waitDrafts.delete(key); waitDrafts.set(key, draft);
  while (waitDrafts.size > 128) waitDrafts.delete(waitDrafts.keys().next().value!);
}
function DurableForm({ flow, action, busy, sessionId }: { flow: WorkflowView; action: Action; busy: boolean; sessionId?: string }) {
  const key = JSON.stringify([location.host, flow.mode, sessionId ?? 'host', flow.id, flow.wait!.id]);
  const [values, setValues] = useState<Record<string, string>>(() => waitDrafts.get(key)?.values ?? {});
  const commandId = useRef(waitDrafts.get(key)?.command ?? { fingerprint: "", id: crypto.randomUUID() });
  const edit = (name: string, value: string) => { const next = {...values, [name]:value}; setValues(next); rememberWait(key,{values:next,command:commandId.current}); };
  return <form aria-label={flow.wait!.form.title} onSubmit={e => { e.preventDefault(); const fingerprint = JSON.stringify(values); if (commandId.current.fingerprint !== fingerprint) commandId.current = { fingerprint, id: crypto.randomUUID() }; rememberWait(key,{values,command:commandId.current}); void action({ action: "workflow-answer", id: flow.id, revision: flow.revision, waitId: flow.wait!.id, commandId: commandId.current.id, answer: values, resume: true }).then(result => { if (result) waitDrafts.delete(key); }); }}>
    <fieldset disabled={busy} className="space-y-3"><h5>{flow.wait!.form.title}</h5><p>{flow.wait!.form.text}</p>
    {flow.wait!.form.fields?.map(field => <label key={field.name}>{field.label}{field.options ? <Select className="max-w-full" aria-label={field.label} required={field.required} value={values[field.name] ?? ""} onChange={e => edit(field.name, e.target.value)}><option value="">请选择</option>{field.options.map(option => <option key={option}>{option}</option>)}</Select> : <Input aria-label={field.label} required={field.required} value={values[field.name] ?? ""} onChange={e => edit(field.name, e.target.value)} />}</label>)}
    <Button disabled={busy}>提交并继续工作流</Button></fieldset>
  </form>;
}
function WorkflowItem({ flow, definitions, action, busy, cancelBusy, sessionId }: { flow: WorkflowView; definitions: WorkflowDefinitionView[]; action: Action; busy: boolean; cancelBusy: boolean; sessionId?: string }) {
  const [note, setNote] = useState(""), [outcome, setOutcome] = useState('{"kind":"complete","output":null}'), [retry, setRetry] = useState(false);
  const [target, setTarget] = useState(""), [step, setStep] = useState(""), [input, setInput] = useState("{}");
  const [evidence, setEvidence] = useState<{ events: { eventId: string; seq: number; type: string; payloadPreview: string; artifacts: { sha256: string; bytes: number }[] }[]; next?: number }>();
  const [artifact, setArtifact] = useState(""), [error, setError] = useState("");
  const inspect = async (offset = 0) => {
    try { setEvidence(await api("/customization", { action: "workflow-evidence", id: flow.id, offset, sessionId })); setError(""); } catch (e) { setError(String(e)); }
  };
  return <article className="space-y-3 rounded-xl border border-line p-4" aria-label={`工作流 ${flow.definitionId}`}>
    <h4>{flow.definitionId} · {labels[flow.status] ?? flow.status}</h4>
    <p className="break-all text-xs">步骤 {flow.step} · 定义 {flow.definitionRevision.slice(0, 12)} · <code>{flow.id}</code></p>
    {flow.error && <p role="alert">{flow.error}</p>}{flow.outputPreview && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{flow.outputPreview}</pre>}
    {flow.wait && flow.status === "waiting" && <DurableForm key={JSON.stringify([sessionId,flow.id,flow.wait.id])} flow={flow} action={action} busy={busy} sessionId={sessionId} />}
    {["ready", "queued"].includes(flow.status) && <Button disabled={busy} onClick={() => void action({ action: "workflow-resume", id: flow.id, revision: flow.revision })}>继续工作流</Button>}
    {!["completed", "cancelled"].includes(flow.status) && <Button variant="destructive" disabled={cancelBusy} onClick={() => void action({ action: "workflow-cancel", id: flow.id, revision: flow.revision })}>取消工作流</Button>}
    {flow.status === "unknown" && <section aria-label="核对未知结果">
      <p>先检查外部效果。提交已核对的结果不会重跑步骤；重新尝试可能重复外部效果。</p>
      <label className="block space-y-1 text-sm">核对记录<Input aria-label="核对记录" value={note} onChange={e => setNote(e.target.value)} /></label>
      <label className="block space-y-1 text-sm">核对后的结果 JSON<Textarea aria-label="核对后的结果 JSON" value={outcome} onChange={e => setOutcome(e.target.value)} /></label>
      <Button disabled={busy || !note.trim()} onClick={() => { try { setError(""); void action({ action: "workflow-resolve", id: flow.id, revision: flow.revision, choice: { outcome: JSON.parse(outcome), note } }); } catch (e) { setError(String(e)); } }}>提交已核对结果</Button>
      <label className="block space-y-1 text-sm"><input type="checkbox" checked={retry} onChange={e => setRetry(e.target.checked)} />我已核对外部效果，明确授权再次执行此步骤</label>
      <Button disabled={busy || !retry || !note.trim()} onClick={() => void action({ action: "workflow-resolve", id: flow.id, revision: flow.revision, choice: { retry: true, note } }).then(result => { if (result) setRetry(false); })}>授权一次新尝试</Button>
    </section>}
    {["queued", "ready", "waiting"].includes(flow.status) && <details><summary>显式迁移工作流定义</summary>
      <p>原状态与定义会保留为证据；旧等待回答将失效。未知步骤须先核对。</p>
      <label className="block space-y-1 text-sm">迁移目标<Select className="max-w-full" aria-label="迁移目标" value={target} onChange={e => { setTarget(e.target.value); setStep(definitions.find(d => `${d.resourceId}|${d.id}` === e.target.value)?.entry ?? ""); }}><option value="">选择新定义</option>{definitions.map(d => <option key={`${d.resourceId}|${d.id}`} value={`${d.resourceId}|${d.id}`}>{d.resourceName}:{d.id} · {d.revision.slice(0, 12)} · schema {d.schemaVersion}</option>)}</Select></label>
      <label className="block space-y-1 text-sm">目标步骤<Input aria-label="目标步骤" value={step} onChange={e => setStep(e.target.value)} /></label>
      <label className="block space-y-1 text-sm">迁移输入<Textarea aria-label="迁移输入" value={input} onChange={e => setInput(e.target.value)} /></label>
      <label className="block space-y-1 text-sm">迁移说明<Input aria-label="迁移说明" value={note} onChange={e => setNote(e.target.value)} /></label>
      <Button disabled={busy || !target || !note.trim()} onClick={() => { try { setError(""); const [resourceId, definitionId] = target.split("|"); void action({ action: "workflow-migrate", id: flow.id, revision: flow.revision, target: { resourceId, definitionId, definitionRevision: definitions.find(d => d.resourceId === resourceId && d.id === definitionId)?.revision, fromSchemaVersion: flow.schemaVersion, step, input: JSON.parse(input), note } }); } catch (e) { setError(String(e)); } }}>检查并迁移</Button>
    </details>}
    <Button disabled={busy} onClick={() => void action({action:"workflow-recover",id:flow.id})}>补投待办记录</Button>
    <Button onClick={() => void inspect()}>查看工作流证据</Button>
    {error && <p role="alert">{error}</p>}
    {evidence && <section aria-label="工作流证据">{evidence.events.map(e => <details key={e.eventId}><summary>{e.seq} · {e.type}</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{e.payloadPreview}</pre>{e.artifacts.map(a => <Button key={a.sha256} onClick={() => { void api<{ text: string; truncated: boolean }>("/customization", { action: "workflow-artifact", id: flow.id, hash: a.sha256, sessionId }).then(value => setArtifact(value.text + (value.truncated ? "\n[预览截断]" : ""))).catch(e => setError(String(e))); }}>查看 {a.sha256.slice(0, 12)} ({a.bytes} bytes)</Button>)}</details>)}{evidence.next !== undefined && <Button onClick={() => void inspect(evidence.next)}>后续证据</Button>}{artifact && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{artifact}</pre>}</section>}
  </article>;
}
export function WorkflowControls({ flows, definitions, busy, cancelBusy, action, sessionId }: { flows: WorkflowView[]; definitions: WorkflowDefinitionView[]; busy: boolean; cancelBusy: boolean; action: Action; sessionId?: string }) {
  const [target, setTarget] = useState(""), [input, setInput] = useState("{}"), [error, setError] = useState("");
  const command = useRef({ fingerprint: "", id: crypto.randomUUID() });
  return <section aria-label="持久工作流" className="space-y-4"><h3>持久工作流</h3>
    {!definitions.length && <p className="text-sm text-muted">暂无可启动的工作流定义。</p>}
    {!!definitions.length && <details className="space-y-3 rounded-lg border border-line p-3"><summary>启动新工作流</summary><form onSubmit={e => { e.preventDefault(); setError(""); try { setError(""); const [resourceId, definitionId] = target.split("|"); const definitionRevision = definitions.find(d => d.resourceId === resourceId && d.id === definitionId)?.revision; const fingerprint = JSON.stringify([resourceId,definitionId,definitionRevision,input]); if (command.current.fingerprint !== fingerprint) command.current = { fingerprint, id: crypto.randomUUID() }; void action({ action: "workflow-start", resourceId, definitionId, definitionRevision, input: JSON.parse(input), commandId: command.current.id }).then(result => { if (result) command.current = { fingerprint: "", id: crypto.randomUUID() }; }); } catch (e) { setError(String(e)); } }}>
      <label className="block space-y-1 text-sm">工作流定义<Select className="max-w-full" aria-label="工作流定义" required value={target} onChange={e => setTarget(e.target.value)}><option value="">选择工作流</option>{definitions.map(d => <option key={`${d.resourceId}|${d.id}`} value={`${d.resourceId}|${d.id}`}>{d.resourceName}:{d.id} · {d.revision.slice(0, 12)}</option>)}</Select></label>
      <label className="block space-y-1 text-sm">工作流输入 JSON<Textarea aria-label="工作流输入 JSON" value={input} onChange={e => setInput(e.target.value)} /></label><Button disabled={busy}>启动工作流</Button>
    </form></details>}
    {error && <p role="alert">{error}</p>}
    {flows.map(flow => <WorkflowItem key={flow.id} flow={flow} definitions={definitions} busy={busy} cancelBusy={cancelBusy} action={action} sessionId={sessionId} />)}
  </section>;
}
