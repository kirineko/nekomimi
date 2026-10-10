# 确认交接上下文（任务 4.7）

2026-10-07，macOS arm64 / Node 24.15.0，Durable 1.0.4。使用合成 Provider，无真实模型调用。

确认收据不启动任务。创造任务选入确认输入，工作任务显式选择交付后保留为历史。来源索引包含原 payload hash、脱敏数据 hash、范围、选择理由与完整快照附件；源会话删除后副本不变，下一实际请求记录原证据不可用。工作模式排除 SDK 指南正文。正文和 UNKNOWN 均是 user 引用数据，不能变成工具调用或权限。已保存投影校验收据、角色和 hash，并与完整确认快照重建结果核对。

专项 5 项测试验证实际 body 与持久附件一致、图片保留、显式交付选择、SDK 排除、源删除、UTF-8 边界、重复请求不重复插入，以及伪造权限后的不可用工具拒绝。恢复投影的 system/developer 角色变造被拒绝。完整相关回归 `regression-final.log`：8 文件 124 项通过；`types-final.log`、`build-final.log` 和 `specs-final.log` 分别通过类型、构建和 43 项严格规格检查。

保留失败记录：`tests-first.log` 的 5 项失败及 `types-tests.log` 来自夹具错误调用 handoffConfirm，改为正式 confirmHandoff。`tests-fixture-fixed.log` 为 4/5，假模型无限返回同一不可用调用导致超时；改为收到拒绝后结束，验证未执行且未授权。`tests-bounded-model.log` 为 4/5，断言预期字符串，实际 Durable 返回结构化 input_text；改为精确核对真实拒绝文本，`tests-final.log` 5/5。后续角色/hash 校验纳入最终 124 项回归。

只读来源观察当前检查同一会话目录的原会话，任意 headless 异地来源不可读取时统一报告证据不可用，不猜测已删除。完整交接快照仍保留。新工作台交接卡由 10.3 接入；此记录不代表整套 apply 或真实模型质量验收完成。
