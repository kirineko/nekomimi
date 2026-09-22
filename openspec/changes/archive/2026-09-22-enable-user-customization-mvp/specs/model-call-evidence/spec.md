## MODIFIED Requirements

### Requirement: 最终请求保真
系统 SHALL 通过 DeepSeek Responses 路径发送主代理请求，通过独立 DeepSeek Messages 路径发送内置搜索请求；所有宿主管理的模型调用（包括扩展通过 SDK 发起的辅助调用）SHALL 使用统一可记录入口，保存与实际发送 body 一致的序列化证据、hash 和输入来源引用，排除认证凭证，标明用途和协议。扩展辅助调用 SHALL 关联资源版本、所属运行及存在时的外层工具调用，使用独立上下文，不直接混入主代理协议历史。可信扩展绕过宿主直接发出的网络请求 MUST NOT 被宣称已受此入口记录。

#### Scenario: 最终请求保真验收
- **WHEN** 最后一次请求转换改变了工具 schema
- **THEN** 保存的 body 与 transport 捕获字节一致，能追溯所用上下文，日志中无 API key。

#### Scenario: 工具内模型调用
- **WHEN** web_search 内部发送 Messages 请求
- **THEN** 请求及每次 attempt 关联外层工具调用，可检查 query 来源、响应和 usage；搜索内部消息不被混入主代理 Responses 历史。

#### Scenario: 扩展辅助调用重试和取消
- **WHEN** 自定义审查命令通过 SDK 请求模型，遇到限流后重试并被用户取消
- **THEN** 各 attempt 可追溯到命令与扩展版本，取消后不继续调度，不泄露密钥，主对话历史不混入辅助协议消息。
