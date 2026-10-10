# 10.5 上下文详情验证

本批次针对 `next-generation-nekomimi` 的上下文入口、当前分层预算、请求选择/排除及压缩来源。环境为 macOS arm64、Node.js 24.15.0，基线 HEAD 为 `be50c5a8a1557ef160056b964cd29e65b395685d`，验证对象为未提交工作树；不代表 Linux、最低 Node 或最终安装包验收。

## 行为

- 工作和创造会话均提供共享的键盘可达入口。当前占用来自当前会话的完整 Journal 投影；历史选择分页与可见聊天页不参与占用计算。当前估算、匹配样本和累计计费用量明确区分；容量未知没有百分比，也不沿用历史模型容量。
- 当前详情展示模式、目标、模型、上下文/能力版本、分层来源、排除原因、输出/安全/工具结果预留与预算策略版本。当前能力不可用时明确说明，没有把历史测量当作当前统计。
- 历史请求固定 snapshot eventId 后分页，每页 40 项，可按选入/排除过滤；包括来源 hash、作用域、角色、理由、转换及大结果原始/投影引用。快照目录按不可变 seq 续读。
- 压缩记录按 seq 分页，分别保留提交、失败、取消和开始状态；摘要预览有上限、附件按字节续读，来源节点每页 40 项，可查看来源身份、上次检查点和保留事实。开始记录不等同于当前仍在运行。
- 所有详情和附件请求均为已鉴权 GET；接口不获取资源工厂、不执行模型或工具。查询缓存按会话、请求和分页参数隔离，取消或迟到读取不覆盖另一会话。附件损坏/缺失明确报错，刷新失败不继续把旧数据展示为当前。
- 弹窗关闭恢复焦点并保留草稿。360px、深色及 20px 根字体放大检查修复了共享 Dialog Portal 遗漏 `.ds` 导致的盒模型越界，并给 outline/ghost 按钮明确前景色。修复使用共享控件，未引入旧页面选择器。

## 检查与证据

- 完整类型检查（含 Web TS）：`npm run typecheck`。
- 构建：`npm run build`。
- 定向单元回归：11 文件 86 项全部通过，`regression-final.log`；固定构建后独立运行 `npx vitest run test/context-details.test.ts test/context-service.test.ts test/context-projection.test.ts test/context-snapshot.test.ts test/context-compaction.test.ts test/compaction-source.test.ts test/context-runtime.test.ts test/context-revalidation.test.ts test/handoff-context.test.ts test/resource-context.test.ts test/v2-session-stream.test.ts --maxWorkers=2`，未调整测试超时或断言。
- 共享控件相关浏览器回归：上下文、基础设置、主题和工作台共 21 项通过，`browser-verified.log`。最后的身份折叠排版使用上下文 4 项单独复验，另见最终日志。
- 后端新增三项检查覆盖 work/create 两种模式、固定快照分页、跨会话引用拒绝、未知容量、工厂 acquire 零调用、模型调用计数不变和 Journal 字节不变，以及摘要截断与完整引用分页。
- 浏览器使用真实本地服务和假 transport；覆盖两个工作台的来源/附件续读、分页不改变当前统计、零领域写请求（连接鉴权 `/connect` 除外）、模型调用不增加、Journal 不变、草稿和焦点保留、窄屏放大、附件缺失及会话切换中的迟到读取。
- 浏览器压缩数据为符合 Journal 引用和来源身份校验的展示夹具；不把它作为压缩质量证明。实际压缩行为由 `context-compaction`、`compaction-source` 和运行时回归验证。

## 发现与修复记录

首次浏览器夹具漏传创建 commandId；补齐后压缩夹具因缺少有效引用被投影校验拒绝，改为真实节点 hash 和匹配的来源身份。随后修正 Select 的浏览器定位方式。零写计数曾包含连接鉴权，现仅排除 `/connect`，业务操作仍要求零写。窄屏放大实际发现 Portal 盒模型越界及深色按钮对比度问题，已修复并保留截图验证。

第一次扩展单元测试与浏览器并行时，`context-details` 和 `handoff-context` 各一项达到原有 15 秒门槛，其他 83 项通过；日志保留为 `regression.log`。固定构建、浏览器结束后以两个 worker 运行，86 项全通过。并行资源竞争是待确认原因，不据此宣称全套默认并发稳定。

最后新增的分页稳定性断言曾混用 `innerText` 与包含折叠内容的 `textContent`；统一按可见文本比较，没有删除稳定性检查。失败日志均保留，不覆盖为成功结果。

## 边界

本批次不宣称任务 10.6 的嵌套调用/费用检查器、10.7 的全历史虚拟化与跨断点阅读锚点、10.9 的全站切换和旧 CSS 清理已经完成。没有真实模型调用、提交、推送、归档或发版。
