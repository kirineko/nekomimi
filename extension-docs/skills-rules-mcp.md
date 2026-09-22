# Skills、Rules 与 MCP

项目技能：.agents/skills/<name>/SKILL.md。用户技能：~/.agents/skills；自定义 --home 时使用 <home>/skills。

```markdown
---
name: review-checklist
description: 审查修改的行为、错误路径和测试覆盖
---
先读取改动文件，逐项检查行为、失败路径、测试覆盖；不能仅依据 diff 摘要声称完整审查。
```

正文通过 resource_read 按 ID 加载，或用户显式 /skill:review-checklist。名称冲突需要消歧；项目覆盖用户版本。仅元数据常驻，不自动载入全部正文。

Rules 使用 ~/.nekomimi/AGENTS.md 和工作区 AGENTS.md、嵌套目录 AGENTS.md。文件工具按目标目录加载，更具体规则只对该路径适用；变化后先向模型呈现再重新请求操作。shell 的任意隐含目标不能全面静态分析，只使用已知 cwd 规则。规则不授予文件访问权限。

MCP 项目配置：.nekomimi/mcp.json；用户配置：~/.nekomimi/mcp.json。使用以下结构：

```json
{"version":1,"servers":{"local":{"transport":"stdio","command":"node","args":["./server.mjs"],"env":{"SERVICE_TOKEN":"SERVICE_TOKEN"}},"remote":{"transport":"http","url":"https://example.com/mcp","credentialEnv":"MCP_TOKEN"}}}
```

env 的值是服务端环境变量名称，credentialEnv 是 Bearer token 的环境变量名称，不要填入密钥。HTTP 仅支持 HTTPS 或本机 HTTP，拒绝 URL 中的凭证和查询参数。OAuth-only 服务不受 V1 支持。

用户启用连接后发现 tools；模型名称带服务器标识和工具名称摘要，具体原名在描述中。content/structuredContent/isError 保留在证据，资源引用不会自动读取。工具列表更新在运行结束后重载。断线或取消后的 unknown 不自动重跑；取消并不保证远端副作用撤销。
