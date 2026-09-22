## Why

V1 已建立本地扩展、Skills、Rules、MCP tools 和声明式 UI 的基础，但用户仍不能把一次对话产出的定制能力可靠地打包分享、升级，或扩展模型、可恢复工作流和前端面板。V2 将补齐这些环节，使 V1 + V2 基本兑现“需要命令、工具、Provider、工作流或 UI 调整时，直接让 Nekomimi 构建并持续使用”的最初目标，并产出可安装、可迁移、可发布的版本候选。

## What Changes

- 提供对话定制开发流程：版本匹配的 SDK 查询、脚手架、完整类型检查、候选测试、结构化修复反馈、预览、激活与代码版本回退。默认走项目候选目录，避免直接破坏已启用版本。
- 支持统一能力包，组合 Extensions、Skills、按作用域生效的 Rules、MCP 配置、Provider、工作流和 UI；支持本地、npm 和固定 Git revision 的安装、依赖锁定、更新差异、导出/导入及卸载。
- 增加独立扩展进程与版本化宿主 RPC，支持中断、故障隔离、资源版本归属和宿主服务授权；保留 V1 SDK 兼容适配。进程隔离不宣称操作系统权限沙箱。
- 开放 Provider 注册、模型能力描述与凭证引用。默认 DeepSeek 路径保持可用，交付 Responses 与 Chat Completions 两类 HTTP JSON/SSE adapter 示例；主对话、扩展辅助调用和自动命名使用统一注册及记录边界。
- 支持持久工作流、步骤检查点、等待用户输入、显式恢复和有限事件触发；区分会话与工作区状态，结果未知的副作用不得自动重跑。
- 扩展 MCP resources/templates、prompts、资源订阅和 HTTP OAuth 授权，保留 tools 与两种 transport；上下文注入需有来源和版本，凭证只由宿主管理。
- 支持隔离的自定义 Web 面板、工具结果 renderer 和主题 token；提供宿主交互桥接、声明式回退及不依赖插件的历史导出。
- 分三个实施批次：基础与开发/分发 → Provider/MCP → 工作流/UI。批次属于同一个 V2 交付范围，不能以第一批通过代替 V2 完成。
- 交付 V1 + V2 组合验收、兼容迁移、跨平台安装、真实模型演练、文档与版本候选 tarball。候选版本建议 0.2.0，实施时按 registry 与实际兼容性确认；本次 proposal 不修改包版本，也不执行公开发布。
- 对应 spec.md 第 3–5 节的证据/提示词/工具、第 8 节的 Web 协议、第 9 节的 Skills/Rules/MCP/分发及第 11–12 节的权限和工程边界。

非目标：公共扩展市场服务、第三方 Pi 扩展无修改兼容、任意协议 Provider 的内置实现、系统级后台 daemon/分布式调度、任意代码强制 OS 沙箱、多用户协作、TUI。上述边界不排除用户通过受支持 SDK 编写自己的工具与流程。

## Capabilities

### New Capabilities

- `customization-development`: 对话开发、候选版本、类型检查、真实与模拟试验边界、修复和回退。
- `customization-packages`: 多类资源能力包、来源、依赖锁、安装/更新/卸载与权限差异。
- `extension-process-host`: 独立执行进程、SDK 兼容、宿主 RPC、授权和故障生命周期。
- `custom-model-providers`: Provider 注册、模型选择、能力检查、凭证和历史兼容边界。
- `durable-custom-workflows`: 持久步骤、状态作用域、等待/恢复、触发与未知副作用处置。
- `mcp-context-and-auth`: MCP 资源、提示模板、订阅、OAuth 与上下文证据。
- `custom-web-panels`: 隔离面板、renderer、主题、交互桥接与历史回退。
- `customization-release-readiness`: V1/V2 组合闭环、迁移和可交付安装包的验收契约。

### Modified Capabilities

- `local-user-configuration`: 将单组模型配置扩展为 Provider profiles，开放 Web 模型/端点配置并保留服务端凭证隔离与旧配置迁移。

- `model-call-evidence`: 将固定 DeepSeek 主调用约束拓展为经验证的 Provider adapter，保留 DeepSeek 专有语义和统一逐 attempt 证据。
- `prompt-context-provenance`: 纳入能力包、MCP 内容、工作流步骤及 Provider 投影来源，不将动态资源当作隐式授权。

## Impact

- 以 `enable-user-customization-mvp` 的 35 项已完成任务及验收记录为前置基线；它尚未归档。V2 实施首先复验并同步/归档 V1 能力契约，不把 V1 再复制为另一套实现；本次不修改 V1 artifacts。
- 重点影响 `src/customization/`、`src/extensions.ts`、`src/runtime.ts`、`src/provider.ts`、`src/recorded-call.ts`、`src/context.ts`、`src/config/`、`src/server/`、`src/web/` 和离线导出。
- 增加 SDK 2 与 SDK 1 适配、包/工作流/UI 的版本化协议；旧 Journal 只读展示保持兼容，配置迁移留备份，权限扩展需明确授权，不承诺任意历史跨 Provider 无损继续。
- 复用现有 TypeScript、Jiti、MCP SDK 和公开 pi 接口。打包器及 OAuth 接入仅在最低 Node 和跨平台探针验证后固定依赖；不假定上游 latest API 已受支持。
- 扩展现有单元、浏览器、pack smoke 与 CI；模型账户和生产 MCP 服务不成为 CI 前提。现有标签 CI / 正式 Release 发布流程保持，公开上传另按发版指令执行。

## 本轮交付范围调整（2026-09-22）

用户明确要求“暂不验证 Linux、Windows”。本轮交付 macOS / Node 22.19.0、24.15.0 验证的 0.2.0 本地候选，不宣称 Linux、Windows 已通过。原跨平台门槛和公开发布 CI 保留；对应原生验证、全平台候选核验和最终归档暂不完成，不把延期记为通过。
