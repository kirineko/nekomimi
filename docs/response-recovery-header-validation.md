# 输出未完成与紧凑顶栏验收

变更：`improve-response-recovery-and-header`，2026-09-28。延续已有运行时 UI 实现，未归档或提交。

## 原因与实现

只读审阅本机相关 Journal：两次任务在第 6/8 次调用收到 HTTP 200、`response.incomplete`、`incomplete_details.reason=max_output_tokens`；输出都是 4096 tokens，一次推理 tokens 为 4096，另一次为 2273。这与原 32 轮限制不同。私人会话内容未复制进仓库。官方 [Responses API 文档](https://api-docs.deepseek.com/api/create-response/) 明确输出预算同时包含推理与可见输出。

按用户补充要求，内置 Responses 默认预算改为 131072（128K），运行默认最多 64 轮；CLI 显式参数优先。自定义 Provider 的模型声明与辅助命名预算保持各自配置。输出耗尽不自动扩大预算或重试；原 HTTP 临时失败重试策略保留。每次 attempt 记录预算、原因、usage、请求和响应，不完整响应中的工具不执行、不写入模型上下文。

主视图把调用与任务的重复错误合成一个结果提示；旧 `Response incomplete` 只解释为回复未完整生成，不伪造具体原因。当前响应明确输出耗尽时显示 128K 上限提示，轮数耗尽、内容过滤和超时分别处理。继续任务只填写草稿，非空草稿保留替换/追加/保留选择，用户确认发送后才执行。

顶栏保留定制能力、文件与变更和更多。更多只包含外观与导出；取消常驻恢复默认/恢复扩展按钮。外观内以自绘开关管理扩展内容，恢复默认作为低频操作，全局/项目作用域折叠到高级选项。导出改为可关闭的弹层，格式为两张操作卡片，脱敏默认折叠，错误在弹层内可见。

全部新控件采用主题字体、语义配色、间距和圆角；提供悬停、选中、禁用和键盘焦点状态。未使用原生复选框/下拉框展示新操作。减少动态效果时禁用控件过渡。

## 验证

- 构建、`npm run typecheck` 通过；`openspec validate --all --strict` 33/33 和 `git diff --check` 通过。
- `runtime.test.ts`、`conversation-display.test.tsx`、`customization-provider.test.ts` 首轮相关单元测试 32/32 通过；增加精确 64 轮边界后，前两组最终 14/14 通过。覆盖 128K 默认请求、显式 2048、max_output_tokens/content_filter、截断不重试、工具阻断、HTTP 重试、默认 64/显式 2 轮停止，以及单一结果提示。
- 相关浏览器测试首轮 15 项中 13 项通过；旧导出测试增加关闭新弹层，主题切换测试等待真实字体/入场动画完成后再点击 iframe。修正后的 `header-recovery`、`runtime-ui`、`local-experience` 四项复验全部通过。其他已通过的测试覆盖真实 HTML 下载、离线导出、文件/追踪、停止任务和窄屏布局。
- 新顶栏用例覆盖外点/Escape 关闭、焦点恢复、草稿冲突、无独立恢复扩展按钮、扩展内容开关、高级设置折叠、脱敏、200% 恢复及导出关闭；导出失败反馈在最终构建补充复验 1/1 通过。
- 主题用例检查开关圆角与背景色、导出弹层颜色、实际字体加载；保存并人工审阅 `output/playwright/header-theme-menu.png`、`header-theme-export.png`、`header-compact.png`（按惯例不入库）。

初次主题交互测试未等待宿主主题入场动画，iframe 内元素稳定不代表外层动画结束；增加等待实际 `Animation.finished` 和字体就绪，不使用固定 sleep、不重发点击。取消预览关闭菜单并恢复入口焦点。

环境为 macOS、Node.js 24.15.0、本机 Chrome。200% 使用 CSS zoom；未重跑跨操作系统安装矩阵或真实模型调用，不保证任意任务在 128K/64 轮内必然完成。提高的是默认上限，不强制模型生成该长度；已有失败历史保持原事实。
