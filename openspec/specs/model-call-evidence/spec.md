# model-call-evidence Specification

## Purpose

使用户能够逐次检查模型的实际请求、响应和重试过程，并确保应用的模型消息投影不会丢失原始协议证据，从而为故障诊断和会话继续提供可靠输入。

## Requirements

### Requirement: 最终请求保真

系统 SHALL 通过 DeepSeek Responses 路径发送请求，并保存与实际发送 body 一致的序列化证据、hash 和上下文引用，排除认证凭证。

#### Scenario: 最终请求保真验收

- **WHEN** 最后一次请求转换改变了工具 schema
- **THEN** 保存的 body 与 transport 捕获字节一致，能追溯所用上下文，日志中无 API key。

### Requirement: 流和终态证据

系统 SHALL 保存原始响应流，包括未知事件、usage、错误及成功或失败终态；不得将断流视为成功。

#### Scenario: 流和终态证据验收

- **WHEN** 收到 reasoning、未知事件之后网络断开
- **THEN** 原始事件可检查，attempt 标记失败或中断，没有伪造完成响应。

### Requirement: 逐次重试与取消

系统 SHALL 为每次网络尝试分配独立 attemptId，记录重试原因，并在取消后停止后续重试和工具调度。

#### Scenario: 逐次重试与取消验收

- **WHEN** 限流导致一次重试，第二次尝试期间用户取消
- **THEN** 两个 attempt 均有记录，取消结束后无第三次请求或新增工具执行。

### Requirement: 协议历史继续

系统 SHALL 保存并在后续请求中按已验证的 provider 语义投影原始 response items，保持工具调用与结果配对。

#### Scenario: 协议历史继续验收

- **WHEN** 会话包含 reasoning 和多个工具调用后继续请求
- **THEN** 请求保留必要历史与正确 call ID 配对，不从显示文本猜测协议字段。

### Requirement: Provider 指令和能力语义

系统 SHALL 将系统级指导按 DeepSeek 支持的 instructions/system 语义发送，避免重复注入；thinking 路径默认采用 auto 工具选择，不发送已知不兼容的指定函数组合。

#### Scenario: Thinking 请求使用项目指令和工具

- **WHEN** 启用 thinking 且本轮包含系统指导与工具定义
- **THEN** 最终请求不以 developer 承载系统指导，不重复系统内容，工具选择使用经过验证的组合。

### Requirement: 缺失历史与图片输入

系统 SHALL 保留继续调用所需的原始 reasoning 和工具配对记录，并支持已验证的用户图片及工具图片输入；不伪造缺失历史来绕过 provider 校验。

#### Scenario: 工具返回图片后继续调用

- **WHEN** 一个真实调用生成工具请求且工具返回受支持图片
- **THEN** 后续请求包含对应原始 response items 和配对的图片结果，不能只从显示文本重建 reasoning。

### Requirement: 响应流有界且缺口明确

系统 SHALL 为响应字节和事件数量设置可配置上限，慢存储对读取施加背压；超限时中止调用并明确记录原因与证据范围，不静默跳过数据后宣告完整成功。

#### Scenario: 原始流超过配置上限

- **WHEN** 一个响应超过字节或事件数量上限
- **THEN** 系统中止该 attempt，保留已记录证据及超限标记，不执行该响应中的待定工具调用。
