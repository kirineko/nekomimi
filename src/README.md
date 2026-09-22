# 源码模块边界

## 核心运行域

根目录现有 `runtime.ts`、`provider.ts`、`journal.ts`、`context.ts`、`tools.ts`、`export.ts` 分别负责 Agent 循环接入、模型 transport、权威历史、模型输入投影、工具执行和离线导出。它们不依赖 React 或 Web 服务。`redaction.ts` 提供流式字节脱敏，在 shell 和模型响应落盘前处理跨块凭证。

`index.ts` 是公开入口；`cli.ts` 仅负责命令解析和启动。新客户端应调用运行时或服务协议，不另建模型调用入口。

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
| `web/components/` | 会话列表、任务输入、时间线、检查面板和附件视图 |
| `web/App.tsx` | 页面组合与会话选择；不接触文件系统和模型凭证 |

## 构建与扩展

Node 的 tsconfig 排除 `web/`，浏览器 tsconfig 只包含 `web/` 与 `shared/`。Vite 产物放入 `dist/web-dist/`，Node 服务从安装包相对路径读取，无开发机绝对路径依赖。

新增工具保持核心执行与 Web renderer 分离；新增证据视图通过现有 call/seq/hash 关联读取。修改协议行为时同步 OpenSpec 场景和 server/browser 测试，不能把 UI 缓存当成权威状态。

执行追踪阅读组件：`web/components/ExecutionTrace.tsx` 按运行显示有序记录，`WireContent.tsx` 渲染协议内容；`server/evidence.ts` 的 `tracePage` 和 `contextPage` 提供只读分页投影，均不参与模型请求构造。

## 配置与会话生命周期

`config/` 管理文件配置和交互配置，`storage/` 管理用户根目录、工作区分区和显式迁移，`session/title.ts` 管理可记录的辅助命名。`server/sessions.ts` 统一运行、命名、下载与删除门禁；`presentation/` 提供 Web/离线共用的纯展示组件和工具结果解析，`export/html.ts` 负责无脚本的自包含阅读视图。

## 定制运行域

`extensions.ts` 是公开 SDK 子路径；`customization/types.ts` 保持 JSON 契约，不暴露 pi 内部对象。`resources.ts` 管理发现、授权、摘要和用户资源写入；`host.ts` 负责候选加载、注册和切换；`run.ts` 负责固定运行快照、规则/技能、嵌套 SDK 服务和命令。`execution.ts` 是内置、扩展、MCP 共用的落盘边界；`mcp.ts` 负责官方 MCP transport；`interactions.ts` 管理实时表单，`trial.ts` 提供独立显式试运行。

Web 只导入定制类型，扩展源代码和凭证不发送至客户端。所有新历史事件和 artifact 仍由 Journal 保存；回放与导出不创建宿主。
