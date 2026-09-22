## Purpose

让用户通过本地或远程 MCP 服务扩展可调用工具，在不丢失协议结果和执行关联的前提下处理发现、更新、取消与连接故障，并避免重连造成未知副作用重复执行。

## ADDED Requirements

### Requirement: 连接与发现
系统 SHALL 支持 stdio 和 Streamable HTTP 的初始化、版本协商及分页工具发现，记录 server identity 并隔离工具名称；不支持的协议、schema 或认证方式 SHALL 明确诊断而不错误标记已连接可用。

#### Scenario: 多服务器同名工具
- **WHEN** 两个服务都提供 search 且列表跨页
- **THEN** 所有页面被发现，工具以稳定服务器身份区分，调用路由准确；单个不支持 schema 的工具被标明不可用。

### Requirement: 工具列表版本
系统 SHALL 处理工具列表变化并构建后续资源版本，保持当前运行 schema 快照不变；已移除工具的失败 SHALL 明确呈现，不将调用转发给另一同名工具。

#### Scenario: 活动运行中列表变化
- **WHEN** 服务通知工具被移除或 schema 改变
- **THEN** 当前运行仍能追溯原定义，后续运行采用新列表；旧调用失败保留服务器错误且不隐式重路由。

### Requirement: 结果保真和凭证边界
系统 SHALL 保留 MCP content、structuredContent、isError 和资源引用的原始结构及调用关联，分别生成有界模型投影与 UI 展示；凭证仅在服务端解析，不进入日志、客户端或导出。资源引用 MUST NOT 自动触发资源下载，工具注解 MUST NOT 作为授权依据。

#### Scenario: 结构化结果和错误
- **WHEN** MCP 返回结构化结果、图片、资源链接或 isError
- **THEN** 原始字段和错误含义可检查，模型不支持的内容明确降级而非静默丢失；链接不被自动访问，认证信息在证据中不可见。

### Requirement: 取消断线与进程清理
系统 SHALL 区分取消请求与远端执行终态，在取消、超时和连接丢失后停止后续调度；缺少最终结果的副作用调用 SHALL 标记 unknown，重连 MUST NOT 自动重发 tools/call。stdio 协议输出与 stderr 诊断 SHALL 分离并有界清理子进程。

#### Scenario: 远端已执行但响应丢失
- **WHEN** HTTP 工具执行后连接断开，用户取消并重新连接
- **THEN** 系统记录取消请求及 unknown，不声称远端已回滚，不重发原调用；重新发现工具仍可进行。

#### Scenario: 本地进程无法正常退出
- **WHEN** stdio 服务取消后忽略正常终止请求
- **THEN** 系统执行平台支持的强制清理并记录真实结果，未结束前不显示已完全停止。
