## Context

见 proposal.md 的动机和范围。当前没有已有应用或持久化数据需要迁移。选型依据为 [2026-09-15 验证报告](../../../docs/validation/2026-09-15/README.md)，发布包与源码快照已分别固定。

## Goals / Non-Goals

**Goals:** 以独立的 Journal → ContextView → WireRequest 边界建立可验收证据链，headless 先跑通完整生命周期。

**Non-Goals:** 不在本阶段实现双 UI、插件宿主或多任务调度；不宣称尚未实测的协议兼容性与提示词性能。

## Decisions

### 1. 已验证的框架边界

采用 Node 24 LTS、TypeScript strict、ESM，单 npm 工程内分模块，Vitest 做应用行为验证。固定 pi-agent-core/pi-ai 0.85.1，公开低层 Agent 负责循环，持久化状态归 Journal，Agent transcript 是可重建的运行中投影。

V02/V03 实测证明异步 tool_execution_start 订阅可阻止工具先于日志执行，异常时工具执行为零。模型 dispatch 与工具执行仍分别检查共享的 Journal 健康状态，原始流在 provider 层写入；不把业务持久化寄托于 UI 订阅。

替代方案 AgentHarness 已通过公开 MemorySessionRepo/Models 基本调用验证；它允许自定义 Storage，并非必然出现双写。但是普通事件异常会被隔离，默认 JSONL 无本项目 fsync 水位合约。为其实现完整 Storage/流证据/门禁会扩大第一阶段接入面，当前选择低层方案。后续若改用高层，必须以同一 Journal backend 为权威并跑存储合约测试，不能另建第二个权威 session。

### 2. 权威日志与持久化

每会话单写入器，JSONL 事件包含 schemaVersion、eventId、seq、timestamp、sessionId、runId 及适用的 modelCallId、attemptId、toolCallId。原始大内容先写临时附件并完成落盘，再按 hash 发布，必要的目录元数据同步完成后才追加引用事件。SQLite 暂不引入。

执行意图与最终请求在 dispatch 前 fsync；完成结果在宣告持久完成前 fsync。流数据以每 100ms 或累计 64KiB 刷盘为初始配置，先达到者触发；这是待产品压测校准的参数，并非已验证的延迟保证；写入阻塞时背压并暂停消费，不能宣称存在无条件墙钟丢失上限。记录并展示 durable seq，强制终止只保证恢复至实际 fsync 水位。日志失败停止新操作并尝试取消在途工作。

恢复允许隔离损坏尾行，保留原始字节；中段损坏、附件缺失或 hash 不匹配显式报错，不静默跳过。未完成副作用标记 unknown，不自动重跑。

### 3. 唯一模型入口

独立 adapter 复用 `@earendil-works/pi-ai/api/openai-responses` 的公开 stream 接口，包装每次调用的 onPayload/fetch。V05/V07/V12 已覆盖最终 payload、原始流、reasoning、失败/断流/incomplete、重试开关和取消，并通过真实 pi 路径回传历史。独立重写 parser 暂不采用。

adapter 在最后的 onPayload 按 ContextView 生成 authoritative input/tools/instructions，去掉重复的系统消息；或显式设置 supportsDeveloperRole:false 使用 system。不得把系统指导落到 developer。thinking 默认 tool_choice:auto；不把指定函数的 tool_choice 作为兼容行为。未知能力组合本地报错或走版本化允许列表，不能静默降级。compaction 的工具关闭组合在该能力实施时单独验证。

streamFn 强制 `maxRetries:0`，每次网络尝试由外层调度。fetch 在真正发送前取得最终序列化 body，保存 hash、上下文引用并持久化；认证头从日志排除。原始响应通过单条流式 TransformStream 在 parser 之前写入附件；不使用无界 Response.clone/tee 分支。HTTP 非 2xx 响应体、状态和允许的响应头也记录。

原始 response items 独立留存，下一轮从自有历史投影生成，尤其保留同一路由所需 reasoning 和 tool call/result 配对。V10 证明缺失 reasoning 可能返回 400。未知事件保存但不猜语义；incomplete 不允许执行未确认完整的工具计划。工具执行须等待对应完整响应验证及执行意图落盘。

