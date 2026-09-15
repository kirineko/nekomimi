# runtime-diagnostics Specification

## Purpose
在本地任务中断且权威日志无法写入时，提供独立的脱敏诊断证据，帮助区分存储故障与其他后台异常，并让用户能够读取和提供诊断而不改变任务历史或自动重复副作用。

## Requirements
### Requirement: Independent failure diagnostics
系统 SHALL 为日志 IO 故障记录阶段、错误码、关联标识及持久化位置，独立保存并输出至 stderr；不得记录密钥或请求正文。
#### Scenario: Watermark failure
- **WHEN** 更新持久化确认失败
- **THEN** 诊断指出具体失败阶段，运行停止，未知工具不得自动重跑
#### Scenario: Diagnostic storage failure
- **WHEN** 辅助诊断也无法写入
- **THEN** stderr 提供诊断及辅助写入失败提示，原始故障不被覆盖

### Requirement: Visible non-authoritative diagnostics
系统 SHALL 在 Web 展示并允许下载会话诊断，且不改变 Journal 游标、任务结果或模型上下文。
#### Scenario: Accepted task fails
- **WHEN** 已接受任务后台异常且无法写入结束记录
- **THEN** Web 能收到诊断，重启后仍可读取成功保存的诊断
#### Scenario: Cancellation and legacy sessions
- **WHEN** 正常取消任务或读取无诊断的旧会话
- **THEN** 不伪造存储故障，已有行为保持兼容
