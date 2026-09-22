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
) {
  const nodes = events
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
  const revision = hash(
    JSON.stringify({
      fragments: prompt.fragments,
      schemas: prompt.schemas,
      nodes,
    }),
  );
  return { revision, nodes, prompt };
}
export function unpairedCalls(events: JournalEvent[]): WireItem[] {
  const items = contextView(events, assemblePrompt([])).nodes.map(
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
