# 10.6 调用树与逐次证据

环境：macOS arm64、Node.js 24.15.0；基线 HEAD `be50c5a8a1557ef160056b964cd29e65b395685d`，对象为未提交工作树。本批次不代表 Linux、最低 Node、安装包或真实模型质量/成本验证。

## 实现及权威来源

`GET /sessions/:id/inspection` 从会话 Journal 建立可丢弃的运行/调用索引。模型按 modelCallId、工具按 toolCallId，使用 parentToolCallId/parentModelCallId 构树；父引用缺失或循环显示诊断，不隐藏孤立调用。运行目录、同级调用、attempts 和事件均按 40 项分页，深层调用可从所选节点继续浏览。

父脚本及每个子调用保留独立终态；Codemode 已记录的取消终态不被后续通用 tool.failed 覆盖。无终态且已不在活动运行的调用显示 unknown。不会把父失败解释为子副作用已回滚。详情保留模式、目标、资源、候选、验证任务及工作流等关联引用，未记录字段不由当前配置补写。

逐 attempt 可选实际请求与转换、原始响应及归一化结果、上下文来源、用量与重试，也保留全部事件入口。原始 body/hash、响应块、结果与附件独立展示，附件支持有界续读。分类结果从已保存的归一化 JSON 展示；图片仅显式读取已记录的 PNG/JPEG/GIF/WebP 附件，经 hash/大小/MIME 与文件签名检查，超过 16 MiB 仅拒绝图片预览，原始附件仍可分段读取。没有外部图片 URL、SVG 或 iframe 自动挂载。附件缺失返回明确诊断，不重跑模型补齐。

费用与用量仅按独立 attemptId 汇总，忽略父工具/脚本复制的子调用用量；输入、输出及缓存已知小计分别列出缺失次数。产品当前没有已验证价格契约，费用保持未知，不展示 Pi 合成的零成本为真实费用。重试失败、取消及未知 attempts 都保留，不把缺失统计写成零消费。

从 `context.view`、`attempt.started` 或 `request.transform` 的捕获引用可打开精确 snapshot eventId，不能用当前上下文替代过去的请求。交接来源显示捕获时选择/排除事实，并单独查询当前可回溯状态；匹配 handoffId 与 payloadHash 后才能提供来源会话与交付版本链接。重开及刷新立即核对来源，来源删除后只保留历史快照和缺失说明。

工作/创造标题区域提供共享入口；详情使用设计系统控件及键盘可达展开按钮，关闭恢复入口焦点并保留草稿。所有详情、分组、图片、附件与来源核对都是已鉴权读取，不获取工厂、不执行脚本或模型，也不自动开启历史预览。

## 验证

- `npm run typecheck`：完整 Node 与 Web 类型检查通过，`types-complete.log`。
- `npm run build`：构建通过，`build-complete.log`。
- `npx vitest run test/inspection.test.ts test/context-details.test.ts test/typed-model.test.ts test/model-operations.test.ts test/codemode-partial-failure.test.ts test/codemode-pipeline.test.ts test/reference-evidence.test.ts test/stream-projection.test.ts --maxWorkers=2`：8 文件 34 项通过，`unit-final.log`。
- 浏览器检查器与上下文 8 项通过，`browser-final.log`；最终检查器、上下文与工作台共 18 项通过，见 `browser-complete.log`。
- `openspec validate --all --strict`：43 项通过，`spec.log`。

新增服务端四项测试覆盖父失败/子成功、取消终态、实际 Codemode 写入保留、逐 attempt 去重及分组、部分用量、分页、父引用缺失、跨作用域拒绝、原始附件和图片完整性/缺失/不支持类型。工厂 acquire 计数及 Journal 字节保持不变。已有 typed-model、model-operations、Codemode partial-failure 等回归使用假 transport 验证实际记录入口，包含真实 VM/工具执行与取消 unknown；不以人工构造事件代替这些执行证据。

浏览器四项新增用例覆盖两个工作台的嵌套状态、实际 Pi 类型适配器捕获的分类/图片结果、逐 attempt 请求及 hash、父用量不重复计入、未知价格、360px、缺失图片、焦点/草稿保留；另外用真实请求及交接确认生成的快照验证历史模型与当前模型分离、固定引用、交付版本链接和来源删除。域写请求为零（连接鉴权 `/connect` 不算领域写入），模型调用数和 Journal 字节没有因查看而变化。

## 发现与修复

最初手工树夹具缺少 title/工具 args，既有会话投影拒绝处理；补齐符合契约的夹具后两项基础接口检查通过。随后增加了真实 VM 与图片接口检查，四项通过。

首次浏览器定位把图片当作第一个输出项，但实际保存了前面的文字、图片索引为 1；修正定位保留原始输出索引。来源测试最初寻找调用创建前保存的 context.snapshot，实际关联入口为调用自己的 context.view 所持有的精确快照引用；按实际记录检查，不修改历史。

删除来源后的复验揭示客户端默认 5 秒 fresh 缓存可复用旧来源状态；已对当前来源检查设置重开强制核验、定期读取和显式刷新，读取过程中显示核对状态。修复后 8 项浏览器通过。所有失败日志保留。

## 未在本批次声称完成

10.7 的虚拟化、跨断点阅读锚点及高度变化验收，10.8 的核心切换 UI，10.9 的全站切换/旧 CSS 清理和第 11 组整体验收仍独立待办。没有真实模型请求、提交、推送、归档或发布。
