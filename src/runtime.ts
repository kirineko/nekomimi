import { promptData } from "./prompts.js";
import { compactContext } from './compaction.js';
import { contextView } from './context.js';
import { inputBudget, measureContext } from './context-meter.js';
import { requiredInstructionBudget } from './context-policy.js';
import { CustomizationHost } from "./customization/host.js";
import { CustomRun } from "./customization/run.js";
import type { Interactions } from "./customization/interactions.js";
import { createDurableLoop, type DurableLoop } from "./pi/durable-loop.js";
import type { Content } from "./customization/types.js";
import { Journal, id, hash, readSession, type JournalOptions } from "./journal.js";
import { createSessionBinding, creationHash, sessionBinding, checkSessionTarget, parseSessionCreation, canonicalSessionDirectory, headlessCreation } from "./session/identity.js";
import { readHandoffPayload, validateDeliveryReferences } from "./session/handoff-transfer.js";
import { prepareHandoffContext } from "./session/handoff-context.js";
import { codemodeDefinition } from "./codemode.js";
import { parseHandoffIds } from "./shared/protocol.js";
import { ApiError, type SessionBinding, type SessionCreation, type SessionMode } from "./shared/protocol.js";
import { CoreTools, type ToolOptions } from "./tools.js";
import type { ProviderOptions } from "./provider.js";
import { createProvider } from "./customization/adapter-provider.js";
import { assemblePrompt, unpairedCalls, type Instruction } from "./context.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { inspectJournalFormat, openJournalStorage, type JournalStorageHandle } from "./pi/journal-storage.js";
import { realpath as canonicalPath } from "node:fs/promises";

