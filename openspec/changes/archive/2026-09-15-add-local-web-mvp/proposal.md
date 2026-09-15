## Why

Headless 内核已经能够执行任务并保留证据，但用户仍需通过命令行提交任务、读取 JSON 和单独导出才能理解执行过程。下一步需要本地浏览器入口，把提交、观察、取消、继续以及请求溯源连成可日常使用的最小闭环。

## What Changes

- 新增本地 Web 启动入口：单用户，启动时固定一个工作区，管理该工作区内的多个会话；服务端持有模型凭证。
- 增加 HTTP 命令和 SSE 订阅，支持提交去重、会话快照、游标补读、断线重连和取消；浏览器断开不取消已接收任务。
- 提供会话列表、实时任务时间线与输入区；工具卡片显示状态、参数、结果、文件 diff 和错误，支持完成或停止后继续任务。
- 提供按模型调用打开的证据面板：Prompt 来源、Context 节点、实际请求、原始响应及 usage/缓存/延迟；不展示未经验证的货币费用。
- 在浏览器内下载 HTML/完整或显式脱敏诊断包；静态页面与服务随同一个 npm 包交付。
- 对照 `spec.md` §8.1–8.3、§12 技术栈表与第三阶段浏览器检查器：本轮选取执行和可观测性闭环；steer、respondInteraction、请求版本对比和复杂缓存分析延期。
- 非目标：多用户、远程部署、运行中追加指令、交互审批、文件编辑器、终端模拟器、模型迁移、TUI、MCP、Skills、子代理。图片上传 UI 与诊断包导入 UI 延期，原 CLI 能力保留。

## Capabilities

### New Capabilities

- `local-web-service`: 固定工作区的本机服务、会话管理、连接授权与命令生命周期。
- `web-session-stream`: Journal 派生快照、可靠事件订阅、去重、断线和服务重启行为。
- `web-task-workbench`: 会话列表、输入、时间线、工具结果与取消/继续交互。
- `web-evidence-inspector`: 调用来源追溯、有界附件查看、usage 和浏览器导出。

### Modified Capabilities

无。复用已实现的 headless 能力，不改变其既有契约。前序 `establish-observable-headless-core` 已完成但尚未归档；本 change 只新增 Web 契约，不重复声明其能力。

## Impact

- 预计新增 server、Web UI、共享协议/展示投影模块；扩展 CLI 启动命令、Journal 增量读取及运行时进度投影接口。
- React/Vite 沿用研究选型；具体版本在实施时核对官方支持范围并锁定，规划阶段未做新增依赖安装。
- 保留 pi 公共调用边界、Journal 权威历史和现有 CLI；不让浏览器直接访问任意磁盘路径或持有 API key。
- 增加 HTTP/SSE 协议测试、浏览器端到端验收和携带静态资源的 npm pack 验收。前序 change 的归档不作为本轮隐式操作。
