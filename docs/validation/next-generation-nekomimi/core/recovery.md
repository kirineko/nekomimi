# 核心切换恢复与兼容回退（任务 8.6）

任务完成，整体进度 70/89。环境为 macOS arm64、Node.js 24.15.0，基线提交 `be50c5a8a1557ef160056b964cd29e65b395685d`，实际验证的是未提交工作树；文件摘要见 `recovery-manifest.json`。

## 实现

- `storage-compatibility.ts` 以所选版本自己的读者只读检查数据格式、配置版本、工作区身份、会话/工作流/工作区状态 Journal 链与附件。未来格式、破损/未完成写入、身份不匹配及越界链接拒绝；不加载扩展工厂、不修复或迁移业务数据。业务状态仍受各扩展的 schema 门禁约束，本检查不代替扩展显式迁移。
- `managed.ts` 在目标健康失败后，只有进程清理可确认且父进程仍有效时，复核旧产物并执行旧版本自身的存储准入，恢复原端口服务。切换收据 failed 与实际恢复身份分开；回退失败保持 recovery-required，不能伪称旧版本仍在运行。故障记录无法持久化时终止所属进程并报告 unknown。
- `CoreRecovery` 区分历史选择和实际运行。历史组仍存在、观察失败或派发意图缺少 PID 时保守阻止恢复；不向旧 PID 发信号，也不把不存在的已记录组当作没有未知进程的全局证明。新普通托管启动同样检查既有安装进程状态。
- `recover-plan/recover` 显式选择 last/previous，校验保留产物与数据，确认计划后持有构建/验证 writer 和安装租约，再复核并启动。新进程先关闭业务入口，通过自身只读准入和健康检查后开放。重复恢复不丢失不同旧构建的引用；已接受的同一命令仅返回原 started/failed/unknown 收据，不重复启动。历史 started 的 running 为 not-observed，实时身份仍由实际服务确认。
- 恢复不依赖原始源码或重做构建，不重跑没有确定结果的业务工具。等待工作流、未知清理、不可读历史等未通过门禁时保留只读恢复，不能强制清除阻碍。

## 验证证据

| 日志 | 结果与范围 |
| --- | --- |
| `recovery-all-core.log` | 全部 Core 14 文件 68 项通过；包含构建、验证、租约、门禁、切换和恢复回归 |
| `recovery-cli.log` | 新增编译后 CLI 后，回退/恢复专项 5 项通过；真实 recover-plan、前台 recover、重复收据、退出端口关闭 |
| `recovery-previous.log` | receipt-written 故障边界单独复核，通过最后构建恢复后再显式恢复不同 previous 构建；另外 4 项为本次筛选跳过，已在全 Core 日志通过 |
| `recovery-final-types.log` / `recovery-final-build.log` | 类型检查与构建通过 |
| `recovery-final-specs.log` | 严格规格检查 43 项通过 |

`test/core-switch-crash.test.ts` 在 intent-written、old-stopped、candidate-ready、selection-written、receipt-written 五个边界实际 SIGKILL supervisor；子进程因 IPC 断开关闭，等待真实 10 秒安装租约失效，再恢复。选择落盘前恢复旧构建，选择落盘后恢复新构建；终态收据落盘前保持 unknown，落盘后保留 applied。恢复和重复确认均不新增业务执行，未知工具 Journal 字节保持一致。

`test/core-rollback.test.ts` 注入实际候选启动失败，验证旧服务恢复；候选把数据格式标记改为 999 时，旧版本拒绝启动且标记保持不变；模拟 Journal 写入失败时确认未知状态和服务停止。`test/core-storage-compatibility.test.ts` 验证只读准入的完整性和无写入。`test/core-recovery.test.ts` 覆盖元数据确认、记录进程组存在、缺少 PID、无终态恢复收据及重复选择。

## 证据边界

故障用例的候选准入记录是显式测试夹具，复制本次真实 dist 并复核实际摘要，依赖从本仓库解析；它们不冒充再次执行 npm 构建和独立候选验证。supervisor、Web 子进程、Journal、SIGKILL、租约到期、健康检查和恢复服务均是真实路径。完整源码双构建成功切换见 `switch-control.md`。

没有调用真实模型，没有更改用户活动安装、PATH 或全局 npm，没有提交、归档或发布。Linux、最低 Node 和安装包整体验收仍归批次 11，不能用这里的结果宣称通过。
