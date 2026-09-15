## Context
见 proposal.md。故障注入已复现持久化失败后的缺失终止与恢复记录，但无法从旧导出确定 Windows errno。

## Goals / Non-Goals
目标是下一次中断可定位 IO 阶段及后台异常；不实施猜测性的 Windows 重试，不以诊断替代 Journal。

## Decisions
- 独立 diagnostics 模块为每次故障写唯一 JSON 文件，避免复用 durable.json 原子替换；同时输出脱敏 JSON 到 stderr。诊断写失败不递归诊断、不掩盖原始错误。
- IO 阶段错误携带 operation、code、syscall 与受控文件角色，不采集文件内容、请求体、环境变量或密钥。附 session/run/attempt 标识、seq/durableSeq、Node 与平台。
- Web 附加非权威诊断字段及下载接口，重启可重新读取；诊断更新不要求 Journal 游标前进。旧会话无诊断时兼容。
- 诊断下载不读取 durable.json；单独验证首条身份记录哈希和工作区归属，首条也损坏时拒绝访问。Entry 在异步诊断加载前注册，所有调用共享初始化队列。
- 保留 fail-closed 及未知工具结果；正常取消不误标为存储故障。现场再次复现后才规划根因修复。

## Risks / Trade-offs
- 磁盘完全不可写 → stderr 回退；两条通道都失败不能保证收集。
- 强制杀进程无法异步落盘 → 不能保证生成诊断，不据此断言根因。
- 诊断是本机辅助文件而非会话事实 → 不进入回放和模型上下文，下载明确标识。