export interface RunOptions extends ProviderOptions {
  mode?: SessionMode;
  target?: SessionCreation["target"];
  ownerWorkspace?: string;
  createCommandId?: string;
  workspace: string;
  home?: string;
  customization?: CustomizationHost;
  interactions?: Interactions;
  session: string;
  prompt: string;
  instructions?: Instruction[];
  images?: Extract<Content, { type: "image" }>[];
  tools?: string[];
  signal?: AbortSignal;
  journalOptions?: JournalOptions;
  toolOptions?: ToolOptions;
  maxTurns?: number;
  /** Explicit delivery references; never apply resources or invoke their commands implicitly. */
  handoffIds?: string[];
  /** Web command acknowledgment occurs under the writer lock, before any model dispatch. */
  command?: {
    id: string;
    payloadHash: string;
    runId: string;
    onAccepted: (runId: string) => void;
  };
  /** Best-effort, coalesced UI observer; the Journal remains complete even if this consumer is slow. */
  onProgress?: (value: {
    type: string;
    seq: number;
    durableSeq: number;
  }) => unknown;
}
export interface RunResult {
  /** A prior accepted command was observed without starting a new task. */
  replayed?: boolean;
  session: string;
  sessionId: string;
  runId: string;
  status: string;
  text: string;
  durableSeq: number;
  error?: string;
}
function recordedRun(options: RunOptions, binding: SessionBinding, events: readonly import("./journal.js").JournalEvent[], durableSeq: number): RunResult | undefined {
  if (!options.command) return;
  const prior = events.find(event => event.type === "command.accepted" && (event.payload as { commandId?: string }).commandId === options.command!.id);
  if (!prior) return;
  if ((prior.payload as { payloadHash?: string }).payloadHash !== options.command.payloadHash)
    throw new ApiError(409, "command_conflict", "同一命令 ID 的内容不同");
  if (!prior.runId) throw new ApiError(422, "command_identity", "已接受命令缺少运行身份");
  const terminal = events.find(event => event.type === "run.finished" && event.runId === prior.runId)?.payload as { status?: string; text?: string; error?: string } | undefined;
  options.command.onAccepted(prior.runId);
  return { replayed: true, session: options.session, sessionId: binding.sessionId, runId: prior.runId,
    status: terminal?.status ?? "interrupted", text: terminal?.text ?? "", ...(terminal?.error ? { error: terminal.error } : {}), durableSeq };
}
export async function run(options: RunOptions): Promise<RunResult> {
  if (!options.prompt.trim()) throw new Error("Prompt must not be empty");
  // Identity and target checks precede resource factories and the writer lease.
  await inspectJournalFormat(options.session);
  let canonical: string;
  try { canonical = await canonicalPath(options.workspace); }
  catch { throw new ApiError(422, "target_unavailable", "目标目录不可用，不能回退到服务工作目录"); }
  let history: Awaited<ReturnType<typeof readSession>>["events"] = [];
  let durableSeq = 0;
  try { const observed = await readSession(options.session); history = observed.events; durableSeq = observed.durableSeq; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let binding = sessionBinding(history);
  if (!binding && history.some(event => event.type === "session.created"))
    throw new ApiError(422, "session_identity", "会话缺少模式身份，请使用独立的新会话");
  if (binding) {
    await checkSessionTarget(binding, options.home);
    if (binding.target.root !== canonical || (options.mode !== undefined && options.mode !== binding.mode) || (options.createCommandId !== undefined && options.createCommandId !== binding.creation.commandId))
      throw new ApiError(409, "session_identity", "会话模式或目标不可原地改变");
    if (options.ownerWorkspace && await canonicalPath(options.ownerWorkspace) !== binding.ownerWorkspace)
      throw new ApiError(409, "session_identity", "会话所属项目不可改变");
    if (options.target) {
      const selected = parseSessionCreation({ commandId: binding.creation.commandId, mode: binding.mode, target: options.target }).target!;
      if (await canonicalPath(selected.root) !== binding.target.root || selected.kind !== binding.target.kind || selected.scope !== binding.target.scope ||
          (selected.host && JSON.stringify(selected.host) !== JSON.stringify(binding.target.host)))
        throw new ApiError(409, "session_identity", "会话目标不可原地改变");
    }
  } else {
    const creation: SessionCreation = { commandId: options.createCommandId ?? id(), mode: options.mode ?? "work", ...(options.target ? { target: options.target } : {}) };
    const payloadHash = options.createCommandId ? hash(JSON.stringify({ creation: creationHash("Headless session", creation), location: await canonicalSessionDirectory(options.session) })) : creationHash("Headless session", creation);
    binding = await createSessionBinding(options.ownerWorkspace ?? canonical, id(), creation, payloadHash, options.home);
    if (options.createCommandId) binding = await headlessCreation(binding, await canonicalSessionDirectory(options.session), options.home, options.apiKey);
    await checkSessionTarget(binding, options.home);
    if (binding.target.root !== canonical) throw new ApiError(409, "session_identity", "运行目录必须匹配选定目标");
  }
  const handoffIds = parseHandoffIds(options.handoffIds);
  const recorded = recordedRun(options, binding, history, durableSeq);
  if (recorded) return recorded;
  if (handoffIds?.length) {
    const directory = await canonicalSessionDirectory(options.session);
    await validateDeliveryReferences(directory, history, binding, handoffIds);
  }
  return runBound({ ...options, workspace: canonical, handoffIds }, binding);
}
async function runBound(options: RunOptions, binding: SessionBinding): Promise<RunResult> {
  options = { ...options, mode: binding.mode };
  const runId = options.command?.runId ?? id();
  const host = options.customization ?? new CustomizationHost(options.workspace, options.home);
  if (host.catalog.workspace !== options.workspace) throw new ApiError(403, "target_scope", "定制宿主必须属于会话目标目录");
  const activation = await host.acquire();
  let journal: Journal;
  let durableStorage: JournalStorageHandle;
  try { durableStorage = await openJournalStorage(options.session, BACKGROUND_CONTEXT, {
    ...options.journalOptions,
    diagnosticRunId: runId,
    secrets: [...(options.journalOptions?.secrets ?? []), options.apiKey, ...activation.mcp.flatMap(m => m.secrets)],
  }, { workspace: binding.ownerWorkspace, binding }); journal = durableStorage.journal; } catch (e) { await host.release(); if (!options.customization) await host.close(); throw e; }
  return journal.withLinks({ mode: binding.mode, targetId: binding.target.id }, async () => {
  const storedBinding = sessionBinding(journal.events);
  if (!storedBinding || JSON.stringify(storedBinding) !== JSON.stringify(binding)) {
    try { await durableStorage.storage.close(BACKGROUND_CONTEXT); }
    finally { await host.release(); if (!options.customization) await host.close(); }
    throw new ApiError(409, "session_identity", "会话创建身份在准入期间变化");
  }
  const controller = new AbortController();
  const runSignal = AbortSignal.any([controller.signal, journal.failure.signal, ...(options.signal ? [options.signal] : [])]);
  const custom = new CustomRun(host, activation, journal, runId, runSignal, { ...options, mode: binding.mode }, options.interactions);
  let agent: DurableLoop | undefined;
  const notify = (() => {
    let pending: { type: string; seq: number; durableSeq: number } | undefined;
    let active = false;
    return (type: string) => {
      pending = {
        type,
        seq: journal.events.length,
        durableSeq: journal.durableSeq,
      };
      if (active || !options.onProgress) return;
      active = true;
      void (async () => {
        try {
          while (pending) {
            const value = pending;
            pending = undefined;
            try {
              await options.onProgress!(value);
            } catch {}
          }
        } finally {
          active = false;
        }
      })();
    };
  })();
  try {
    // A competing caller may have accepted the command since the read-only preflight.
    const recorded = recordedRun(options, binding, journal.events, journal.durableSeq);
    if (recorded) return recorded;
    await host.workflows.recover(journal);
    const tools = await CoreTools.create(
      options.workspace,
      journal,
      { runId },
      { ...options.toolOptions, search: { apiKey: options.apiKey, fetch: options.fetch, settings: options.search, ...options.toolOptions?.search } },
    );
    const existing = journal.events.find((e) => e.type === "session.created")
      ?.payload as
      | { workspace: string; model: string; baseUrl: string }
      | undefined;
    const model = options.model ?? "deepseek-flash";
    const baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(
      /\/$/,
      "",
    );
    const { realpath } = await import("node:fs/promises");
    const workspace = await realpath(options.workspace);
    if (existing && existing.workspace !== workspace)
      throw new Error("Resume requires the original workspace");
    if (!existing)
      await journal.append("session.created", { workspace, ownerWorkspace: binding.ownerWorkspace, model, baseUrl, binding });
    if (options.createCommandId) await headlessCreation(binding, journal.directory, options.home, options.apiKey, true);
    if (!journal.events.some((e) => e.type === "session.title"))
      await journal.append(
        "session.title",
        {
          title: options.prompt.replace(/\s+/g, " ").trim().slice(0, 60),
          source: "first-prompt",
        },
        { runId },
      );
    if (options.command) {
      const command = options.command;
      const prior = journal.events.find(
        (e) =>
          e.type === "command.accepted" &&
          (e.payload as { commandId?: string }).commandId === command.id,
      );
      if (prior)
        throw new Error(
          "Command already accepted; inspect its existing receipt",
        );
      await journal.append(
        "command.accepted",
        { commandId: command.id, payloadHash: command.payloadHash },
        { runId },
      );
    }
    for (const handoffId of options.handoffIds ?? []) {
      const received = journal.events.find(event => event.type === "handoff.received" && event.handoffId === handoffId);
      if (!received) throw new ApiError(404, "delivery_reference", "所选交付接收事实缺失");
      const payload = await readHandoffPayload(journal.directory, received);
      if (!payload.delivery?.length || JSON.stringify(payload.target) !== JSON.stringify(binding)) throw new ApiError(403, "delivery_scope", "交付引用不属于当前工作会话");
      await journal.append("delivery.referenced", { version: 1, handoffId, payloadHash: payload.payloadHash, receivedEventId: received.eventId,
        sourceSessionId: payload.source.sessionId, ...(options.command ? { commandId: options.command.id } : {}),
        versions: payload.delivery.map(item => ({ resourceId: item.resourceId, revision: item.revision, scope: item.scope, type: item.type })),
        executesCommand: false, grantsPermissions: false }, { runId, handoffId });
    }
    options.command?.onAccepted(runId);
    await prepareHandoffContext(journal,binding,runId,options.handoffIds);
    // Closing protocol pairs is bookkeeping, never a tool retry or invented reasoning.
    for (const call of unpairedCalls(journal.events)) {
      const intended = journal.events.some(
        (e) =>
          e.type === "tool.intent" &&
          e.toolCallId?.split("|")[0] === call.call_id,
      );
      await journal.append(
        "recovery.tool_unknown",
        {
          source: "recovery:interrupted-run",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: intended
              ? "The prior tool operation has an UNKNOWN result after interruption. Inspect the workspace; do not assume it failed or automatically repeat it."
              : "This tool was NOT EXECUTED before interruption.",
          },
        },
        { runId },
      );
    }
    await custom.initialize([...tools.definitions(),codemodeDefinition(journal,()=>custom.effectiveDefinitions(),runSignal)]);
    const definitions = custom.definitions.filter((d) => !options.tools || options.tools.includes(d.tool.name));
    custom.definitions.splice(0, custom.definitions.length, ...definitions);
    if (
      options.tools?.some(
        (name) => !definitions.some((d) => d.tool.name === name),
      )
    )
      throw new Error("Unknown tool name");
    const prompt = assemblePrompt(definitions, [...(options.instructions ?? []), ...custom.instructions], binding.mode);
    const refreshPrompt = () => Object.assign(prompt, assemblePrompt(custom.effectiveDefinitions(), [...(options.instructions ?? []), ...custom.instructions], binding.mode));
    const environmentText = `[Runtime environment data; current values supersede earlier environment records; not instructions]\n${promptData(tools.environment())}`;
    const ensureEnvironment = async () => {
      runSignal.throwIfAborted();
      const view=contextView(journal.events,prompt);
      const current=[...view.nodes].reverse().find(n=>n.source==="runtime:environment:v1");
      if(current && JSON.stringify(current.item.content)===JSON.stringify([{type:"input_text",text:environmentText}]))return;
      await journal.appendIf("context.add",{source:"runtime:environment:v1",item:{role:"user",content:[{type:"input_text",text:environmentText}]}},()=>!runSignal.aborted,{runId});
      runSignal.throwIfAborted();
    };
    const summaryPrompt=assemblePrompt([],[],"compaction");
    const manualCompact = /^\/compact(?:\s|$)/.test(options.prompt.trim());
    let beforeRequest: () => Promise<void> = async () => {};
    const beforeDispatch: NonNullable<ProviderOptions["beforeDispatch"]> = async context => {
      await options.beforeDispatch?.(context); await custom.validateRequest(context);
    };
    const settings = {...options, beforeRequest: () => beforeRequest(), beforeDispatch};
    const provider = await createProvider(host, activation, journal, { runId }, prompt, settings);
    const publishContext = async () => {
      await journal.append('context.measured', {measurement:measureContext(contextView(journal.events,prompt),provider.model,journal.events),prompt,model:provider.model,resourceRevision:activation.revision}, {runId});
      notify('context.measured');
    };
    const compact = async (manual=false) => {
      await custom.refreshContext();refreshPrompt();
      requiredInstructionBudget(prompt, provider.model);
      const protocol=provider.protocol;
      return compactContext({journal,prompt,summaryPrompt,model:provider.model,protocol,runId,signal:runSignal,manual,
        revalidate:async()=>{await checkSessionTarget(binding,options.home);await provider.validateConfiguration();await custom.validateContext(prompt);if(provider.protocol!==protocol)throw new Error('摘要来源协议已变化');},
        retention:async()=>{
          const handoffs=await Promise.all(journal.events.filter(event=>event.type==='handoff.intent'||event.type==='handoff.received'&&journal.events.some(e=>e.type==='handoff.context'&&e.handoffId===event.handoffId)).map(async event=>{
            const payload=await readHandoffPayload(journal.directory,event);
            return {eventId:event.eventId,hash:event.hash,handoffId:event.handoffId??(event.payload as {handoffId?:string}).handoffId,payloadHash:payload.payloadHash,
              goal:payload.goal,constraints:payload.constraints,
              retainedFacts:(journal.events.find(e=>e.type==='handoff.context'&&e.handoffId===event.handoffId)?.payload as any)?.retainedFacts??null,grantsPermissions:false};
          }));
          if(binding.mode!=='create')return handoffs.length?{handoffs}:null;
          const abilities=await host.lifecycle.catalog(), records=await host.lifecycle.records();
          const versions=new Set(abilities.flatMap(item=>[`${item.resourceId}:${item.revision}`,...(item.activeRevision?[`${item.resourceId}:${item.activeRevision}`]:[])]));
          const stages=new Map<string,typeof records[number]>();
          for(const event of records){const data=event.payload as import('./shared/customization-lifecycle.js').LifecycleEvidence;
            if(versions.has(`${data.resourceId}:${data.revision}`))stages.set(`${data.resourceId}:${data.revision}:${data.host}:${data.stage}`,event);}
          return {target:binding.target,activationRevision:host.active?.revision??null,
            abilities:abilities.map(({key,resourceId,revision,candidateId,activeRevision,scope,type,phase,missing})=>({key,resourceId,revision,candidateId,activeRevision,scope,type,phase,missing})).sort((a,b)=>a.key.localeCompare(b.key)),
            evidence:[...stages.values()].map(event=>({eventId:event.eventId,hash:event.hash,data:event.payload})),handoffs,
            pendingApplication:host.receipts.filter(receipt=>receipt.status==='pending'),
            permissionsGrantedBySummary:false,previewsProveApplication:false};
        },
        focus:manual?options.prompt.trim().slice(8).trim():undefined,notify:()=>notify('compaction'),summarize:async(events,limit)=>{
      const summaryProvider=await createProvider(host,activation,journal,{runId}, summaryPrompt, {...options,purpose:'compaction',contextEvents:events,maxOutputTokens:limit,beforeRequest:undefined,beforeDispatch});
      const response=await (await summaryProvider.stream(summaryProvider.model,{messages:[]},{signal:runSignal})).result();
      if(response.stopReason!=='stop' || summaryProvider.lastOutcome!=='completed' || response.content.some(c=>c.type==='toolCall'))throw new Error(response.errorMessage??'摘要未完整生成');
      return response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
    }});
    };
    beforeRequest=async()=>{
      runSignal.throwIfAborted();await checkSessionTarget(binding, options.home);await custom.refreshContext();refreshPrompt();
      await custom.recordMcpDeclarations(prompt);
      await prepareHandoffContext(journal,binding,runId,options.handoffIds);await ensureEnvironment();
      requiredInstructionBudget(prompt, provider.model);
      const measured=measureContext(contextView(journal.events,prompt),provider.model,journal.events),budget=inputBudget(provider.model,prompt.schemas.length);
      await publishContext();
      if(!measured.contextWindow)return;
      if(budget.available<=0)throw new Error('模型输出预留超过可用上下文');
      if(measured.totalTokens>=budget.threshold && options.autoCompact!==false){await compact();await ensureEnvironment();await publishContext();}
      else if(measured.totalTokens>budget.available)throw new Error('上下文空间不足，请使用 /compact 或切换模型');
    };
    await journal.append(
      "run.started",
      {
        workspace,
        model: provider.model.id,
        baseUrl: provider.model.baseUrl,
        provider: provider.model.provider,
        promptManifest: prompt.fragments,
        resourceRevision: activation.revision,
        tools: definitions.map((d) => d.tool.name),
      },
      { runId },
    );
    const input = [
      { type: "input_text", text: options.prompt },
      ...(options.images ?? []).map((i) => ({
        type: "input_image",
        image_url: `data:${i.mimeType};base64,${i.data}`,
      })),
    ];
    if (!manualCompact) await journal.append(
      "context.add",
      { source: "user", item: { role: "user", content: input } },
      { runId },
    );
    let turns = 1;
    const abort = () => agent?.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    journal.failure.signal.addEventListener("abort", abort, { once: true });
    const initializeLoop = async () => {
      agent = await createDurableLoop({
        storage: durableStorage.storage, journal, signal: runSignal,
        initialState: {
          model: provider.model,
          systemPrompt: prompt.text,
          tools: definitions.map((d) => d.tool),
        },
        streamFn: provider.stream,
        prepareRequest: () => provider.prepare(runSignal),
        afterModelResponse: async message => {
          for (const item of message.content) if (item.type === "toolCall" && !custom.toolModeAllowed(item.name))
            await custom.recordModeBlock("model-tool", item.name, item.id);
        },
        beforeToolCall: async ({ assistantMessage, toolCall }) => {
          journal.check();
          await checkSessionTarget(binding, options.home);
          options.signal?.throwIfAborted();
          if (
            assistantMessage.stopReason !== "toolUse" ||
            provider.lastOutcome !== "completed"
          )
            return {
              block: true,
              reason: "The response was not completed; tool execution is blocked",
              terminate: true,
            };
        },
        afterToolCall: async () => { refreshPrompt(); return undefined; },
        prepareNextTurn: async () => {
          journal.check();
          await checkSessionTarget(binding, options.home);
          if (++turns > (options.maxTurns ?? 64))
            throw new Error("已达到本次任务的调用轮数上限，请分步骤继续任务");
          refreshPrompt();
          return undefined;
        },
      });
      agent.subscribe(async (event) => {
        journal.check();
        if (event.type === "tool_execution_start")
          await journal.append(
            "tool.requested",
            {
              name: event.toolName,
              args: event.args,
              wireCallId: provider.wireCallId(event.toolCallId),
            },
            { runId, toolCallId: event.toolCallId },
          );
        if (event.type === "message_end" && event.message.role === "toolResult") {
          const m = event.message;
          const content = m.content.map((c) =>
            c.type === "image"
              ? {
                  type: "input_image",
                  image_url: `data:${c.mimeType};base64,${c.data}`,
                }
              : { type: "input_text", text: c.text },
          );
          await journal.append(
            m.isError ? "tool.failed" : "tool.result",
            {
              item: {
                type: "function_call_output",
                call_id: provider.wireCallId(m.toolCallId),
                output: content,
              },
              details: m.details,
              source: `tool:${m.toolName}`,
            },
            { runId, toolCallId: m.toolCallId },
          );
        }
        if (["turn_end", "tool_execution_end", "agent_end"].includes(event.type))
          notify(event.type);
      });
    };
    let error: string | undefined;
    let commandText: string | undefined;
    try {
      options.signal?.throwIfAborted();
      await initializeLoop();
      await ensureEnvironment();
      await custom.refreshContext(); refreshPrompt();
      if (manualCompact) {
        commandText=await compact(true);await publishContext();
      } else {
      const reason = await custom.hook('beforeRun');
      if (reason) throw new Error(reason);
      const command = await custom.command(options.prompt);
      refreshPrompt();
      if (command.handled) {
        await journal.append('extension.command_result', { text: command.text }, { runId });
        commandText = command.text;
      } else await agent!.prompt(command.text, options.images);
      while (custom.followups.length) {
        runSignal.throwIfAborted();
        const followup = custom.followups.shift()!;
        if (++turns > (options.maxTurns ?? 64)) throw new Error('已达到本次任务的调用轮数上限，请分步骤继续任务');
        await journal.append('context.add', { source: 'extension:follow-up', item: { role: 'user', content: [{ type: 'input_text', text: followup }] } }, { runId });
        refreshPrompt(); await agent!.prompt(followup);
      }
      await custom.hook('afterRun');
      await publishContext();
      }
    } catch (e) {
      error = journal.clean(String(e));
    } finally {
      options.signal?.removeEventListener("abort", abort);
      journal.failure.signal.removeEventListener("abort", abort);
    }
    const final = agent?.state.messages
      .filter((m) => m.role === "assistant")
      .at(-1);
    error ??= agent?.state.errorMessage ?? final?.errorMessage;
    const status = options.signal?.aborted
      ? "cancelled"
      : journal.failure.signal.aborted || error
        ? provider.lastOutcome === "incomplete"
          ? "incomplete"
          : "failed"
        : provider.lastOutcome;
    const text = commandText ??
      final?.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") ?? "";
    if (!journal.failure.signal.aborted)
      await journal.append(
        "run.finished",
        { status, error, text: journal.clean(text), ...(manualCompact ? {command:"compact"} : {}) },
        { runId },
      );
    notify("run.finished");
    if (status === "completed" && !journal.failure.signal.aborted)
      if (!manualCompact) await host.workflows.observe(journal, activation, "run-completed", undefined, options);
    return {
      session: journal.directory,
      sessionId: journal.sessionId,
      runId,
      status,
      text: journal.clean(text),
      error,
      durableSeq: journal.durableSeq,
    };
  } finally {
    controller.abort(new Error('Run ended'));
    try { if (agent) await agent.close(); else await durableStorage.storage.close(BACKGROUND_CONTEXT); }
    finally {
      try { await host.release(); }
      finally { if (!options.customization) await host.close(); }
    }
  }
  });
}
