import type { ExtensionFactory2, ProviderDefinition, ProviderInput, ProviderOutput, Json } from "nekomimi/extensions";

/** HTTP stays in the host. This example only maps JSON/SSE and holds bounded parser state. */
function adapter(protocol: "responses" | "chat-completions"): ProviderDefinition {
  const pending = new Map<string, string>();
  return {
    id: protocol === "responses" ? "example-responses" : "example-chat",
    models: [{ id: "fixture-model", name: `Example ${protocol}`, protocol, historyCompatibility: `example-${protocol}-v1`, contextWindow: 128000, maxOutputTokens: 4096, capabilities: { tools: true, images: true, reasoning: protocol === "responses" } }],
    async serialize(input: ProviderInput): Promise<{ path: string; body: Json }> {
      if (protocol === "responses") return { path: "/responses", body: { model: input.model.id, instructions: input.instructions, input: input.history, tools: input.tools, stream: true, max_output_tokens: input.maxOutputTokens } };
      const messages: any[] = [{ role: "system", content: input.instructions }];
      for (const item of input.history as any[]) {
        if (item.type === "reasoning") throw new Error("Chat example cannot convert native reasoning; use an explicit history branch");
        if (item.type === "function_call") {
          const last = messages.at(-1);
          const call = { id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } };
          if (last?.role === "assistant" && last.tool_calls) last.tool_calls.push(call);
          else messages.push({ role: "assistant", content: null, tool_calls: [call] });
        } else if (item.type === "function_call_output") messages.push({ role: "tool", tool_call_id: item.call_id, content: item.output });
        else if (["user", "assistant"].includes(item.role)) messages.push({ role: item.role, content: typeof item.content === "string" ? item.content : (item.content ?? []).map((part: any) => {
          if (["input_text", "output_text", "text"].includes(part.type)) return { type: "text", text: part.text };
          if (part.type === "input_image") return { type: "image_url", image_url: { url: part.image_url } };
          throw new Error("Unsupported history content for Chat adapter");
        }) });
        else throw new Error("Unsupported history item for Chat adapter");
      }
      return { path: "/chat/completions", body: { model: input.model.id, messages, tools: input.tools.map((tool: any) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), stream: true, max_tokens: input.maxOutputTokens } };
    },
    async parse({ requestId, sequence, chunk, final }): Promise<ProviderOutput | null> {
      if (sequence === 1 && pending.size >= 16) throw new Error("Parser request limit");
      const text = (pending.get(requestId) ?? "") + chunk;
      if (text.length > 16 * 1024 * 1024) { pending.delete(requestId); throw new Error("Parser response limit"); }
      if (!final) { pending.set(requestId, text); return null; }
      pending.delete(requestId);
      let value: any;
      if (text.trimStart().startsWith("{")) value = JSON.parse(text);
      else {
        const frames = text.split(/\r?\n\r?\n/);
        if (frames.at(-1)?.trim()) throw new Error("Incomplete SSE frame");
        const events = frames.flatMap(frame => {
          const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          return data && data !== "[DONE]" ? [JSON.parse(data)] : [];
        });
        if (protocol === "responses") {
          const terminal = events.filter(e => ["response.completed", "response.incomplete", "response.failed"].includes(e.type));
          if (terminal.length !== 1 || terminal[0].type !== "response.completed") throw new Error("Responses stream did not complete");
          value = terminal[0].response;
        } else {
          const message: any = { role: "assistant", content: "", tool_calls: [] }; let finish: string | undefined;
          for (const event of events) {
            const choices = event.choices ?? [];
            if (choices.length > 1) throw new Error("Multiple Chat choices unsupported");
            const choice = choices[0]; if (!choice) continue;
            const delta = choice.delta ?? {};
            if (delta.reasoning_content || delta.reasoning) throw new Error("Chat example does not declare native reasoning support");
            message.content += delta.content ?? "";
            for (const call of delta.tool_calls ?? []) {
              if (!Number.isInteger(call.index) || call.index < 0 || call.index > 127) throw new Error("Invalid tool delta index");
              const target = message.tool_calls[call.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
              target.id += call.id ?? ""; target.function.name += call.function?.name ?? ""; target.function.arguments += call.function?.arguments ?? "";
            }
            finish = choice.finish_reason ?? finish;
          }
          if (!["stop", "tool_calls"].includes(finish ?? "")) throw new Error("Chat stream did not complete");
          value = { choices: [{ message, finish_reason: finish }] };
        }
      }
      let items: any[], rawItems: Json[];
      if (protocol === "responses") {
        if (value.status !== "completed" || !Array.isArray(value.output)) throw new Error("Incomplete Responses result");
        items = value.output; rawItems = value.output;
      } else {
        if (value.choices?.length !== 1 || !["stop", "tool_calls"].includes(value.choices[0].finish_reason)) throw new Error("Incomplete Chat result");
        const message = value.choices[0].message;
        if (message.reasoning_content || message.reasoning || (message.content !== null && typeof message.content !== "string")) throw new Error("Unsupported Chat output");
        rawItems = [message]; items = [];
        if (message.content) items.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: message.content }] });
        for (const call of message.tool_calls ?? []) items.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
      const content: ProviderOutput["projection"]["content"] = [];
      for (const item of items) {
        if (item.type === "message") for (const part of item.content ?? []) { if (part.type === "output_text") content.push({ type: "text", text: part.text }); else throw new Error("Unsupported assistant message content"); }
        else if (item.type === "function_call") content.push({ type: "toolCall", id: item.call_id, name: item.name, arguments: JSON.parse(item.arguments) });
        else if (item.type !== "reasoning") throw new Error("Unsupported provider output item");
      }
      return { terminal: "completed", rawItems, contextItems: items, projection: { content }, ...(value.usage ? { usage: value.usage } : {}) };
    },
  };
}
export default ((api) => {
  api.registerProvider(adapter("responses"));
  api.registerProvider(adapter("chat-completions"));
}) satisfies ExtensionFactory2;
