## Context

动机见 proposal.md。现有 React 工作台已有会话、任务轮次、诊断、设置及 Inspector；`styles.css` 与后加载的 `styles/workbench.css` 存在覆盖关系，后者全局 textarea 聚焦规则造成截图中的内层方框。`tools.ts` 已保存 before/after/patch，`ToolCard` 使用通用 Artifact 文本分页，尚无专用 diff 视图。`ResponsesProvider` 同时承担协议转换与调用记录，直接在新搜索工具里 fetch 会绕过现有观测入口。

本地调研依据：`../deepy/src/deepy/tools/web/deepseek_search.py` 使用 Messages 服务端搜索及按调用 ID 解析来源；`reference/dsh/packages/client/ui-primitives/src/DiffBlock.tsx` 与 ui-tool 的 diff-card-model 提供轻量折叠卡片；dsh 的 `packages/web/web-search-deepseek/src/` 提供独立搜索 endpoint。Deepy 的模型默认值与 dsh 不同，真实可用性尚未实测。`spec.md` §5.2 讨论的是项目文本搜索，本提案新增网页搜索，不替换 bash + rg 基线。

## Goals / Non-Goals

**Goals:**
- 用同一工作台结构承载任务、文件产物、修改与证据；视觉风格在普通使用和检查状态下连续。
- 保持 Journal 权威及主模型历史保真，让新协议、文件浏览和展示投影各自独立。
- 按可独立验证的模块实施，兼容旧会话及 npm 单包。

**Non-Goals:**
- 不复制 dsh 的依赖体系或将浏览器改为 IDE；不把文件树缓存作为文件修改证据。
- 不对整个文件系统做监控，也不为未记录的 shell 修改生成推断历史。

## Decisions

### 1. 视觉方向与信息架构

采用“浅色、中性表面、紫色强调”的工作台。保留现有品牌，减少大面积浅紫卡片和重复描边。颜色及数值为实施基线，最终以可读性和视口验收为准：

| 项目 | 基线 |
| --- | --- |
| 背景 / 表面 | #F7F7FA / #FFFFFF；侧栏使用轻微中性色差 |
| 正文 / 辅助文字 | #292633 / #696273；普通文字对比度至少 4.5:1 |
| 主色 | #7952CE；用于主按钮、选择和焦点，避免用于整段正文 |
| 边框 / 圆角 | 中性细边框；控件 8px、卡片 12px、Composer 18px |
| 间距 | 4/8/12/16/24/32px；清理散落的近似尺寸 |
| 排版 | 系统字体与中文回退；正文 15–16px，辅助 12–13px，代码 13px |
| 消息宽度 | 正文约 72ch；代码、diff 可使用更宽区域，局部横向滚动 |

桌面布局示意（图内只用 ASCII）：

```text
+------------+-----------------------------+----------------------+
| Brand      | Workspace    Status Actions | Files Changes Trace  |
| New task   +-----------------------------+----------------------+
| Sessions   | User task                   | Tree / change list / |
|            | Tool + short diff / sources | selected evidence    |
|            | Assistant answer            |                      |
|            |                             |                      |
| Settings   +-----------------------------+                      |
| Local      | Composer                    |                      |
+------------+-----------------------------+----------------------+
```

左侧约 232px，右侧约 360px，中央最小可读宽度约 560px。低于约 1200px 将右侧改为抽屉；低于约 768px 会话栏也改为抽屉，两个模态抽屉不同时叠加。右侧默认收起，顶部明确提供入口；打开后记住当前页，切换会话清理旧详情选择。首版不增加拖拽分栏。

覆盖完整视觉清单：侧栏选中/悬停、顶栏动作层级、初始空态、消息与 Markdown、工具进行中/失败/成功、搜索来源、diff、Composer、设置表单、导出表单、删除对话框、诊断提示、检查器。空态用简洁说明，避免新增无实现的推荐操作。焦点、禁用、加载、空数据和错误状态与常态一起设计。尊重 reduced-motion；状态文字始终保留。

