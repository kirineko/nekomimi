# 能力目录预算、按需资料与资源状态（任务 4.3）

2026-10-07，macOS arm64 / Node 24.15.0。假 Provider 验证，未进行真实模型质量验收。

`context-policy.ts` 固定初始策略版本：目录 JSON 4096 bytes、查询页 12000 bytes／最多 32 项、描述 256 UTF-8 bytes、强制规则与模式指导合计 128 KiB。查询分页还检查包含正文及 details 的完整工具返回是否满足通用投影上限，避免结构化游标被裁剪。返回 revision、total、offset、items、omitted、next 和 byteLimit；描述及过长来源保留原文 hash 与裁剪标记；注入目录另核对安全转义后的 JSON 大小，不按目录预算截断规则。资源顺序按 ID 固定，查询拒绝不同 activation revision。

`resources.context` 保存当前运行的资源身份、内容 revision、范围、模式可见性及目录状态。读取事件保存独立内容 hash／附件与资源 revision。每次 `context.snapshot` 分别记录 discoverable、read、effective、injected、historical，以及读取证据和本次指令／工具数据注入来源。有效但未读取的技能不注入正文；已读取技能在下一运行只保留历史读取事实，旧加载收据不被误认作技能正文。规则稳定 source 的注入只关联最近读取，工具数据通过 Journal 原生 toolCallId 关联实际投影，避免与 Provider wire call ID 混淆。

强制规则预算在主请求、自动／手动压缩之前检查，且独立 Provider 快照入口也检查；容量已知时另核对扣除输出与安全余量后的输入额度。失败说明来源，原规则附件保留，零模型／额外摘要调用。

验证：

- `tests-first.log`：7 文件，78/79 通过。唯一失败为分页正文和 details 的合计超过通用结果投影上限，原始日志与断言保留。
- `tests-final.log`：10 文件 102 项通过，涵盖当时新增 4 项资源目录／状态／原生与 wire 身份／超限门禁，以及快照故障、提示词、作用域规则、模式、命令、包和 Durable 工作流回归。
- `manual-gate-tests.log`：最后增加手动压缩门禁后，资源与压缩 2 文件 13 项通过；不另累加到 102 项。
- `encoding-tests.log`：目录含大量 UTF-8、尖括号、引号及与符号时，注入后的目录也有界；相关提示词／压缩 3 文件 43 项通过。
- `state-tests.log`：最终补充目录规则变化的最新内容／旧版本状态归属，资源／规则／快照 3 文件 19 项通过。
- `typecheck-state.log`、`build-state.log`、`specs-complete.log`：最终类型检查、构建及严格 OpenSpec 43 项通过。
- `pack.log` 的首次安装包验证发现原夹具以工作模式查找开发资料，SDK 资料正确被隐藏；保留错误，未改产品门禁。夹具改为独立目标的显式创造会话后，`pack-corrected.log` 通过安装后 SDK 分页／读取、CLI／Web／导入导出、Provider、工作流、MCP、候选和真实 Durable 崩溃不重放。该安装包对应 encoding 构建；其后的规则状态补充由 state-tests 与 state 构建复核，完整新功能最终安装包门槛仍由第 11 组执行。

150 个长 UTF-8 描述资源的查询逐页验证完整覆盖、没有重复或丢失、每页正文和完整结果满足各自预算、游标与省略数量一致。实际首轮／工具续轮／下一任务 body 与快照状态对照；超限规则原文附件逐字一致，普通请求及手动压缩均零派发。

4.4 的停用／作用域再校验、4.5 的完整分层测量与结果裁剪、4.6 的摘要状态及 4.7 的交接正文仍在 change 中，不用目录状态字段代替这些行为的验收。
