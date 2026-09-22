import type { ExtensionAPI } from "nekomimi/extensions";
export default function (api: ExtensionAPI) {
  api.registerTool({
    name: "check",
    description: "Return the review checklist",
    parameters: { type: "object", properties: {} },
    promptGuidelines: ["Use the checklist when reviewing changes."],
    async execute(_args, ctx) {
      await ctx.state.set("used", 1, true);
      return {
        content: [{ type: "text", text: "检查行为、失败路径和测试覆盖。" }],
      };
    },
  });
  api.registerCommand("inspect", {
    description: "Review current changes",
    async handler(_args, ctx) {
      const diff = await ctx.callTool("bash", { command: "git diff --stat" });
      const review = await ctx.model(
        "审查这些变更摘要并说明需要进一步读取的文件：" +
          JSON.stringify(diff.content),
      );
      await ctx.ui({ kind: "card", title: "审查结果", text: review });
      return review;
    },
  });
  api.on("beforeTool", async (event) => {
    if (event.tool === "write" && event.args?.path === ".env")
      return { block: "本工作流不覆盖 .env" };
  });
  api.onDispose(() => {
    /* 清理此扩展创建的资源。 */
  });
}
