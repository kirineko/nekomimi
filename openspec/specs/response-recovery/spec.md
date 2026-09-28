# response-recovery Specification

## Purpose

为模型输出耗尽和任务轮数上限提供明确预算、准确证据与可读的恢复指引，尊重显式限制和取消，不自动执行未完成响应中的工具，并避免主视图重复展示失败信息。

## Requirements

### Requirement: 有界预算恢复
内置 Responses 默认预算 SHALL 为 131072（128K），默认任务轮数 SHALL 为 64。显式参数 SHALL 优先，输出耗尽 MUST NOT 自动扩大预算或重试。MUST 保留 request/response/usage/reason，且只有 completed 的工具调用可执行。
#### Scenario: 输出预算耗尽
- **WHEN** 服务端以 max_output_tokens 返回未完成
- **THEN** 记录实际原因和请求预算，提示分步骤继续，不执行其中工具或静默重试。
#### Scenario: 显式限制与取消
- **WHEN** 用户显式预算/轮数、内容过滤、网络截断或取消
- **THEN** 尊重限制与取消，保留实际结果，不扩大预算或执行不完整工具。

### Requirement: 单一可读结果
主视图 SHALL 只显示一次任务最终失败原因，区分输出耗尽、轮数上限及其他失败；可继续任务入口 SHALL 只写入草稿且尊重冲突，不自动执行。
#### Scenario: 历史英文失败
- **WHEN** 历史记录包含 Response incomplete 和重复调用/任务错误
- **THEN** 显示一次可读提示，原始证据仍可检查；不凭英文推断具体原因。
