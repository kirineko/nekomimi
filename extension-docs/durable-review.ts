import type { ExtensionFactory2 } from "nekomimi/extensions";
export default ((api) => {
  api.registerWorkflow({
    id: "durable-review", schemaVersion: 1,
    inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"], additionalProperties: false },
    entry: "inspect", triggers: [{ kind: "command", name: "durable-review" }],
    steps: {
      inspect: {
        transitions: ["finish"],
        async execute(input, ctx) {
          const target = (input as { target: string }).target;
          const result = await ctx.callTool("read", { path: target });
          const state = await ctx.workspaceState.get("reviews", 1);
          await ctx.workspaceState.set("reviews", 1, state?.revision ?? 0, Number(state?.value ?? 0) + 1);
          return { kind: "wait", step: "finish", input: { target, evidence: JSON.parse(JSON.stringify(result)) }, form: { kind: "form", title: "审查确认", text: "阅读已完成，重启后可以继续回答。", fields: [{ name: "decision", label: "审查决定", required: true, options: ["通过", "需要修改"] }] } };
        },
      },
      finish: {
        transitions: [],
        async execute(input) { return { kind: "complete", output: input }; },
      },
    },
  });
}) satisfies ExtensionFactory2;
