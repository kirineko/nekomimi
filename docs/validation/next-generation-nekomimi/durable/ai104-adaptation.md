# AI1.0.4分阶段适配

根依赖通过官方npm registry固定为1.0.4，Journal/SDK新格式任务2.1完成。公开Responses stream要求TranscriptContext，已通过normalizeContext转换；Provider最终body仍由产品Journal投影准备，54项runtime/context/provider/未知重试/取消/请求保真回归通过，类型检查通过。源码版本记录和安装日志为ai104-install.log、ai104-typecheck-current.log、ai104-tests.log。

此前升级阶段的旧Agent0.85.1曾保留，其嵌套AI0.85.1事件流有独立的私有队列类型。临时agent-transition只连接公开可迭代/result接口，不加载私有模块；它传入信号与声明，不导入旧Agent历史/诊断。该模块是分阶段编译/回归边界，不是Durable故障回退。2.2/2.3保持未完成；下一步以公开Harness、Models Provider及generation/tool hooks替换循环，删除过渡模块和Agent依赖。

Durable工具的公开replay枚举为safe/unsafe；生产桥必须使用unsafe并在开启scheduler前完成旧任务门禁，达到产品unknown不重跑政策。历史未类型化JS探针用never表达同意图，但它不是公开TS枚举；进入生产的桥不使用该字面量，后续安装包回归使用有效公开枚举再验收。


## 产品工具契约边界

`src/tool-contracts.ts` 定义产品工具、结果及 usage；context、核心工具、定制工具和受记录执行不再导入 AgentTool。`src/pi/tool-adapter.ts` 仅使用公开 ToolRegistration，固定 sequential 与 replay unsafe，转换结果 details 和控制字段。未知工具恢复仍必须通过显式恢复门禁。

真实 Harness 测试证明原生 execute checkpoint 与产品 tool.intent 均先于执行，产品 tool.completed 持久证据和原生结果均可查询。相关旧回归19项、Durable检查21项和类型检查通过，详见 tool-*.log。当时正式 runtime 仍使用过渡 Agent；本段不作为任务2.2/2.3完成或整套测试通过的证据。


## 正式 Harness 接入

`runtime.ts` 已调用 `pi/durable-loop.ts`，旧 Agent 依赖和过渡模块已删除。公开 Models Provider 接入受记录 stream，内置重试/压缩关闭；生成前置边界等待可靠的工具结果产品投影，afterTools 驱动产品轮数检查。原生 hooks.each 会报告并吞掉通知型钩子异常，产品因此显式保存失败并取消等待和后续网络派发。

原生提交观察为同步通知，产品观察尾队列在下一请求与运行终态前等待。取消加入原生 abort 收敛；Journal poison 时清理不再发起需读取损坏存储的 abort 事务。初始化前取消进入产品运行错误处理，不漏写终态。

38项运行/上下文/Provider与23项服务器/扩展失败回归通过；完整372项默认并发运行363通过9失败，原始日志保留。失败包含旧格式测试夹具、清理和表单短等待，已修复；其余超时通过2 workers全量复验判断。此时2.2已通过类型、构建和逐包公开exports检查，2.3尚未据此提前勾选。


完整复验结果：`harness-full-workers2.log` 为62文件372项全部通过，175.55秒；默认并发失败日志保留。正式入口增加原生 generation/tool 终态断言，`harness-native-runtime.log` 通过，证明产品执行实际进入 Harness。2.3完成，2.4–2.8仍待因果、恢复、统一管线和安装包验收；无真实模型调用。
