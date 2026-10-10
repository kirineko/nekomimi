# 三阶段幂等交接与恢复（任务 3.5）

确认要求固定 commandId、`confirmed:true` 和预览 hash。源 Journal 在 writer 内核对原 cursor 后可靠写入 `handoff.intent` 及选定快照；目标创建沿用创建命令注册日志并核对完整绑定，可靠写入一份 `handoff.received` 和独立快照，源再写 `handoff.committed`。三侧事实共享 handoffId，收据包含意图、接收、确认事件 ID。没有跨文件原子提交假设。

重复命令同内容返回原收据，对象键顺序不改变请求身份；不同内容／hash 拒绝。已经完成的收据可在源 Durable 运行持有 writer 时只读返回。HTTP 状态读取不创建会话，不恢复业务；显式 `handoff-recover` 只使用已接受意图，不接受新 draft，不构造调度器、加载目标工厂、命名或提交任务。目标首次任务的上下文消费由 4.7 实施，本任务仅保存不可变接收事实。

意图已可靠接受后源变化不偷换正文，恢复采用原快照。未可靠提交的尾部不构成交接；Journal 修复新增证据改变 cursor 时，旧预览拒绝，用户需重新预览确认。目标逻辑删除、已创建记录物理丢失、绑定冲突、原目录／宿主失效或接收快照损坏明确阻止，不复活目标。历史已确认事实与当前不可用诊断分别展示。

验证为 macOS arm64、Node24.15.0、未提交工作树、真实本机 HTTP／子进程，模型 transport 为假实现，没有真实模型调用。没有宣称 Linux、最低 Node 或整体交付门槛已通过。

- `snapshot-integrity-tests.log`：最终 33 项 HTTP／协议测试通过。包含四阶段中断、四阶段目标创建中断、四阶段 HTTP 客户端断开／确认丢失模拟、并发和重排重提、内容冲突、创建命令冲突、目标删除、目标工厂 marker、源版本变化、活动 Durable writer 下收据重取、接收附件损坏。
- 12 项 I/O 故障分别覆盖 intent／received／committed 的 append、fsync、水位写入和替换。恢复后的权威 Journal 只有一份意图／接收／确认；初始意图未可靠提交时不虚假报告已经接受。
- `final-admission-crash-tests.log`：最终编译服务在交接四阶段和目标创建四阶段逐项真实 SIGKILL，共 8 项通过。确认进程已被杀后等待租约过期，用同一编译宿主重启；检查唯一目标、事件计数、handoffId、重复收据和零 run／model／tool／naming 派发。
- `final-regression.log`：相关 4 文件 70 项通过，含当时 32 项协议场景与摘要、创建身份、HTTP 关键回归；随后增加接收快照损坏场景为最终 33 项，各组有重叠。
- `final-admission-types.log`、`final-admission-build.log`、`final-spec-validation.log`：最终类型、构建与全量严格规格通过。
- `diff-check.log`：工作树 whitespace 检查通过。

首次 14 项和随后 19 项协议检查、各轮编译及崩溃日志均保留。`regression.log` 首次三项 I/O 断言错误期待修复改变 cursor 后旧预览仍被接受；保留生产版本门禁，测试改为证明拒绝并重新预览确认。其余场景当时通过，没有降低可靠提交和版本校验。

尚未完成的创造交付卡、来源删除诊断、实际请求上下文选择与正式 UI 继续留在 change。没有归档、提交、推送或发布。
