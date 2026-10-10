# SDK 执行服务与进程桥（7.2）

2026-10-07，macOS arm64 / Node.js 24.15.0，未提交工作树。文件 hash 见 services-manifest.json。

## 实现及场景

- 修复进程 RPC 异步上下文丢失：创建 ExtensionContext 时绑定各宿主服务的 AsyncLocalStorage 上下文，保留父调用取消信号和 Journal 所有权。覆盖 callTool、model、state、UI、contribute、followUp、reload 与 RPC 记录。
- 新增实际 Codemode → 扩展进程 → ctx.model 测试。脚本未等待的子调用被取消，捕获的模型 fetch 收到 abort；主运行 signal 未取消且正常完成，辅助调用关联父工具，迟到结果不进入主历史。
- 嵌套 SDK 工具调用共享操作预算。实际命令试图读取 200 次，预算内结果保留，耗尽后失败，后续模型请求零派发。
- hooks 按注册顺序执行 beforeRun、两个 beforeTool、两个 afterTool、afterRun；写入完成位于前后 hooks 之间。既有失败测试验证前置 hook 失败阻止写入，后置失败独立记录，不撤销已发生效果。
- 进程失败事实明确 captureScope=host-services-only、externalEffects=unknown。实际夹具先经宿主写入，再直接使用 Node 写入后退出；仅前者有工具 intent，不能声称捕获全部外部行为。
- 实际扩展命令使用同一 commandId 重复提交：重放同一收据，Journal 字节不变，仅一个工具 intent，工厂不重新加载。未知命令恢复和冲突输入仍拒绝重跑。
- 既有并发 RPC 祖先关联、独立模型 attempt、权限撤销、迟到调用拒绝、进程树清理及 Codemode 管线继续通过。

## 验证

services-first.log：父子取消修复后的 12 项进程测试通过。
services-regression.log：4 文件 34 项通过。
services-receipts.log：3 项回执测试通过，包含新增实际 SDK 命令；合计 35 项不同相关测试。
services-types.log、services-build.log：类型检查及构建退出码 0。
services-specs.log：严格规格 43 项通过；git diff --check 通过。

未使用真实模型或外部服务。测试仅证明本机环境；不代替 11 组全套及安装包验收。
