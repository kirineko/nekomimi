# 统一执行管线与模型取消边界

任务2.6与2.7完成。环境为macOS arm64、Node24.15.0，使用本地响应和实际扩展子进程；未调用真实模型。安装包及最低Node门槛由2.8继续。

## 工具管线

`src/customization/execution.ts`将执行分为prepare和一次性execute。真实schema与能力版本固定，参数准备、schema、权限和前置hooks仅执行一次。Durable前置钩子准备准入对象，原生意图持久后消费同一对象；重复消费、参数变化、取消均拒绝。框架仅检查object封套，模型请求仍包含完整产品schema。扩展RPC复用同一管线，父子调用分别有独立身份。

后置观察使用参数和结果的副本；观察异常写tool.observer_error，不改写tool.completed，不将成功副作用标为未知失败。产品意图记录schemaHash与capabilityRevision。

- pipeline-regression.log：8文件49项通过，包含实际RPC嵌套hooks计数、工具陈旧写入、Durable桥接、故障恢复和主运行入口。
- pipeline-contracts.log：3项复核通过，额外断言真实产品参数只在产品prepare阶段转换，原始输入不被框架schema抢先转换。
- pipeline-typecheck.log、pipeline-build.log：通过。

## 模型服务

所有受记录attempt只派发一次请求，再次使用同一attempt会在网络之前拒绝。内置Responses、扩展adapter与通用模型服务统一只自动重试明确的429/502/503/504；未知网络结果不重发，原生Harness及SDK隐藏重试关闭。已有逐attempt原始body/hash、原始chunk与落盘背压继续保留。

新增测试暴露：产品取消需要等待原生任务异步取消才进入transport，导致完成事实落盘期间仍发布上下文。现将产品与原生取消信号直接合并，并在完成记录后检查取消。完成网络事实保留，内置和扩展Provider都不再发布迟到模型值或工具意图。原失败日志保留在model-policy-first-failure.log（39通过/1失败），没有删除或放宽断言。

- model-policy-runtime.log：2文件22项通过，覆盖单次派发、未知网络不重试、落盘期间取消、429独立attempt、原始items与工具配对、未知SSE、证据超限。
- model-policy-regression.log：5文件48项通过，覆盖扩展Provider落盘期间取消、原始流背压、分块密钥、上下文及租约失效取消。
- model-policy-typecheck.log、model-policy-build.log：通过。当前2.7共70项不同测试通过。

这里不宣称新模式协议、完整模型目录、Codemode或全部spec已完成。
