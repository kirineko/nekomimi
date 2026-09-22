## Why

Nekomimi 已具备编写文件、执行命令和可追溯会话，但用户通过对话创建的工具、工作流和界面定制尚不能被产品发现、启用和持续使用。下一阶段需要建立可自定制的能力层，把 Extensions、Skills、Rules 和 MCP 纳入同一资源生命周期，在保留 Journal 权威历史的基础上完成当前会话内的定制闭环。

## What Changes

- V1 提供项目级与用户级资源发现、来源管理、启停、校验和运行间重载；扩展 SDK 支持工具、命令、有限生命周期钩子和命名空间状态。
- 支持标准 SKILL.md 的发现、按需读取与显式调用；支持 AGENTS.md 的目录作用域和按目标路径加载，不将规则文本视为授权。
- 接入 MCP stdio 与 Streamable HTTP 的工具发现、调用、取消、列表变化和错误语义；凭证引用仅在服务端解析。
- Web 提供扩展管理与状态、卡片、表单插槽；headless 明确报告交互能力缺失。自定义命令通过统一协议执行。
- 随安装包交付版本匹配的 SDK 类型、文档、示例和校验入口，允许 Agent 创建、修复、加载并实际使用定制功能，无需修改 Nekomimi 安装代码。
- 所有受宿主管理的工具与模型调用复用证据入口；资源快照、状态、上下文和 UI 展示分别记录，历史回放不加载可执行扩展。
- 分两版交付：本 change 实施 V1；design 描述 V2 的 Provider、高级工作流、自定义前端组件、MCP resources/prompts、分发和隔离扩展边界。V1 验收通过后另建 V2 change。
- 对应 spec.md 第 3–5 节的证据/提示词/工具、第 8 节的 Web 协议、第 9 节的 Skills/Rules/MCP/市场，以及第 11–12 节的权限与工程边界。

V1 非目标：任意 React 代码加载、第三方 Pi 扩展直接兼容、Provider 插件、工作流崩溃后自动续跑、MCP resources/prompts/OAuth、扩展市场和 npm/git 安装器、任意代码强制沙箱。V1 的本地可执行扩展属于可信代码；不宣称 SDK 能拦截其任意文件或网络访问。

## Capabilities

### New Capabilities

- `customization-resources`: 资源身份、作用域、启停、信任、版本快照及重载。
- `extension-runtime`: 版本化 SDK、工具/命令/钩子、受记录执行与扩展状态。
- `skill-rule-loading`: Skills 渐进加载和 Rules 目标路径作用域。
- `mcp-tool-integration`: MCP 连接、命名、调用、取消、变更与协议证据。
- `web-customization`: 管理界面、声明式插槽、用户交互和无插件历史显示。
- `self-customization-workflow`: 安装包内开发资料、校验及对话定制闭环。

### Modified Capabilities

- `prompt-context-provenance`: 扩展工具、Skills、Rules 和资源快照进入提示词/上下文来源契约。
- `model-call-evidence`: 扩展通过宿主发起的模型调用保留独立用途与外层调用关联。

## Impact

- 改造 src/runtime.ts 的固定工具装配、src/tools.ts 的内置执行包装、src/context.ts 的来源模型；保持 pi-agent-core/pi-ai 公开接口和当前固定版本，除非后续兼容性验证证明必须升级。
- 新增资源加载、扩展宿主、MCP adapter、Skills/Rules 解析及公开 SDK 子路径；SDK 不暴露私有 Agent、可变 Journal 或框架消息内部类型。
- 扩展 src/server、src/shared/protocol.ts、src/web 的命令、交互和资源管理协议；沿用本地授权、提交去重和单活动运行约束。
- 调整 package.json 发布清单，交付开发资料与示例；拟引入固定版本的 TypeScript 运行加载器及官方 MCP TypeScript SDK，具体版本在实施时按协议与 Node.js 22.19.0 兼容性验证后锁定。
- 新增不依赖真实模型/外部账户的生命周期、MCP、故障、浏览器和安装包验收；真实模型自定制演练为单独记录的产品验证，不作为 CI 前提。