替代方案：仅修输入框会保留整体比例和信息层级问题；全面换组件库增加迁移风险。选择共享 CSS tokens 与现有 React 组件重整，按组件归属清理覆盖规则。

### 2. Composer 与面板状态

textarea 去掉内部聚焦 outline，由容器 focus-within 提供清晰单一反馈；按钮仍保留自己的键盘焦点。最小文本高度约 48px、最大约 180px，使用受支持的自动尺寸能力并保留 fallback。底部显示模型与发送/停止，快捷键帮助保持次要层级。

面板状态独立于选中会话和 Composer 挂载，不因切换标签重建输入。保留现有 IME、去重和确认后清空逻辑，不改变运行中提交规则。详情页复用 Inspector 的内容，避免同时存在两个右侧检查器。抽屉采用焦点管理、Escape 关闭与触发点恢复，文件树具有键盘展开、选择和打开能力。

### 3. Diff 数据与投影

以现有成功工具结果的 before/after/patch artifact 为输入，新增纯展示模型；`file.change_prepared` 仅说明意图。成功必须由匹配的终态证据确认。旧记录缺字段时展示可用原始证据和降级说明。

复用已固定的 diff 库公开解析接口，按 hunk 生成新旧行号及上下文，不直接照搬 dsh 对旧/新文本全量计数。默认卡片约 8 行，详情按 hunk 加载或折叠；大 artifact 不直接整份拉入浏览器。服务端提供按行/hunk 有界投影及完整统计，仅对完整有效证据给出总量；无换行末行、CRLF、新文件、空文件、无变化和脱敏损坏均需处理。

新增会话只读 changes 查询，按 runId/toolCallId/Journal 顺序分页；右侧列出逐次修改，点击进入同一 diff 组件。该列表独立读取完整 Journal 投影，不依赖当前对话已经加载了哪些页。可按 artifact hash 缓存解析结果，但缓存可删除重建。

HTML 导出复用安全的 diff 展示数据和静态样式，保留原始 patch；旧 bundle 保持可读，新格式只增加可选投影字段。禁止回放时读取实时文件补齐内容。

### 4. 文件树与默认程序打开

拟新增 `GET /api/v1/workspace/files?path=...&cursor=...&hidden=...` 和 `POST /api/v1/workspace/open`，复用现有认证、Origin/Host 及请求体限制。GET 默认根目录，每页建议 200 项，限制最大页长；返回相对路径、类型、可继续游标。游标绑定目录和过滤条件，目录变化导致快照失效时要求刷新，避免错页。

目录按需读取，不递归扫描 node_modules 等大树；隐藏项默认关闭，仅按用户展开加载。校验允许根目录本身被列举，复用 resource-path 的规范化思路但不能原样沿用其排除根目录的函数。realpath/lstat 验证目录和普通文件，禁止越界 symlink、设备和 FIFO；打开前再次检查实际目标，拒绝目录 open 请求。

平台适配器通过参数数组调用 macOS open、Linux xdg-open、Windows ShellExecute 等价打开机制；Windows 避免将路径拼入 cmd/start 或 PowerShell 源码。具体适配器实现必须通过特殊字符路径测试，若采用公开 opener 依赖则锁定版本并验证 Windows 原生行为。浏览器只得到请求已提交或错误，不声称 GUI 已展示。

打开是用户直接动作，属于工作区 UI 操作，不伪装为模型 tool.result，也不改变 ContextView；不需要创建会话才能浏览文件。连续双击在请求处理中去重，无自动重试。成功 edit/write 后使相关树缓存失效，外部修改靠刷新。远端/无桌面环境明确提示无法本机打开。

### 5. 搜索工具与协议记录

新建独立搜索适配器，向 CoreTools/工具注册层注入依赖，仍输出标准 content/details。将 ResponsesProvider 中通用的 modelCallId、attemptId、请求序列化后落盘、响应证据、脱敏、终态及取消提取为 recorded-call 层；主调用、自动命名和搜索均使用它。Responses parser 不承担 Messages 解码。

