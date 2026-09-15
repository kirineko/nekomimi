## Why

新项目尚无应用实现，需要建立可以验证“每次模型调用和工具操作均可追溯”的运行基础。在完成发布包、协议和工具基线验证后，建立 headless 证据闭环，为浏览器、上下文管理及多代理提供可信事实来源，对应 `spec.md` 第 3–7、12、13 节。

## What Changes

- 建立 TypeScript/ESM 工程，固定 `@earendil-works/pi-agent-core@0.85.1` 低层 Agent，通过已实测的异步生命周期边界接入自有 Journal。
- 建立 JSONL Journal、附件、持久化水位与崩溃恢复。
- 使用 `@earendil-works/pi-ai@0.85.1` 公开 Responses parser、onPayload/fetch 与独立 adapter；保存最终请求、所有 attempt、原始流和终态，显式处理 system/instructions、thinking 工具选择及 reasoning 回传。
- 实现带来源的提示词与上下文，以及 read/edit/write/shell 基础工具；采用精确匹配和新鲜度保护，不直接继承 pi 的隐式模糊回退。
- 提供 headless 运行、取消、显式继续会话、无副作用回放及离线导出。

### Non-goals

本变更不交付 Web/TUI、完整 Rules/Skills/MCP、自动 compact、缓存优化、subagents、后台任务、审批 UI 或市场客户端。npm 发布名与公开发布留到后续交付变更；本阶段验证本地 tarball。提示词优于 Deepy 的结论留待第二阶段对照实验。

## Verification Basis

[验证报告](../../../docs/validation/2026-09-15/README.md)记录了 16 项离线探针、11 次真实限长请求（包括两项 400 兼容性发现）及市场抽样。V01–V15 支持本阶段选型；V16–V22 定义后续复用与验收边界。AgentHarness 的公开存储接口可用，但默认事件/持久化行为未直接满足本项目合约，首版选择已验证的低层接入。提示词胜率、崩溃恢复、背压和跨平台产品验收仍需实现后测试。

## Capabilities

### New Capabilities

- `execution-journal`: 有序事件、附件完整性、水位及异常恢复。
- `model-call-evidence`: Responses 最终请求、原始响应、重试与取消证据。
- `prompt-context-provenance`: 工具提示贡献、确定性上下文与来源追溯。
- `core-tools`: 基础工具、文件新鲜度保护及输出证据。
- `headless-session-export`: 无 UI 运行、会话继续、回放和离线导出。

### Modified Capabilities

无。新项目没有已交付能力规格。

## Impact

拟新增 journal、runtime、provider、context、tools、cli、export 模块与协议 fixture。应用依赖固定到验证版本，升级另行复测；不会修改原 Deepy 项目。日志格式及命令输出从首版起版本化。
