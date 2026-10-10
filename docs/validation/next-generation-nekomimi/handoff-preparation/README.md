# 交接预览与显式摘要准备（任务 3.4）

`previewHandoff` 和 HTTP `handoff-preview` 只观察身份与选定 Journal 引用。预览包含来源 cursor、目标宿主／模式／范围、内容 hash 和 `createsTask:false`、`grantsPermissions:false`。新目标仅计算绑定，不创建会话；跨项目、错误引用 hash、复用源身份或非跨模式目标拒绝。文本和选择总量有上限，已知凭证脱敏。

用户显式调用 `handoff-summary` 时，独立操作 Journal 固定输入与命令 ID，经共享受记录 Provider 发送 handoff 用途和无工具 profile。原会话、全部开发历史、主上下文 usage 不被复制或更改。首个收据与重试收据一致；已开始但未完成的命令不重跑模型。成功输出仍标记需要确认，系统不创建目标会话、运行工具或自动交接。

准备任务独立取消并传递到实际 transport；源 revision 变化、无效输出或工具调用使准备失败。配置密钥出现在模型回复时，既有记录入口会停止调用并保留脱敏证据，摘要失败；没有为了通过测试放行密钥输出。

本次为 macOS arm64、当前未提交工作树、假模型 transport、真实本机 HTTP。没有真实外部模型调用。

- `final-regression.log`：5 文件 77 项通过，含 8 项交接测试与服务、会话、提示、受记录模型回归。
- `complete-types.log`、`complete-build.log`：最新类型检查及构建通过。
- `complete-spec-validation.log`：全量严格规格校验通过。
- 预览测试对照源 Journal 与创建注册日志字节、模型计数和可信工厂 marker，均不变化；目标目录与会话列表不增加目标任务。
- 摘要测试对照实际 body 的无工具 schema、用途及独立 Journal attempt／请求，首个与重复请求只派发一次；取消、源变化与工具输出均不完成交接。
- 凭证测试同时核对返回、请求正文、Journal 及其全部引用附件，不含配置密钥。

首次失败包括测试异步默认参数语法、首个与重复收据的 artifact 字段不一致，以及错误期待含密钥模型输出成功。分别修正语法、统一生产收据和按既有拒绝契约验证失败与脱敏；失败日志保留。

3.5 的确认、源 intent／目标 received／源 committed 和真实崩溃恢复尚未交付，预览及摘要不会模拟这部分。正式交接 UI 由 10.3 继续。
