## 1. 共享高亮内核

- [x] 1.1 固定 Shiki 4.4.3 及必要直接依赖，建立 core + JS engine 的语言/别名/扩展名注册和 github-light 固定 CSS 类映射；验证 typecheck、七语种 token 原文拼接、未知语言降级与不输出任意样式。
- [x] 1.2 建立可复用的 token 投影与行映射，处理 fontStyle、CRLF、BOM、Unicode、尾部换行和现有长行截断；使用独立边界输入断言展示文本、行号与复制来源保持一致。
- [x] 1.3 为浏览器及 Node 建立可终止 Worker 适配、懒加载、队列限额、输入/时间预算及 LRU 缓存；验证超时可终止、后续任务可恢复、超额降级、会话隔离与删除清理。

## 2. Markdown 与 diff 接入

- [x] 2.1 为共享 Markdown 渲染接入 token 结果，保留 inline code 与现有安全行为，合并流式增量并拒绝迟到结果；验证未闭合 fence、加载失败、取消/切换会话及完成块缓存。
- [x] 2.2 实现普通 diff fence 及 diff-ts 等扩展标签的两侧片段高亮；验证增删前缀/块头、未知语言、损坏 patch、多 hunk 局部状态及原文保真。
- [x] 2.3 从已确认历史 artifact 计算文件 diff token，在 API 增加可选展示字段，接入 DiffView；扩展 workbench-services 测试覆盖 8/120 行分页、多行注释、两侧状态不同、新文件、旧快照缺失/损坏/脱敏和当前文件变化。
- [x] 2.4 在现有样式中组合语法颜色与 diff 背景，保留统计、复制、分页和截断入口；浏览器验证实际颜色、焦点、窄屏滚动和原有交互不回退。

## 3. 离线导出

- [x] 3.1 在脱敏后预计算 Markdown 与历史 diff token，再同步生成自包含 HTML 并内嵌固定样式；验证无需脚本/网络、输出文本保真、敏感原文不进入 token、失败与超预算仍能导出。
- [x] 3.2 验证导出与 Web 对相同证据的语言/颜色一致，且导入或回放仍无副作用；在浏览器断网加载导出并检查请求记录、脚本执行及 Journal 未变化。

## 4. 集成验收

- [x] 4.1 使用生产构建与实际 CSP 验证 Chromium/WebKit 的 Worker 和本地语言 chunk 加载；记录首屏依赖、高亮 chunk 原始/gzip 体积、首次与缓存命中耗时，确认未引入 CDN 或放宽 CSP。
- [x] 4.2 在真实流式页面验证 100/1,000 行代码、超过预算文本及并发可见代码块的交互响应、取消与缓存上限；记录实测环境与必要预算调整，不能以 Node 微基准代替浏览器结论。
- [x] 4.3 运行 npm run typecheck、npm test、npm run test:browser、npm run test:pack，并在 Node.js 22.19.0 验证高亮/导出与安装包资源完整性；记录通过项和任何实际阻塞。
- [x] 4.4 运行 openspec validate --all --strict，核对 delta specs、设计与实现一致，更新验证记录；仅在对应检查通过后勾选任务，本任务不包含归档或发版。
