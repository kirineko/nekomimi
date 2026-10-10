# 摘要来源、创造状态与提交门禁（任务 4.6）

2026-10-07，macOS arm64 / Node 24.15.0，固定 Durable 1.0.4。状态与 HTTP 均使用本地夹具；未调用真实模型，也不把测试中显式记录的 preview 阶段称为实际 UI 预览验收。任务完成以最终验证与勾选为准。

源身份固定 sessionId、mode、完整 target、model／protocol、contextRevision 和 capabilityRevision。模型配置、凭证、来源授权及指令／工具在生成后与最终提交前只读再查；当前创造状态变化同样使旧摘要失效。Journal 队列支持只读异步条件，最终同步 guard 再核对取消和来源；取消微任务不能跨过最后检查。授权拒绝返回不提交并落盘 compaction.failed，不损坏可用 Journal。取消保存 compaction.cancelled，原节点和历史附件不变。

创造保留数据来自候选目录、当前／活动版本各验证阶段的最新生命周期事件与 pending 应用收据，附有目标宿主、阶段、缺失授权、事件 id 和 hash。Journal 的 UNKNOWN、待回答交互和确认交接约束独立保留。模型摘要正文和宿主提交时状态分开，后续可靠事实优先；保留数据不授予权限，不将 preview／simulation 当成已应用。状态不静默截断，超过 64 KiB 或当前模型预算时拒绝提交。原生命周期历史完整保留。

安全分组拒绝孤立输出和重叠调用身份，并在并行调用未闭合时保留跨 user 边界的整个组。标准化 Responses／Chat Completions 协议之外仍明确拒绝压缩。同一 Journal 的递归或并发整理拒绝；生产 Durable 配置关闭内置压缩，摘要 Provider 无工具且没有递归 beforeRequest。

验证与失败记录：

- `types-first.log`、`build-first.log`：初始源码类型与构建通过。
- `tests-first.log`：6 文件 63/64。队列内授权条件抛出被写入队列当成存储故障，失败事件无法保存；改为返回不提交，原失败断言未放宽。
- `tests-fixed.log`：7 文件 71/74，三个新创造夹具的 session.created 使用未规范化路径，在恢复准入处拒绝。改用绑定中的真实根路径。
- `types-integration.log`、`build-integration.log`：handoffId 并非 HandoffPreview 字段，类型检查失败；改从已确认 Journal 事件取 ID。保留失败日志，后续重新构建。
- `integration-tests.log`：2 文件 18/21。恢复准入已通过，断言读取原始临时目录别名触发附件路径保护；改用实际 RunResult.session，路径边界未放宽。
- `integration-complete.log`：2 文件 23/24。撤权在受信任解析器调用前生效，响应证据保留但 attempt 为 failed；测试分别断言模型资料／生命周期变化后的 completed attempt，以及撤权场景的 failed attempt 与原始响应，不把已收到网络响应当成已解析成功。
- `tests-final.log`：11 文件 119 项通过，包括真实创造摘要成功后续轮、模型资料／授权／生命周期变化、目标丢失、队列拒绝及微任务取消、孤立输出、并行未闭合组、递归拒绝、原 Journal 与工作会话不变。
- 只读审查发现生命周期查询中的主题默认值读取会创建目录，已改为缺失时返回默认值；显式 theme select 仍创建并写入授权位置。新增空项目／空 home 状态查询前后目录不变的测试。`types-readonly.log`、`build-readonly.log` 通过，最终相关回归保存在 `tests-complete.log`。

`tests-complete.log`：最终固定源码 13 文件 130 项全部通过，退出码 0，113.75 秒，2 workers；包含新增 13 项来源／状态／零目录创建测试，以及 4 项受记录真实 Provider 路径创造场景，原 9 项 runtime 压缩场景继续通过。`types-readonly.log`、`build-readonly.log`、`specs-final.log` 和 `diff-final.log` 分别记录最终类型、构建、43 项严格规格与差异检查。日志中的存储错误来自明确的故障注入，非遗留失败。

任务 4.6 已按实际验证勾选，进度 41/89；manifest 记录确切源码、编译构建、日志摘要和当前未提交状态。工作台详情、确认交接正文选择、完整新能力综合验收分别由 10.5、4.7 和第 11 组承担。本记录不宣称全部 apply、浏览器新界面或跨平台已通过。
