## Why
Windows 导出日志有 4/13 轮缺少结束记录及 6 次未持久化尾部恢复，但没有底层错误码。需要先补足诊断证据，再决定具体修复。

## What Changes
- 增加独立、脱敏的运行诊断，记录落盘步骤、错误码、运行标识和持久化位置；终端回退报告。
- Web 展示后台故障诊断，避免任务接受后异常静默丢失。
- 增加故障注入验证；不增加存储重试、不重跑工具、不改变 Journal 权威性。

## Capabilities
### New Capabilities
- `runtime-diagnostics`: 运行故障的独立诊断与展示。
### Modified Capabilities
无。

## Impact
对应 spec.md 可观测性与持久化要求；涉及 journal、runtime、server 和 Web。诊断不进入模型上下文，不记录请求体或密钥。原始 Windows 系统错误仍需新版本现场采集。
