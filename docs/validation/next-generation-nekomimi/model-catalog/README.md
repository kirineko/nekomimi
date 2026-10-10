# 类型化模型目录与用途配置（任务 5.5）

2026-10-07，macOS arm64 / Node 24.15.0。全部合成 Provider，无真实付费调用。

模型身份为 provider/operation/id，operation 为 chat/classifier/image，省略时是 chat。同一 ID 的三种操作分别保留，重复同类型 ID 拒绝。注册与返回目录分别复制模型定义，目录刷新或调用方修改副本不改写运行捕获值。容量 0 表示未知／不适用；不要求图片模型伪造聊天窗口。

Provider profile 保存 operation，选择和执行均校验用途所需类型。work/create/compaction/session-title/handoff/classifier/image 独立选择；更改 create 不修改 work 或命名。当前新格式内未单独选择的工作、创造、压缩和交接仍明确使用 main 默认项，命名使用 naming，扩展聊天使用 auxiliary。CLI、HTTP 提交门禁与只读上下文模型选择按模式/用途读取配置。显式运行 profile 是该次调用的覆盖，不自动切换 Provider。

model_catalog 提供分页和操作过滤，SDK 可通过 callTool 调用同一只读入口。返回身份、能力、profileIds、credentialStatus、configured、available 和原因，不返回密钥、不加载资源工厂、不额外调用模型。内置模型使用持久配置或当前运行提供的凭证状态；自定义 credentialRequired=true 需凭证，否则登记允许无凭证端点。没有资料与缺少凭证分别报告。分类/图片执行尚待 5.6，明确报告 operation-not-integrated，不把配置存在伪装成可运行。新工作台选择页面由 10.4 实施。

## 证据

- types-first：误用了 ConfigStore.public，改为现有 describe；后续类型检查通过。
- tests-first：4 文件 45/46；错误类型在模型准备阶段直接抛错，测试错误地预期 RunResult.failed。改为断言早期拒绝，仍断言零网络派发。
- tests-fixed：6 文件 60 项通过，包含 Provider、上下文运行、交接摘要、提示基线与只读状态检查。
- catalog-server-tests：3 文件 30 项通过，增加真实 model_catalog 工具路径、当前运行凭证状态和服务回归。
- catalog-final：5 项专项通过，补充无需凭证模型的 not-required 状态。
- unknown-capacity：2 文件 7 项通过，包含未知/不适用容量及注册契约。
- 合计 75 项不同相关测试通过。types-verified、build-final、specs 分别记录最终类型、构建及 43 项严格规格通过。未重复扩大测试来宣称完整新产品已完成。

专项实际捕获两次请求分别为 work-model/create-model，命名选择不变；错误类型及缺失凭证均零请求。目录结果不含合成密钥；metadata 查询不产生额外模型 attempt。未验证真实模型质量，未归档、提交或发布。
