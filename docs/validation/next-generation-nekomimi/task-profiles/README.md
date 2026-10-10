# 持久模式与任务用途的版本化 profile（任务 4.1）

2026-10-07，macOS arm64 / Node 24.15.0，当前未提交 apply，没有真实模型质量验收。

正式 runtime 从持久 mode 选择 work／create v3。工作 profile 指导原项目及已可用能力，缺口只提出待确认交接，不包含 SDK 正文或产品激活流程。创造 profile 固定独立目标、宿主构建／SDK／数据契约版本及项目默认范围，区分候选检查、预览、加载、应用和宿主验收；具体工具指引仍以启用工具为条件贡献。

压缩和交接各 v3，只保留事实、版本、阶段、待授权／应用及 UNKNOWN；命名保持独立 v2 的原语言和长度约束。所有三类辅助 profile 丢弃传入的执行工具和主任务附加指导。旧 main 组装别名只映射 work，正式 mode 由持久身份选择。每个 profile 有 source、版本及文本 hash；context.view 持久实际指令，内置／自定义 Provider 的 attempt.started 记录相同用途与 profile。模型配置分用途仍由任务 5.5 处理。

`admission-tests.log`：8 文件 106 项通过（2 workers）。包含新增 3 项 profile 固定文本／实际 body／历史证据契约，及模式门禁、压缩、交接、命名、上下文与自定义 Provider 回归。

`profiles.json`／`test/fixtures/task-profiles.json` 固定五类完整正文、版本及 SHA256。类型／构建／严格规格 43 项通过（complete-types／admission-build／complete-specs）。实际工作及创造请求以相同用户文本构建，捕获 body.instructions 并与 context.view 原字节及 attempt profile 对照；历史 v2 附件与 Journal 原字节保持不变。辅助真实路径由既有压缩、命名及交接契约复核。

首次 102/106 保留 first-tests.log：新附件夹具没有规范化 macOS /var 别名，安全门禁拒绝；新权限夹具原本已经预先信任，后台初始化完成时请求成为合法的既有授权设置。修正为规范目录和显式撤销后申请首次授权，未放宽生产权限或附件检查。提示正文初稿受限场景估计 1055 超过原基线 939，精简后仍为 947（final-tests／budget-check）；继续精简重复措辞，保留需求和原预算断言，不更新旧基线掩盖增长。这里比较的是离线保守估计，不宣称缓存、质量或实际 token 收费改善。
