## MODIFIED Requirements

### Requirement: 最终请求保真
系统 SHALL 通过选定且已验证的 Provider adapter 发送主代理请求，默认保留 DeepSeek Responses 路径；内置搜索继续通过独立 DeepSeek Messages 路径发送请求；所有宿主管理的模型调用（包括扩展通过 SDK 发起的辅助调用）SHALL 使用统一可记录入口，保存与实际发送 body 一致的序列化证据、hash 和输入来源引用，排除认证凭证，标明用途、协议、Provider/模型及 adapter revision。扩展辅助调用 SHALL 关联资源版本、所属运行及存在时的外层工具调用，使用独立上下文，不直接混入主代理协议历史。可信扩展绕过宿主直接发出的网络请求 MUST NOT 被宣称已受此入口记录。

统一入口 SHALL 同时覆盖工作对话、创造对话、交接摘要、分类、图片及显式路由辅助调用，记录操作类型、模式、目标、选定策略与实际物理模型。不同协议使用各自可验证序列化证据；非流式响应也须保留原始响应证据。辅助调用只返回明确结果给父调用，不把内部协议历史混入父会话。

Durable 的 generation 调用 SHALL 通过同一受记录 Provider 服务，关联框架任务与产品调用身份；框架提交观察不替代网络证据，取消或结果提交失败后不得自动重试已发出的未知调用。

#### Scenario: 最终请求保真验收
- **WHEN** 最后一次请求转换改变了工具 schema
- **THEN** 保存的 body 与 transport 捕获字节一致，能追溯所用上下文，日志中无 API key。

#### Scenario: 工具内模型调用
- **WHEN** web_search 内部发送 Messages 请求
- **THEN** 请求及每次 attempt 关联外层工具调用，可检查 query 来源、响应和 usage；搜索内部消息不被混入主代理 Responses 历史。

#### Scenario: 扩展辅助调用重试和取消
- **WHEN** 自定义审查命令通过 SDK 请求模型，遇到限流后重试并被用户取消
- **THEN** 各 attempt 可追溯到命令与扩展版本，取消后不继续调度，不泄露密钥，主对话历史不混入辅助协议消息。

#### Scenario: 自定义 Provider 请求
- **WHEN** 自定义 adapter 序列化请求并发起重试
- **THEN** 每次实际发送的请求字节与证据一致，保留 adapter、模型、上下文及外层工作流/调用关联；重试不绕过宿主凭证和取消策略。

#### Scenario: 脚本分类调用
- **WHEN** 脚本通过宿主调用分类器后又发起图片生成
- **THEN** 两次调用各有逻辑身份和 attempts，均关联脚本与当前模式；原始输入输出可查，不作为未记录的沙箱全局网络请求。

### Requirement: 逐次重试与取消

系统 SHALL 为每次网络尝试分配独立 attemptId，记录重试原因，并在取消后停止后续重试和工具调度。

Provider SDK 内部重试 SHALL 纳入独立 attempt 记录或关闭；已解析 provider 事件不等同原始流。未知用量 SHALL 标记未知，跨父工具与子模型聚合不得重复计费。

#### Scenario: 逐次重试与取消验收

- **WHEN** 限流导致一次重试，第二次尝试期间用户取消
- **THEN** 两个 attempt 均有记录，取消结束后无第三次请求或新增工具执行。

#### Scenario: 辅助调用迟到
- **WHEN** 图片调用取消后收到结果而父脚本已经结束
- **THEN** 保留已捕获证据，不启动新工具或自动应用图片，不把迟到结果改写成正常完成。

#### Scenario: Durable 结果提交失败
- **WHEN** 模型已返回但Durable结果提交失败
- **THEN** 已持久网络证据仍可查，任务不显示可靠完成；重开不自动再次发送该模型请求。
