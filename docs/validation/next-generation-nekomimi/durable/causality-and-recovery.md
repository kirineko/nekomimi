# 正式运行的因果关联与恢复边界

任务2.4、2.5完成。验证范围为当前macOS/Node24的正式runtime、本地模型响应与真实子进程故障；没有调用真实外部模型。最低Node与安装包验收仍由2.8承担。

## 实现

每个Journal持有独立AsyncLocalStorage关联作用域，在进入写入队列前复制身份。显式undefined清除继承字段，异步作用域不可跨Journal污染。Durable生成请求绑定frameworkTaskId/conversationId，工具钩子、执行与可靠结果投影绑定同一原生工具任务，并关联产生工具的modelCallId/attemptId。

受记录工具进入独立子作用域，子调用有独立toolCallId及parentToolCallId。扩展进程回调显式捕获父身份，并在RPC子调用中恢复作用域；子模型调用另建modelCallId，不借用父attemptId，保留parentModelCallId/parentAttemptId。恢复unknown继承原运行和原模型attempt，不误记为新请求的执行。

租约失效使Journal失败信号取消在途模型并阻止后续工具意图。proper-lockfile已释放失效租约后，清理只忽略该已知ERELEASED，不再次操作替代写入者的锁。

## 验证证据

- causality-regression.log：10文件82项通过，包含真实扩展进程并发子调用、正式运行请求和工具原生任务关联、日志seq唯一、第二写入者拒绝、缺失/损坏附件、中段损坏、取消及模型证据。
- causality-streams.log：5项通过，额外加入两个同时在途的受记录响应流，分别校验artifact字节、attempt和任务身份；其余4项与前项重叠。两组共83项不同测试。
- durable-runtime-recovery.test.ts：在正式工具意图的append/fsync/watermark.write/watermark.rename四处注入失败，实际文件副作用均为零；真实SIGKILL发生在shell外部效果之后、结果提交之前，显式继续后只发出一次新请求、效果计数仍为1、旧意图仍为1且unknown回指原任务/运行/attempt。
- causality-typecheck.log与causality-build.log：类型及完整构建通过；import-boundaries.json继续确认19处公开框架入口。

此前租约丢失测试暴露ERELEASED清理异常，已按已知失效租约修复；扩展夹具曾因语法和未列入显式工具清单而失败，修正后验证的是实际执行与嵌套RPC。此处不宣称全部spec或新工作/创造模式已经完成。
