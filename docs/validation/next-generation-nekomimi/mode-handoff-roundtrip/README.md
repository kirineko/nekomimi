# 模式与交接综合 headless／HTTP 门槛（任务 3.8）

2026-10-07，macOS arm64 / Node 24.15.0，未提交 apply，无发版。

两条路径均从工作需求开始，通过并发重复确认建立唯一创造会话；用户显式开发任务实际调用 customization_candidate.create／inspect，经同一模型、工具意图及结果入口记录三轮请求和两次工具执行。交付只读选择准确候选及 static 证据，确认后独立工作快照落盘；重启重复确认返回原收据，带已接收 handoffId 的显式工作任务继续分析。交付保持 awaiting-delivery，不授权／激活／执行 /review。全过程各 5 个假 Provider 请求、一个候选、两条创造工具意图及结果，重复命令和重复确认均不增加计数。

headless 显式 command 重提先核对已有可靠历史与内容 hash，只读返回原 runId／结果；未完成命令返回 interrupted 观察结果，不创建新运行，不执行恢复调度。并发准入仍在 writer 内核对；HTTP 不为此只读返回再次启动命名。

证据：

- `final-receipt-tests.log`：2 文件 4 项通过，HTTP／headless 各一条完整闭环；实际工厂仅加载一次，持有 writer 租约时仍可读取完成收据；未知旧工具保持未知，Journal 原字节不变；不同命令内容拒绝。
- `final-regression.log`：12 文件 155 项通过（2 workers），覆盖独立运行／命名、模式身份、HTTP、交接、上下文、正式 runtime 及真实崩溃恢复、四类 I/O 故障。该计数包含上述 4 项，不相加。
- `final-crash-tests.log`：最终 compiled dist 的 8 项真实 SIGKILL 通过，包含四个交接及四个创建边界；只补元数据，零模型／工具／命名。
- `final-types.log`、`final-build.log`、`spec-validation.log`：类型、构建、43 项严格规格通过。
- 首次两条综合夹具误读 Candidates.list 的 string[] 类型，保留 `first-tests.log`；修正后 HTTP 通过，headless 同 ID 被旧实现拒绝（`second-tests.log`）。加入正式只读收据返回后两条均通过。首次实际工厂夹具未声明 SDK 类型，静态门禁拒绝，保留 `receipt-tests.log`，修正类型后通过。

主占用与交接正文选择尚由第 4 组独立实施；本门槛检验确认协议、版本事实、请求关联和幂等执行，不宣称交付已应用或真实模型质量、Linux、最低 Node 新功能全覆盖。
