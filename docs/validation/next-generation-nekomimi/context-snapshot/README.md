# 不可变请求上下文快照与选择清单（任务 4.2）

2026-10-07，macOS arm64 / Node 24.15.0。未提交 apply，使用假 Provider，没有真实模型质量结论。

`src/context-snapshot.ts` 深复制并冻结每次请求的持久模式、目标、模型／端点身份、活动及有效声明 revision、来源 cursor、实际 ContextView 和有序选择。选择项含来源、内容摘要、角色、层次、作用域、版本和选入／排除理由；模式及调用方工具过滤、未满足工具依赖、辅助隔离、压缩替换及选定数据 framing 分别记录。未暴露工具只有身份摘要，不假称已捕获不存在的 schema。无持久身份的旧辅助夹具标 unbound，来源 links 只给出已知的 mode／target ID。

正式 Durable beforeRequest 等待可靠投影后准备产品快照；受记录 stream 只消费同一 Provider 准备的一次性对象，不再从框架历史或等待期间改变的 prompt 重新取值。模型和序列化定义也固定。准备基于 Journal 可靠水位，纯元数据增长只改变 cursor；revision envelope 规范排序，原 Journal 身份及节点 JSON bytes／hash 不改写，调用方对象不被冻结。

context.snapshot 的附件为权威快照；context.view、attempt.started、request.transform、request.dispatched 关联同一快照。最终派发前可靠提交转换记录。内置 Responses 核对最终 model、instructions、input、tools 和输出预算，逐字段映射到选择 ID；自定义 Provider 保留 serialize 完整公开输入附件、注册版本及精确输出 bytes，记录 whole-envelope 转换，不通过重跑代码重建旧证据。

验证：

- `fault-tests.log`：新增 12 项通过，注册顺序、深复制／调用方可变性、准备后 prompt／schema／model／新增历史改变、一次性消费、正式原生任务身份、压缩来源以及快照和转换的 8 处 append／fsync／水位 I/O 故障；故障均零网络派发。
- `custom-transform-tests.log`：20 项自定义 Provider 契约通过；Responses／Chat 两种协议的完整输入、角色历史、指令、schema、注册版本与精确输出附件逐项对应。
- `final-tests.log`：最终 4 文件 44 项通过（2 workers），包括上述两组及 profile／受记录模型入口，计数重叠不相加。
- `regression.log`：10 文件 126 项相关回归通过，覆盖正式 runtime、HTTP、辅助请求、压缩、实际未知工具崩溃恢复及工具意图 I/O 故障；最后的可靠 prefix 及 serializer 输入补充另由 final-tests 复核。
- `complete-types.log`、`final-build.log`、`complete-specs.log`：类型、构建和严格规格 43 项通过。

首次错误与修复保留：Artifact 类型名拼写在 first-types；首次 11/12（base-tests）对 Journal 身份先做 key 排序，创造 targetId 的原始 JSON 语义被改变（base-diagnostic）。修复为原顺序验证和节点 hash，只有 revision envelope 规范化；原失败断言增加实际错误信息，未放宽。base-fixed-tests 12 项、integrated-tests 32 项通过。

本项固定输入及转换证据；能力目录与注入状态、撤权、预算、摘要提交和交接正文分别由 4.3–4.7 继续，不代表第 4 组全部交付。
