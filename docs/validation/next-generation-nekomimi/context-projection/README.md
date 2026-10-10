# 有界工具结果与分层上下文预算（任务 4.5）

2026-10-07，macOS arm64 / Node 24.15.0。假 Provider、完整 Journal 附件及实际续轮 body 对照；未进行真实模型质量验收。完成状态以实际最终日志与任务勾选为准。

预算／投影采用版本 2。模型占用绑定模式、目标、任务目的、有效声明、上下文与模型；输出、安全及可能工具结果预留分开，工具结果默认预留为 min(2048, floor(W × 2%))，无工具时为 0。已知容量的最终准备入口再检查总输入，未知容量只给出估算与明确的输出配置，不产生虚构输入额度或百分比。主请求和压缩使用同一预算口径。

系统指导、工具概要／指导、用户／项目／目录规则、目录、技能、schema、环境、历史、工具结果、摘要、交接和图片按来源分层。层的 estimatedTokens 和 adjustmentTokens 分开，最终 tokens 合计与系统／声明／消息三类和总量一致。Provider usage 是旧请求样本，用于保守估算校准，不作为下一请求实测值，也不宣称每层是真实计费。锚点包含策略版本、模型／端点／协议身份、输出配置、模式、目标、声明、提示词、压缩检查点及图片实际编码摘要；模型、schema、图片或模式变化后旧样本失效。辅助 usage 无论由自身 purpose 或关联 attempt 标识，都不能校准主占用。

统一工具管线先保留经凭证保护的完整 JSON 结果，再按 UTF-8 与 JSON 编码预算选择文本，单独保留图片。首段文本含省略提示与续读入口；图片最多 4 个，受 4 MiB 原有完整证据上限约束。省略图片按完整结果附件中的原 content 索引显式读取，Core read 增加 imageIndex；不会重跑原工具。裁剪后的 resume 指向完整结果 JSON，原文件 nextOffset 放在 sourceDetails，避免将完整返回的末尾当成可见文本读完位置。

`tool.projection` 保存完整附件、投影附件、保留索引／摘要、省略量、策略及宿主续读 framing。请求选择条目保存同一转换引用；实际后续 wire body 保持对应的投影内容与完整附件入口。原图片不变成截断 base64 文本，原规则或历史附件不覆盖。

验证：

- `tests-first.log`：8 文件 90/91，唯一失败为旧 SDK 调用方只查看首段，省略提示在后续文本段。保留错误，提示移到首段，原断言未改。
- `tests-fixed.log`：8 文件 91 项通过，包括新增 6 项层次／预留、锚点失效、辅助隔离、Unicode／控制字符完整证据、图片显式续读及真实大文件工具续轮。覆盖原有压缩、快照 I/O 故障、提示词、工具管线及错误行为。
- `types-final.log`、`build-final.log`、`specs.log`：类型、构建与严格规格 43 项通过。
- `regression.log`：首次完整回归 80 文件 549/550，新增 imageIndex 参数使受限场景估算达到 1004，高于历史基线 939。精简重复的参数说明，未更新历史 fixture 或放宽断言。
- `concise-tests.log`：5 文件 52/53，预算基线已通过，但精简遗漏了原有的 Zero-based UTF-8 byte 描述契约；恢复该说明。`contract-tests.log` 保留恢复后估算 941 的失败，继续压缩 imageIndex 描述。
- `contract-verified.log`：最终 2 文件 31 项全部通过，原有描述契约与预算基线同时满足。`types-verified.log`、`build-verified.log`、`specs-verified.log` 为最终源码的类型、构建及严格规格检查。
- `regression-verified.log`：80 文件 549/550，预算和投影全部通过，唯一失败为既有会话列表测试。冷读取执行了完整附件校验，缺失显示附件使会话被排除；热缓存读取不打开该附件，结果取决于缓存状态。`navigation-reproduce.log` 单跑通过；原尝试的 `navigation-eviction-before.log` 未能确保驱逐，不能作为修复证据；`navigation-cold-before.log` 同时打开两个服务被配置写入租约拒绝，夹具改为关闭后重启。
- `navigation-restart-before.log`：确定性重启复现原分页版本断言失败。修复让元数据路径用 JournalReader 校验可靠链，并检查格式／归属，不读取显示附件；生产执行的 inspectJournalFormat 和 readSession 仍校验完整附件。`navigation-fixed.log`：4 文件 35 项通过；`navigation-verified.log`：重启分页与完整执行准入原断言均通过，4 项。原分页断言和缺失附件未删除，新增完整执行仍拒绝 ENOENT 的断言。
- `types-complete-verified.log`、`build-complete-final.log`：含冷元数据修复的类型及构建检查通过。

`regression-complete-final.log`：最终固定源码完整回归 80 文件 550 项全部通过，退出码 0，302.51 秒，2 workers。严格规格与差异检查分别记录在 `specs-complete-final.log`、`diff-complete-final.log`。日志中的存储错误为断租约／I/O 故障注入场景，不是未处理的失败。manifest 记录源码、编译构建和日志摘要。

任务 4.5 已按实际验证勾选，整体进度 40/89。新工作台来源／分层详情由 10.5 接入，摘要状态提交由 4.6、交接选择由 4.7 独立验收；这份记录不宣称真实模型质量、完整新工作台、Linux 或全部规格已完成。