pi EventStream 的 push/queue 本身没有容量上限，因此不能宣称仅配置 fetch 就获得全链路背压。原始网络链路等待 Journal 写入；应用保持快速消费语义事件，展示端独立合并状态。adapter 设置可配置的响应字节与事件数量硬上限，超过时中止并记录明确原因及不完整标记，不丢弃事件后继续冒充成功；应用集成测试验证慢盘与慢订阅者的内存行为。最大输出 token 单独限制。

取消完成以请求/进程实际结束为准。任何 parser 升级重新运行已保存 fixture 与真实合成冒烟；不依赖包内私有 parser 或 reducer。

### 4. 提示词与工具

稳定身份与工作原则，加启用工具声明的指导；固定排序与去重，并记录每片段来源/hash。用户输入和工具模型结果追加为带来源节点。完整 Rules 解析后置，本阶段支持显式提供的指令并保留来源。

工具有独立 schema、executor、模型输出投影和展示证据。V14 发现发布版 edit 会接受引号归一化的模糊匹配，且无读取历史约束；本项目自有 matcher 默认只允许定义明确的换行处理与精确匹配，日志记录实际区间，不继承模糊回退。read/edit/write 使用路径规范化、工作区边界检查及 symlink 逃逸检查；shell 作为用户主动启动的本地进程执行能力，不宣称是只读或安全沙箱。记录实际 cwd、shell、参数与输出。既有文件未读取或 hash 改变时拒绝覆盖，采用同文件队列、写前复核和原子替换，明确不提供跨进程无条件 compare-and-swap。

### 5. CLI 与导出

拟用 `harness run <prompt> --json`、`harness resume <session> <prompt>`、`harness replay <session>`、`harness export <session> --format html|bundle`。SIGINT 触发可追踪取消。重放只读，不隐式继续执行；resume 是显式新 run。

HTML 自包含且转义不可信内容，默认生成脱敏阅读视图。诊断 bundle 包含 manifest、Journal 与全部引用附件和 hash；删减版标记不可精确继续。凭证不进入任何原始日志；其他敏感任务内容可经导出脱敏，脱敏副本不修改源记录。

## Risks / Trade-offs

- 上游 API 演进 → 固定本次实测版本，升级重新执行验证夹具。
- 真实模型协议与 fixture 偏离 → fixture 测试之外保留可选真实 DeepSeek 冒烟验证；未执行则明确标记。
- 高频 fsync 影响吞吐 → 流批量与关键边界强制落盘分开，测量延迟和实际水位。
- shell 和外部编辑存在副作用及竞态 → 明确本地执行边界、unknown 状态及禁止自动重放。
- 完整证据占用磁盘 → 附件流式写入和背压，磁盘耗尽按 Journal 失败处理，不静默采样。

## Migration Plan

已完成选型探针；接下来先应用工程，再日志、模型、上下文与工具，最后 CLI/导出和集成验证。没有旧数据迁移。通过版本化 fixture 守住首版格式；失败实验不发布。任何格式升级保留源数据并使用独立迁移步骤。

## 审查修复设计

流式凭证脱敏采用共享字节处理器，只保留可能成为凭证的尾部前缀，最多为最长凭证字节数减一，避免延迟无关 SSE 完整帧；shell 按 stdout/stderr 独立处理，receiveSeq 表示脱敏后证据块的接收发布顺序，各通道内容顺序保留。普通字节保持不变，匹配后写入替换文本并标记 redacted。模型响应只将已检查字节交给 parser，发现凭证则保留删减证据并结束 attempt；响应 offset 对应保存的证据字节，bytes 仍统计原始网络字节。流结束及失败时清理保留尾部。

Unix shell 取消保留 SIGTERM → 延时 SIGKILL 的完整进程组终止 Promise，等待该清理和 shell close，并检查进程组已不存在后记录终态，不能因输出管道先关闭而取消升级信号。Windows 等待 taskkill 结束，平台覆盖仍以实际测试为准。
