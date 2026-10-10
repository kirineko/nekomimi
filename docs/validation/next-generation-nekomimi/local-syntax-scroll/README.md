# 10.9 上下文、本地体验、高亮与滚动迁移

2026-10-08，未提交工作树，macOS arm64 / Node.js 24.15.0 / Chrome 154.0.8037.98。

## 实现和迁移

迁移五个旧浏览器测试文件及共享滚动夹具到双工作台：`context-meter` 1 项、`local-experience` 1 项、`syntax` 2 项、`scrolling` 12 项、`scrolling-native` 1 项，共 17 项。保留默认凭证保存、IME、自动命名、双窗口删除、离线导出、高亮缓存、流式输入与取消、历史锚点、原生触控/滚动条和有界分页检查。

实际产品修复：

- 工作/创造布局为当前会话各创建唯一 SSE/分页控制器，时间线、详情和更多菜单共享状态；按会话 key 卸载旧流。原实现每个组件建立订阅，两个窗口可能占满浏览器同源 HTTP/1 连接额度并阻塞提交。双窗口测试现在分别断言仅一条活动 events 请求，并继续完成提交、导出、删除与另一窗口的已删除反馈。
- 离线 HTML 高亮生成器使用与新工作台相同的默认高对比浅色调色板。保留原 token 身份、对比度修正和字体样式；浏览器比较实际出现的全部 token 颜色，验证无外部请求、无脚本执行和刷新不重跑模型。
- `design.md` 记录共享订阅的组件所有权；Journal、服务端执行协议和持久化水位不变。

## 验证口径

最终 **41/41 浏览器检查、12/12 高亮及会话流单元检查、完整类型检查、构建与 43 项严格规格检查通过**。综合浏览器命令：

```sh
npx playwright test test/browser/context-meter.spec.ts test/browser/local-experience.spec.ts test/browser/create-conversation.spec.ts test/browser/v2-history.spec.ts test/browser/syntax.spec.ts test/browser/scrolling.spec.ts test/browser/scrolling-native.spec.ts test/browser/inspection.spec.ts test/browser/handoff-cards.spec.ts test/browser/header-recovery.spec.ts --workers=2
```

单元命令：`npx vitest run test/syntax.test.ts test/v2-session-stream.test.ts --maxWorkers=2`。仅本地模拟 Provider 和扩展夹具，无真实模型调用。

中途失败日志保留。迁移适配的具体口径：

- 上下文入口遵循当前 delta 的文字摘要和详情弹层，检查主题、统计、关闭焦点、窄屏与跨设置草稿；不要求被新规格替换的旧环形入口布局。
- 原 Inspector 的响应 Markdown 缓存检查改为同一会话重复相同代码的真实模型替身回复；worker job 数不增加，另以 reload 验证持久历史重建不执行。新 Inspector 的原始请求/响应与只读检查由同批 `inspection` 场景覆盖。
- 历史区域遵循固定高度导航设计，无旧 overlay；检查导航与正文不重叠，提示/失败不改变视口高度。
- 屏外正文不强求挂载；延迟 diff/面板先定位稳定行并滚入视口。面板夹具补齐 SDK 3 契约和真实会话 scope，禁止将旧契约拒绝误认为渲染通过。
- 固定布局的滚轮轨迹先预热邻近虚拟行，等待布局稳定，再保留每帧方向与最终位置 **2px** 精度。首次挂载估计高度变化属于独立动态增高锚点场景；该场景继续验证布局/手动移动同帧及新消息下的 **2px** 锚点补偿。
- 触控惯性结束和注入可见原生滚动条的布局稳定后，再显式返回最新；原生按住超过 600ms 的检查保留。

最终样本中 60/180 行滚动 p95 约 16.7–16.8ms、无 long task。这仅是当前实现的本地样本，**没有同环境旧版本对照，不能作为 11.6 性能门槛已完成的证据**。删除测试的 `SCROLL_BASELINE` 跳过断言路径；后续真实基线应从独立旧版本 checkout 及其匹配夹具获得。

窄屏截图见 `syntax-narrow.png`，宽屏见 `syntax-wide.png`。已人工查看窄屏截图；无页面级横向溢出，代码/diff 使用局部滚动。CSS 窄屏及字体放大不等同于原生浏览器 200% 缩放全量验收。

## 剩余工作

10.9 仍未完成：运行时 UI、定制与工作台集成旧场景继续迁移，随后默认入口切换、旧页面/样式/兼容分支清理和全量浏览器验收。7.8 完整闭环及第 11 组未完成门槛仍保留。总任务 **78/89**，本轮没有以部分检查勾选综合任务，未提交、归档或发布。