关联链为 runId -> toolCallId -> modelCallId -> attemptId；增加用途 web-search 与协议标识，搜索输入来源指向外层工具参数。搜索自己的 Messages blocks 保存在独立证据中，不追加为主模型的 Responses items；主历史只包含原 tool call 和其有界 tool result。检查器按协议选择展示，不将搜索响应当作主助手回答，也不重复统计 token。

配置新增可选 search 对象。建议新安装默认启用，旧配置缺省也启用，但只在模型实际调用时联网；缺 key 时明确错误。沿用服务端 DeepSeek key，独立 baseUrl，默认候选 `https://api.deepseek.com/anthropic/v1`；model 候选与本地 Deepy 一致为 deepseek-flash，实施时以官方当前实现及最小真实验证确定，写入验证记录。自定义 endpoint 沿用现有 URL/凭证保护规则；不从主 Responses URL 推导。设置展示启用和模型，地址放高级设置，不展示 key。

初始界限建议 60 秒、max_tokens 4096、max_uses 3、响应上限 2MiB、返回最多 10 个来源；摘要有界，完整响应另存。首版一次网络尝试，不对可能已触发搜索的失败自动重试，减少不确定计费；通用记录层仍保留逐 attempt 能力。

按 server_tool_use.id / tool_use_id 配对结果，过滤 HTTP(S) URL、去重并区分 empty/partial/failed；未完成或错误 block 不能仅凭 HTTP 200 判定成功。保留未知字段和 usage 原始证据，缺失 usage 显示未知。主工具返回可读来源，UI 使用结构化来源卡，不将自由生成的模型正文冒充检索结果。

替代方案：直接给主 Responses 请求塞服务端搜索工具缺少本项目协议验证；照搬 Deepy 直接 HTTP 会漏掉调用记录。选择独立协议适配与共享记录层。

## Risks / Trade-offs

- 搜索 endpoint/model 支持未在本轮真实验证 -> 实施先运行最小协议样例；mock 验证属于独立证据，真实验证无凭证时保留未完成验收。
- 抽取记录层可能改变主 Responses 字节或历史 -> 先用 transport 捕获测试锁定主调用和命名行为，再接搜索。
- 历史 prepared 不等于 committed -> 以成功终态建立变更列表，未知结果只展示准备证据。
- 大目录及 diff 阻塞服务/UI -> 按需加载、响应上限、hunk 分页和可取消请求，缓存仅为可重建投影。
- 默认程序存在平台差异及路径检查竞争窗口 -> 打开前复核规范路径，固定程序与参数调用，分别测试三平台；不宣称防御同机恶意进程持续替换文件的完整隔离。
- 视觉统一容易遗漏异常与旧会话 -> 同一验收集覆盖空态、长回答、搜索、失败、取消、旧数据、诊断和导出。

## Migration Plan

1. 增量扩展配置和可选展示协议；旧配置按默认值读取，旧 Journal 不重写。
2. 先提取调用记录并回归，再接搜索；diff 和文件 API 可独立验证，最后整合 UI。
3. 同步 README/使用说明及验证记录；完成类型、单元、浏览器、打包验收与 OpenSpec 严格验证后才勾选对应任务。
4. 回退 UI 不删除 artifacts；搜索可禁用。回退到旧版本前保留配置备份，新事件不得导致旧会话证据被覆盖。发布与归档另按用户指令执行。

## Review 修复补充

文件树条目使用逻辑相对路径作为节点标识，realpath 仅用于范围和类型校验。列目录时收集逻辑祖先的规范路径，指向任一祖先的目录链接标记为不可展开；直接请求穿过循环的目录返回拒绝。

changes 查询增加可选 before/after Journal 序号和 nextBefore 游标，保留旧 offset/next 字段兼容调用方。变更页以会话 ID 隔离组件；首次加载一页，刷新只查询已见最大序号之后的记录并跨页补齐，历史请求使用 before 稳定游标。按事件 ID 合并而不清空列表，保留 diff 子组件；切换会话取消新旧记录请求。
