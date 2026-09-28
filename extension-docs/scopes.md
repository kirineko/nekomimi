# 项目级与用户级定制

没有特别说明时，创建 **项目级** 能力；只有用户明确提出“所有项目都用”“用户级”等要求时，选择 `scope: "user"`。不要根据 Agent 自己判断把资源写入用户目录。先查询 `customization_sdk` 的 `scopes` 和 `host.home`，自定义 `--home` 时不能硬编码 `~/.nekomimi`。

| 资源 | 项目级（默认） | 用户级 |
| --- | --- | --- |
| 扩展（主题、面板、命令、工具等） | `<workspace>/.nekomimi/extensions/<name>/` | `<home>/extensions/<name>/` |
| 技能 | `<workspace>/.agents/skills/<name>/SKILL.md` | 默认 `~/.agents/skills/<name>/SKILL.md`；自定义 home 则 `<home>/skills/<name>/SKILL.md` |
| 规则 | `<workspace>/AGENTS.md` | `<home>/AGENTS.md` |
| MCP | `<workspace>/.nekomimi/mcp.json` | `<home>/mcp.json` |

同名资源通常项目优先，管理中用户资源显示为被覆盖；删除项目覆盖不会删除用户源文件。规则沿用目录层级的适用边界，不把全局规则简单替换为同名项目规则。用户级意味着可跨工作区发现，**不等于在每个项目自动获得执行授权**。主题资源作用域也不等于主题选择作用域：安装用户主题后仍需在外观菜单选择当前项目或全局应用。

## 创建与更新

`resource_write` 现在默认写项目级资源；旧调用若明确需要用户级，必须补上 `scope: "user"`。旧磁盘资源和授权不自动迁移。

```json
{"kind":"skill","name":"review-checklist","file":"SKILL.md","text":"---\nname: review-checklist\ndescription: 审查当前改动\n---\n先读取文件再判断。","previousHash":null}
```

用户明确要求跨项目时，在上述参数中增加 `"scope":"user"`。项目需先在管理中授权“允许写用户资源”；未授权时工具拒绝，不能退回 shell 绕过。写入授权和扩展代码/MCP 执行授权是两件事。写入返回 `scope`、实际 `path` 与 `hash`；更新必须传最新 `previousHash`，冲突后重新读取，不盲目覆盖。`rule` 仅允许 AGENTS.md，`mcp` 仅允许 mcp.json。多个文件分别写入后，检查资源、验证并申请重载；半成品不得报告为已生效。

## 带字体图片的跨项目能力

`customization_candidate` 是项目内的隔离开发候选，默认和实际范围均为项目。字体和图片用原始文件字节管理，不能塞进文本写入工具。用户需要跨项目交付时，把经过验证的源码与素材组织为含 `nekomimi.json` 的能力包，遵循 [平台指南](platform.md)，然后调用：

```json
{"action":"prepare","scope":"user","source":{"kind":"local","path":"./my-style-package"}}
```

这是 `customization_package` 参数。继续用返回的 id 调用 `inspect`，同时保持 `scope:"user"`；用户在管理中确认来源与权限后激活，再用 `customization_status` 检查范围和加载状态。prepare 不是激活，加载不是主题已应用。省略 scope 会准备项目级包，不能通过候选目录所在路径推断用户意图。

用户级共享资源在使用相同 home 的第二个工作区可被发现；新的工作区仍沿用自己的扩展授权。删除会话不删除资源；跨项目共享更新会影响其他工作区后续加载，应检查版本并保留包回滚入口。
