# 源码模块边界

## 核心运行域

根目录现有 `runtime.ts`、`provider.ts`、`journal.ts`、`context.ts`、`tools.ts`、`export.ts` 分别负责 Durable Harness 循环接入、模型 transport、权威历史、模型输入投影、工具执行和离线导出。它们不依赖 React 或 Web 服务。`redaction.ts` 提供流式字节脱敏，在 shell 和模型响应落盘前处理跨块凭证。

`index.ts` 是公开入口；`cli.ts` 仅负责命令解析和启动。新客户端应调用运行时或服务协议，不另建模型调用入口。

`recorded-call.ts`为每次网络attempt提供唯一派发入口和原始响应背压；内置与自定义Provider共用重试条件。产品取消立即传入transport，网络完成记录落盘后再次检查取消，避免发布迟到值。

## Web 增量模块

| 目录/文件 | 职责 |
| --- | --- |
| `shared/protocol.ts` | 可供浏览器导入的纯协议类型和输入校验；禁止 Node 运行时依赖 |
| `server/app.ts` | 本地 HTTP 路由、静态资源、启动/关闭 |
| `server/http.ts` | 授权、请求读取、响应及显示裁剪 |
| `server/sessions.ts` | 工作区租约、会话管理、命令去重、运行取消 |
| `server/journal-reader.ts` | 按持久化水位增量读取与 hash 链校验 |
| `server/stream.ts` | SSE 游标、补读、慢消费者断开 |
| `server/evidence.ts` | 会话附件分页/完整性、上下文索引、下载临时文件 |
| `projection/session.ts` | 从原始 Journal 构建可丢弃的展示投影；不得参与模型请求决策 |
| `web/api.ts` | 浏览器 HTTP、连接交换与 SSE 解码 |
| `web/hooks/useSession.ts` | 快照、重连、去重及历史窗口 |
| `web/components/` | 共享富文本、文件、diff、输入编辑器及安全面板容器 |
| `web/main.tsx`、`web/v2/app.tsx`、`web/v2/router.tsx` | 默认双工作台入口与路由；先连接再规范化 URL，不接触文件系统和模型凭证 |

## 构建与扩展

Node 的 tsconfig 排除 `web/`，浏览器 tsconfig 只包含 `web/` 与 `shared/`。Vite 产物放入 `dist/web-dist/`，Node 服务从安装包相对路径读取，无开发机绝对路径依赖。

新增工具保持核心执行与 Web renderer 分离；新增证据视图通过现有 call/seq/hash 关联读取。修改协议行为时同步 OpenSpec 场景和 server/browser 测试，不能把 UI 缓存当成权威状态。

执行追踪阅读组件：`web/v2/routes/inspection.tsx` 按调用显示有序记录，`artifact-reader.tsx` 分页读取附件，`context-details.tsx` 按需读取上下文详情；`server/evidence.ts` 的 `tracePage` 和 `contextPage` 提供只读分页投影，均不参与模型请求构造。

## 配置与会话生命周期

`config/` 管理文件配置和交互配置，`storage/` 管理用户根目录、工作区分区和显式迁移，`session/title.ts` 管理可记录的辅助命名。`server/sessions.ts` 统一运行、命名、下载与删除门禁；`presentation/` 提供 Web/离线共用的纯展示组件和工具结果解析，`export/html.ts` 负责无脚本的自包含阅读视图。

`session/identity.ts`定义不可变工作/创造身份、规范目标及宿主版本，执行前检查目录身份。会话首条Journal固定binding，路径ID与Journal sessionId一致；工作区session-catalog Journal协调创建意图和收据、保留删除标记，不保存模型或工具历史。HTTP创建使用显式commandId/mode/target；导航只读，任务另行提交。没有模式身份的历史可观察但不能继续运行。

## 定制运行域

`extensions.ts` 是公开 SDK 子路径；`customization/types.ts` 保持 JSON 契约，不暴露 pi 内部对象。`resources.ts` 管理发现、授权、摘要和用户资源写入；`host.ts` 负责候选加载、注册和切换；`run.ts` 负责固定运行快照、规则/技能、嵌套 SDK 服务和命令。`execution.ts` 是内置、扩展、MCP 共用的落盘边界；`mcp.ts` 用固定版本 Pi MCP 的公开 client/transport 维护单连接 owner，保留官方协议 schema/URI 与宿主 OAuth 适配；`interactions.ts` 管理实时表单，`trial.ts` 提供独立显式试运行。

