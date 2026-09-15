## Context

当前 `src/runtime.ts` 的 run 返回最终结果，支持 AbortSignal；onProgress 仅合并发布少量阶段通知，不能作为浏览器完整事件流。`journal.ts` 保存顺序事件和 durableSeq，但 readSession 一次加载历史；`export.ts` 已提供只读导出。当前没有 HTTP 服务、会话目录索引或前端依赖。动机和范围见 proposal.md。

本变更跨越运行生命周期、历史读取和新浏览器客户端，需要独立设计；现有 29 项测试作为回归基线，既有 CLI 和原始 Journal 仍可使用。

## Goals / Non-Goals

**Goals:** 建立从命令确认到执行、观察、停止、继续和证据下载的闭环；同一会话多个浏览器视图一致；前端状态可从持久化事实重建。

**Non-Goals:** 不另建 Agent 循环或模型入口，不在浏览器持久化权威历史，不提供跨工作区任意路径访问，不追求网络副作用的 exactly-once 保证。

## Decisions

### 1. 本地单工作区服务

拟新增 `harness web --workspace <dir> [--port <port>]`。Node 服务同时提供生产静态资源与 `/api/v1`；React/Vite 仅负责界面，开发使用同源代理。默认随机可用端口并打印入口，绑定 127.0.0.1，不开放远程监听选项。相比单独部署前后端，同源单包降低本地启动和授权复杂度；MVP 不增加路由框架，优先 Node HTTP 公共 API。

会话默认置于工作区 `.harness/sessions/`，只枚举服务管理目录下与规范化工作区匹配的会话。会话 ID 映射由服务端解析，拒绝 symlink 逃逸。已有外部 CLI 会话仍通过 CLI 检查/导入，不在本轮增加浏览器路径选择器。

同一工作区服务持有根级服务租约，防止两个 Web 服务争抢同一管理目录；会话 Journal 锁继续处理 CLI 与 Web 的写冲突。MVP 同一服务最多运行一个任务，其他会话可查看；第二个活动提交返回明确 busy，不建立隐式队列，避免多个会话同时修改同一工作区。

### 2. 连接授权与凭证

启动生成随机本地连接令牌，入口 URL fragment 携带令牌，浏览器读取后立即清除地址片段，以 Authorization 完成一次同源连接交换，服务设置 HttpOnly、SameSite=Strict 的会话 cookie，使刷新仍可读取；不把令牌写入浏览器脚本存储、查询串或日志。cookie 名称按端口隔离，服务重启重新授权。精确校验 Host，浏览器写请求校验同源 Origin，拒绝任意 CORS；所有会话和附件接口均需令牌。服务重启令牌失效，界面提示重新打开终端入口。

DEEPSEEK_API_KEY 只从服务端环境读取。没有凭证仍可浏览历史，但提交前返回配置缺失，不接受任务。附件只允许当前会话引用的 hash，不提供任意路径文件接口。下载用受认证 fetch 后创建临时下载 URL；敏感内容不进入 HTML 外部资源地址。

### 3. 命令、任务和崩溃边界

HTTP 提供创建/列举会话、读取快照、submit、cancel、订阅、附件和导出。提交携带 commandId；服务端以会话+commandId 记录负载 hash、runId 和确认状态。相同 ID 与相同负载返回原有结果，不启动第二次执行；不同负载返回冲突。

复用并扩展现有 run 的持锁初始化阶段，在模型或工具启动前将 command.accepted 写入同一 Journal，落盘后才确认 HTTP 接收。空会话元数据也通过 Journal 记录。活动运行由服务持有 AbortController，不绑定 HTTP 连接存活。没有单独的权威任务数据库；列表索引为可重建缓存。

重启扫描已接受而无终态的命令，展示 interrupted/unknown；不得因为客户端重发 commandId 自动调度它。用户必须检查状态并通过新的明确提交继续。取消幂等、绑定具体 runId，旧运行的取消不能影响新运行；只有运行时确认停止才显示 cancelled。优雅退出先停止接收任务、请求取消、等待终态；强制结束遵循 Journal 恢复语义。

