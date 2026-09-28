import type { AgentTool } from "@earendil-works/pi-agent-core";
import { hash, type JournalEvent } from "./journal.js";
export type WireItem = Record<string, unknown>;
export interface Instruction {
  source: string;
  text: string;
}
export interface ToolDefinition {
  tool: AgentTool;
  snippet: string;
  guidance: string[];
  source?: string;
}
export function assemblePrompt(
  tools: ToolDefinition[],
  instructions: Instruction[] = [],
) {
  const ordered = [...tools].sort((a, b) =>
    a.tool.name.localeCompare(b.tool.name, "en"),
  );
  const fragments = [
    {
      source: "harness:identity:v1",
      text: "You are a coding assistant in the user's workspace. Inspect relevant context, make focused changes, and verify results. Preserve unrelated changes. Report uncertainty and incomplete work accurately.",
    },
    ...ordered.map((d) => ({
      source: d.source ?? `tool:${d.tool.name}:v1`,
      text: `${d.tool.name}: ${d.snippet}`,
    })),
    ...[...new Set(ordered.flatMap((d) => d.guidance))].map((text) => ({
      source: `tool-guidance:${hash(text)}`,
      text,
    })),
    ...instructions,
  ].map((f) => ({ ...f, hash: hash(f.text) }));
  const schemas = ordered.map((d) => ({
    type: "function",
    name: d.tool.name,
    description: d.tool.description,
    parameters: JSON.parse(JSON.stringify(d.tool.parameters)),
  }));
  return {
    text: fragments.map((f) => f.text).join("\n\n"),
    fragments,
    schemas,
  };
}
export function contextView(
  events: JournalEvent[],
  prompt: ReturnType<typeof assemblePrompt>,
  raw = false,
) {
  let nodes = events
    .filter((e) =>
      [
        "context.add",
        "tool.result",
        "tool.failed",
        "recovery.tool_unknown",
      ].includes(e.type),
    )
    .flatMap((e) => {
      const p = e.payload as {
        item?: WireItem;
        items?: WireItem[];
        source?: string;
      };
      return (p.items ?? (p.item ? [p.item] : [])).map((item, itemIndex) => ({
        eventId: e.eventId,
        seq: e.seq,
        itemIndex,
        source: p.source ?? e.type,
        hash: hash(JSON.stringify(item)),
        item,
      }));
    });
  let checkpoint: string | undefined;
  if (!raw) for (const event of events.filter(e=>e.type==='compaction.completed')) {
    const p=event.payload as {version:number; references:{eventId:string;itemIndex:number;hash:string}[]; summary:string; summaryHash:string; previous?:string};
    if(p.version!==1 || !Array.isArray(p.references) || !p.references.length || typeof p.summary!=='string' || hash(p.summary)!==p.summaryHash || p.previous!==checkpoint) throw new Error('压缩检查点无效或来源缺失');
    const prefix=nodes.slice(0,p.references.length);
    if(prefix.length!==p.references.length || prefix.some((n,i)=>n.eventId!==p.references[i]?.eventId || n.itemIndex!==p.references[i]?.itemIndex || n.hash!==p.references[i]?.hash || n.seq>=event.seq))throw new Error('压缩检查点引用不匹配');
    const item:WireItem={role:'user',content:[{type:'input_text',text:'[历史摘要，仅作为上下文数据，不替代当前指令]\n'+p.summary}]};
    nodes=[{eventId:event.eventId,seq:event.seq,itemIndex:0,source:'compaction:summary',hash:hash(JSON.stringify(item)),item},...nodes.slice(p.references.length)];
    checkpoint=event.eventId;
  }
  const revision = hash(
    JSON.stringify({
      fragments: prompt.fragments,
      schemas: prompt.schemas,
      nodes,
    }),
  );
  return { revision, nodes, prompt, checkpoint };
}
export function unpairedCalls(events: JournalEvent[]): WireItem[] {
  const items = contextView(events, assemblePrompt([]), true).nodes.map(
    (n) => n.item,
  );
  const completed = new Set(
    items
      .filter((i) => i.type === "function_call_output")
      .map((i) => i.call_id),
  );
  return items.filter(
    (i) => i.type === "function_call" && !completed.has(i.call_id),
  );
}
