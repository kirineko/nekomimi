# 最终回归

**最终结果：单元 788/788、浏览器 201/201、类型检查、严格规格 43/43、发布检查 7/7 全部通过。** 最新日志为 [unit-final.log](unit-final.log)、[browser-final.log](browser-final.log) 及 `*-final.log`。最终 build 为 `f7424580c8a12f881340ca43507c425c011e0f790cb7c566c67e0acf619eb2a3`。下文按阶段保留失败和修复过程；过程中“待验证”不代表当前仍未完成。

2026-10-09，macOS arm64 / Node 24.15.0 / Chromium 154.0.8037.98；未提交工作树，HEAD `be50c5a8a1557ef160056b964cd29e65b395685d`。构建产物身份 `b136be4b97794a0e20b4583c0dd03b08e00494bed814026d965cae67362b1362`，与四组平台安装包相同。

## 单元、类型与规格

`npm test -- --maxWorkers=2`：132 个文件，787/787，通过，476.54 秒。包括真实进程/崩溃与写盘故障注入，预期诊断不是测试失败。见 [unit.log](unit.log)。最终 `npm run typecheck`、`openspec validate --all --strict` 43/43、`npm run test:release` 7/7 均通过，见同目录日志。

首轮默认并发为 754/787，33 项均为超时（[unit-first-failure.log](unit-first-failure.log)）。四个关键故障恢复/MCP 文件隔离复验 23/23，通过，69.02 秒（[failure-isolation.log](failure-isolation.log)）。再按 2 worker 跑完整套件通过；未提高超时、跳过测试或降低业务断言。首次与 Docker/安装等负载并发，但未把负载猜测写成已证实根因。

## 浏览器

首轮完整 `npm run test:browser -- --workers=2`：200/201，3.9 分钟。唯一失败是 chat-loading-focus 的全页 status 定位同时匹配外层对话框加载和工作台状态，未等待具体主题加载区域；见 [browser-first-failure.log](browser-first-failure.log)、[错误上下文](browser-first-error-context.md)、[trace](browser-first-trace.zip)。修正为“主题管理加载” region 内的 status，保留文字、取消、焦点、草稿、资源按需及失败重试断言；未更改生产代码。

加载场景修正后 5/5 通过。第二轮全量为 200/201：嵌套确认关闭后立即点击外层的用例未等焦点回到触发按钮，见 [第二次失败](browser-second-failure.log) 与对应 trace。增加原触发按钮焦点恢复断言后，两项各重复五次，共 10/10 通过，见 [dialog-repeat.log](dialog-repeat.log)。未删除取消或焦点断言。

## 最终审计追加：删除原始异常调试输出

发现遗留 `NEKOMIMI_DEBUG_HTTP` 分支会直接输出原始异常。新增真实 HTTP 500 故障注入测试，异常含模拟凭证；修复前回归明确失败（[http-privacy-before.log](http-privacy-before.log)）。删除该分支后，HTTP 响应仍保持原通用错误，控制台不再泄露原始异常；隐私/服务/诊断三个文件 22/22 通过（[http-privacy-after.log](http-privacy-after.log)）。

因此上述 build/787 项记录是移除调试分支前的阶段证据。最终源码新 build 为 `f7424580c8a12f881340ca43507c425c011e0f790cb7c566c67e0acf619eb2a3`，正在重跑 788 项完整单元、201 项浏览器及四格同包平台验收。当前不宣称最终门槛已完成。

## 最新完整单元结果

最终构建 `f7424580c8a12f881340ca43507c425c011e0f790cb7c566c67e0acf619eb2a3`：`npm test -- --maxWorkers=2`，133 文件 **788/788** 通过，501.27 秒，见 [unit-final.log](unit-final.log)。新隐私用例包括在内。类型检查、严格规格 43/43、发布检查 7/7 通过，见 `*-final.log`。完整浏览器仍在运行。


最终源码的首次浏览器全套为 200/201（[browser-third-failure.log](browser-third-failure.log)）。`v2-runtime-slots` 在 Escape 后只核对了本来就未改变的草稿，尚未确认关闭和焦点返回便再次点击 iframe 按钮；随后等待追加按钮超时。补充确认框消失与原 iframe 获得焦点两项断言，保留鼠标点击、追加、页面桥接、窄屏、重挂和持久草稿检查；连续 10/10 通过（[slots-repeat.log](slots-repeat.log)）。生产代码/产物不变，完整浏览器再次执行中。

## 最终浏览器结果

修正三处测试同步后，`npm run test:browser -- --workers=2` **201/201** 通过，3.8 分钟，exit 0，见 [browser-final.log](browser-final.log)。没有自动重试、跳过、增加超时或放宽滚动/取消/焦点/草稿断言。最后一次类型检查亦通过。所有首次失败日志和 trace 保留；历史单元/浏览器数字不累计为独立测试总数。
