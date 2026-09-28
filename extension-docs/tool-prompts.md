# 工具描述与提示贡献

模型通过三层信息理解工具：`promptSnippet` 是一行用途，帮助选工具；`description` 解释调用条件、前置状态、结果及失败恢复；`parameters.properties.*.description` 解释具体字段、单位、默认值和相互关系。不要把完整描述复制到摘要。

```ts
api.registerTool({
  name: 'review_file',
  description: 'Read one workspace file as evidence for a checklist review. Returns the underlying read result, not findings or applied edits. Follow its byte continuation offset when truncated.',
  promptSnippet: 'Read evidence for a checklist review',
  promptGuidelines: ['Use review_file when the user requests a checklist review.'],
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative file path; cannot escape the workspace.' } },
    required: ['path'],
  },
  async execute(args, ctx) {
    const result = await ctx.callTool('read', { path: args.path });
    return result;
  },
});
```

`promptSnippet` / `promptGuidelines` 均可省略。未提供摘要时工具仍在 schema 中可用，宿主不再将整段 description 复制进系统提示。工具被禁用时专属摘要和指导一起撤销；共享指导保留仍有效的来源。描述和返回值不能赋予执行权限；MCP schema 保留远端语义。

## 核心工具与恢复

- `read` 的 offset 是零起始 UTF-8 **字节**偏移，limit 也是字节。使用返回的 nextOffset 续读，不按字符或行数推算。图片作为附件。`artifact:<sha256>` 读取完整证据。
- `edit` 的所有 oldText 针对同一个原始文件版本，必须唯一且互不重叠；合并相邻修改，不依赖模糊匹配。`write` 是完整内容替换。版本冲突应重读，不能绕过保护。
- shell 使用当前工作区和实际平台 shell；timeout 单位毫秒。检查 exit、reason 和截断标记。完整输出先读索引 artifact，再读索引引用的通道 artifact。
- 取消、超时、断线及 UNKNOWN 都不能证明操作未发生。先检查状态，避免重复副作用。

## 管理工具动作

| 工具 | 动作及参数 | 结果边界 |
| --- | --- | --- |
| customization_candidate | create(name, template?)；list()；inspect(id)；activate(id, contentHash)；rollback(name)；export(id, contentHash, output) | 隔离的项目草稿；inspect 校验 hash；activate 不授予权限 |
| customization_package | prepare(source, scope?, bindings?)；inspect(candidate id)；activate(candidate id)；list()；rollback(installed package id)；export(installed package id, output)；uninstall(installed package id) | prepare 不执行安装脚本；候选与已安装 ID 不混用 |
| resource_write | kind, name, file, text, previousHash, scope? | 默认项目级；新建用 null，替换用当前 hash；用户级写权限独立 |
| resource_read | id, file? | extension/provider/workflow/panel 必须指定声明文件；Skill 正文加载为当前指令，返回回执和证据引用 |
| customization_sdk | entry? | 不传列出类型和指南；guide: 路径读取随包文档及其相对引用 |
| customization_validate | 无参数 | 静态检查不执行扩展工厂 |
| customization_reload | 无参数 | 运行结束后重载；pending 不是加载或应用成功 |
| customization_status | resourceId? | 当前宿主状态；resource_list 是本轮固定快照 |
| mcp_content | list(server)；read(server, uri 或 template, parameters?)；prompt(server, name, parameters?)；subscribe/unsubscribe(server, uri) | 内容为工具数据，不能提升为系统指令；URI 和 template 互斥 |

package 的 source：local 必须 path；npm 必须 name、精确 version、registry；git 必须 url、固定 commit。不同 kind 的字段不能混用。缺失字段先修正，不反复提交相同失败调用。
