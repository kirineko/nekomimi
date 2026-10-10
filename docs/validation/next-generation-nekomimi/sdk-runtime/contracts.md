# SDK 3 契约与准入（7.1）

2026-10-07，macOS arm64 / Node.js 24.15.0，未提交工作树；文件 hash 见 contracts-manifest.json。

## 实现与证据

- 公开入口 nekomimi/extensions 提供当前 SDK 3 工具、命令、四类运行/工具 hooks、清理、Provider、工作流、状态和 UI 类型。
- 新增只读 SDK_MODES、SDK_PROTOCOLS 及 SdkMode；冻结 CAPABILITIES，目录与公开常量共用定义。SDK 查询公开支持模式、协议及能力判定规则，明确 supported 不等于 granted，更不等于当前 executable。public 查询包含能力声明，支持单独 capabilities 查询。
- 旧 SDK 1/2 与未来能力在模块导入前拒绝，不执行顶层副作用、不写授权、不改写资源；旧版本诊断提供当前版本与安装包 SDK 资料入口。
- 所有随包 TypeScript 示例统一静态类型检查通过，覆盖工具、命令、hooks、Provider、工作流、状态、主题、面板及运行时 UI。静态结果明确 hostIntegration=not_run，未执行示例工厂。
- TypeScript compiler 实际解析公开入口的完整类型依赖图，不含 @earendil-works 包、Pi 或 runtime/journal/provider 实现；扩展无需框架私有类型。
- 既有进程回归确认重复注册不替换活动版本；模式回归确认服务端过滤及嵌套调用门禁继续有效。

## 验证

contracts-first.log：4 文件 14 项通过。contracts-regression.log：最终 6 文件 47 项通过。
contracts-types.log、contracts-build.log：类型检查、构建退出码 0。
contracts-specs.log：严格规格 43 项通过；git diff --check 通过。

本项不代替 7.2 的完整 SDK 执行服务验证，也不代替 7.7 的无源码安装包开发闭环。