Web 只导入定制类型，扩展源代码和凭证不发送至客户端。所有新历史事件和 artifact 仍由 Journal 保存；回放与导出不创建宿主。

工具管线先固定schema/能力版本、准备参数并执行一次权限与前置hooks，再消费一次性准入对象写入意图和调用executor。Durable工具桥不重复校验真实产品schema；模型请求仍使用完整schema。后置hooks只观察副本，失败另记观察错误，不能覆盖已持久工具结果。

## Durable 接入边界

`pi/journal-storage.ts` 将 Durable 1.0.4 的公开 Storage 批次提交到唯一 Journal，并通过公开 MemoryStorage 重建读取投影。它不使用框架原生持久 store；先验证会话格式，持久化/投影失败后阻止当前实例继续操作。`pi/recovery.ts` 将只读观察与用户显式继续分开；恢复时保留 unknown、撤回旧排队输入并标记旧任务后才允许调度。

`pi/model-service.ts` 为 chat/classifier/image 和各请求用途提供同一个受记录 transport，冻结最终请求、逐 attempt 记录并按原始流背压保存证据。`pi/task-context.ts` 将 Journal 失败信号接入公开 Context，让框架等待和派发遵守产品失败边界；网络完成事实与已取消任务的结果发布分别处理。

`pi/durable-loop.ts` 已接入正式 `runtime.ts`，公开 Harness 管理 generation、tool 和 submission。Provider 继续独立从 Journal 构造最终请求。提交订阅将原生结果串行投影到产品事件，下一请求与运行终态等待投影完成；取消先收敛原生任务，再记录产品终态。原生通知型钩子会吞异常，产品轮数和失败门禁因此通过独立取消信号阻止再次派发。

`tool-contracts.ts` 是产品工具契约，`pi/tool-adapter.ts` 转换为公开 ToolRegistration，固定 sequential 与 replay unsafe。未知执行仍由 `pi/recovery.ts` 的显式门禁处理。旧 Agent 及过渡模块已删除，AI、Durable、Chord 均固定1.0.4。

`storage/format.ts` 提供新版分区和契约的只读准入检查，正式配置、工作区、定制授权及会话入口已接入预检，旧格式在写入前拒绝。新会话通过 Journal Storage 拥有唯一物理历史。

当前已接入工作/创造身份、交接、Codemode、类型化模型调用及双工作台。各阶段测试只证明对应版本和范围；最终状态见 `docs/validation/next-generation-nekomimi/README.md`，不得将历史单批测试数字当作最新全量结果。


## Codemode 运行边界

`pi/codemode.ts` 只接入固定公开 sandbox/worker/WASM 和宿主资源限制；`codemode.ts` 提供产品工具目录、嵌套准入/因果记录、取消收敛和输出投影。`codemode-budget.ts` 控制同运行及同资源并发，`codemode-state.ts` 只读重建成功状态；历史分支显式复制状态快照。所有子执行复用 `customization/execution.ts`，没有直接原 executor 后门。分类/图片入口通过 `pi/model-service.ts` 使用固定用途、输入/output 契约及同一模型记录链；图片与真实模型验证范围以验收记录为准。


## 项目交付与界面加载

`server/candidate-delivery.ts` 审核来源/目标身份、确切内容与计划 revision，持久命令意图先于副作用；无终态返回 unknown，不重复执行工厂。`customization/candidates.ts` 将原始素材复制为目标项目不可变内容，`host.ts` 在工作项目空闲边界授权和加载。交付日志单独检查格式并对已配置凭证脱敏；交接快照不等于激活。

`web/v2/deferred.tsx` 管理成功导入缓存、局部重试及迟到结果。完整会话页面、上下文详情和低频对话框按需加载；普通消息渲染保持同步，避免逐行异步占位破坏虚拟列表测量。视图的原始记录 ID、阅读位置和草稿归属不随路由分块改变。