### 4. 增量读取与 SSE

Journal 增加有界增量读取/已持久化事件通知，避免每个 chunk 都重新读取整个会话。快照在 durableSeq=N 建立，返回 revision 和游标；订阅从 N 之后补读并跟随新增已持久化事件。先补历史、再读取最新水位循环衔接，不依赖短暂内存通知的完整性。

SSE ID 使用会话内 Journal seq，客户端按 seq 去重；刷新先加载快照再补订阅。游标超出有效历史、恢复截断或版本不兼容时明确 reset，客户端重载快照，绝不重发 submit。慢客户端使用有界发送缓冲，超限断开后按游标恢复，不阻塞模型循环，也不静默跳过事件。

原始 response.chunk 仍为完整附件证据；共享投影器按 attempt 增量解析已持久化原始 SSE，构建文本与工具展示，保留跨 chunk 的解析状态和断流未完成标记。未知事件留在证据面板，不强行解释。展示投影可丢弃重建，不能反向决定模型上下文。列表分页，时间线窗口化，附件按需分段；不向每个客户端广播 base64 图片和所有原始 payload。

### 5. 工作台与检查面板

桌面默认三栏：会话列表、任务时间线、可折叠检查面板；窄窗口将列表/检查面板切为抽屉。主输入支持多行及明确提交操作。状态区分 connecting、running、cancelling、completed、failed、incomplete、interrupted，断线作为连接状态不冒充执行终态。

工具卡片使用通用参数/结果视图，文件变化补充 diff，shell 显示双通道摘要、退出码和超时原因。裁剪结果提供读取完整附件入口。界面不提供文件编辑或终端输入。

每次模型调用卡片聚合 attempts；检查面板提供 Prompt / Context / Request / Response / Usage 标签。Context 节点链接到 eventId/seq/itemIndex；请求展示对应 body/hash 和 revision；tool result 链到完整执行附件。usage 展示 provider 原始 token/缓存字段、首字节和总延迟，缺失显示未知，价格显示未提供。

Markdown 禁用原始 HTML，代码和协议文本按纯文本显示；工具/模型内容不能成为可执行 HTML。HTML/bundle 下载调用已有导出能力；仅对无活动 run 的会话提供导出，避免导出过程中源记录变化。浏览器脱敏字段使用 POST body，不使用 URL 参数。

## Risks / Trade-offs

- [事件流和快照竞态] → 用持久化水位和游标重读验收，而非把 onProgress 当成可靠消息总线。
- [大型原始证据导致 UI 卡顿] → 列表分页、时间线窗口化、响应摘要投影、附件按需读取；测试长日志和慢消费者。
- [接受确认后服务崩溃] → 相同 commandId 只返回已有 interrupted 状态，不自动重试；不宣称所有外部副作用恰好一次。
- [同工作区并发修改] → MVP 限制一个活动任务，保留现有文件新鲜度检查；外部编辑的竞态限制仍存在。
- [本地浏览器可触发 shell] → loopback、Host/Origin/令牌校验、会话限定附件、无默认 CORS；不把本地服务描述为 OS 沙箱。
- [新依赖和浏览器兼容性未验证] → 实施时查官方支持并锁定版本；macOS Chromium 为首个验收平台，其余平台明确记录实测范围。

## Migration Plan

先加入共享协议与服务集成测试，再添加 Web 工作台和证据投影；保留既有 run/resume/replay/export 命令。新增事件遵循现有 schemaVersion，未知展示事件不改变旧上下文投影。构建把静态资源纳入 npm files，干净安装验证 web 启动。

回退时停止 Web 服务并继续使用 CLI；不转换、覆盖原始会话或自动归档前序 change。新命令的去重语义只在支持它的 Web 服务版本内提供，旧 CLI 不被当成 Web 命令重试入口。
