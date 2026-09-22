# custom-model-providers Specification

## Purpose

让用户通过受支持的开发契约添加和选择模型供应商，使模型差异、凭证、请求协议和历史继续条件清晰可查，并使主对话和扩展调用共享一致的记录机制。

## Requirements

### Requirement: 注册与可用模型

系统 SHALL 支持 Provider 注册和版本化模型目录，声明协议、输入类型、工具、推理、上下文及输出限制；重复身份或无法满足协议契约的注册 SHALL 拒绝。默认 DeepSeek 行为保持兼容。

#### Scenario: 添加自定义 Provider
- **WHEN** 用户通过对话创建并启用一个自定义 HTTP JSON/SSE Provider
- **THEN** 模型出现在可选目录，可用于主对话和辅助调用，失败注册不覆盖默认 Provider。

### Requirement: 选择与能力验证

系统 SHALL 支持主对话、扩展辅助调用和自动命名的显式模型选择及可解释默认值，在实际发送前验证能力；内置搜索使用自身已验证协议且不得因主模型切换而隐式改写。

#### Scenario: 模型不支持图片或工具
- **WHEN** 当前上下文含图片或工具定义而所选模型不支持
- **THEN** 发送前明确拒绝或要求用户选择受支持的显式转换，不静默丢弃输入。

### Requirement: 凭证与记录入口

系统 SHALL 按 Provider 管理服务端凭证引用，使主调用、辅助调用、重试和取消使用统一受记录传输；已声明鉴权凭证不得发往未授权端点，不进入模型可读配置、UI、日志或导出。

#### Scenario: 配置自定义端点
- **WHEN** Provider 请求将已配置凭证发送到新的端点或通过重定向转发
- **THEN** 未授权目标被拒绝且不发送凭证；错误报告中不含密钥。

### Requirement: 历史协议兼容

系统 SHALL 固定每次运行的 Provider 版本、模型与投影规则；跨 Provider 继续须经过显式兼容检查或创建可追溯分支，不能伪造 reasoning 或工具配对。

#### Scenario: 不兼容会话切换
- **WHEN** 用户在包含供应商专有 reasoning 的会话切换到另一协议
- **THEN** 系统说明不兼容原因，提供保留原历史的显式分支或经验证转换；不静默把 UI 文本冒充原协议历史。

### Requirement: 随包协议示例

系统 SHALL 提供 Responses 与 Chat Completions 的可执行 adapter 示例和离线契约 fixture，覆盖流式响应、工具、多模态能力声明、错误及重试；不得宣称任意兼容端点均已经实测。

#### Scenario: 无账户测试 Provider
- **WHEN** 用户在干净安装后使用本地协议 fixture 校验新 Provider
- **THEN** 能完成模型目录、请求、工具回合与逐 attempt 证据检查，不依赖生产账户。
