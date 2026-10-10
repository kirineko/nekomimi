# 验证结果模型（7.4）

2026-10-07，macOS arm64 / Node.js 24.15.0，未提交工作树；hash 见 verification-manifest.json。

## 实现与门槛

- 统一 VerificationResult 明确 stage、status、hostIntegration、resourceId/revision 和 environment。静态检查绑定实际内容、TypeScript 版本及 SDK 类型依赖图摘要；运行阶段绑定宿主构建、Node、平台、架构与 SDK 版本。
- Lifecycle 当前证据要求版本、构建和执行环境一致；旧环境事实放入 previousEvidence，不能显示为当前通过。
- 模拟试验始终绑定实际资源版本，普通扩展不再漏报 revision。成功/失败/取消写入 trial.finished，失败对象携带 session 与 verification；只有回调、取消检查和宿主清理完成后才记录模拟成功。
- 新测试发现已有旧活动版本时，新候选试验被 ResourceAccess 误报 scope-changed。修复仅适用于显式 simulation、相同逻辑来源/类型/范围且当前启用的候选，继续复核当前授权及目录身份；生产判断不变。
- 实际无限循环候选在启动标记后被取消，失败事实为 cancelled，活动指针及旧宿主引用不变，旧命令继续可用。普通扩展模拟成功仍为 hostIntegration=not_run。
- 面板独立预览在 frame 构建及进程清理后记录通过，失败也记录确切版本和环境；不升级为真实宿主验收。
- 修正主题挂载自动伪报完整宿主通过：theme-verify 只记录 theme-stylesheet-mounted/observed，passed 不为 true。HTTP 测试确认局部客户端观察不能冒充完整交互或素材验收。
- 静态检查仍只使用编译器，不执行工厂；随包示例和静态副作用哨兵继续通过。

## 验证

verification-first.log：16 通过、1 失败（新候选未开始）；verification-cancel-diagnostic.log 定位实际 scope-changed，保留原始失败记录。
verification-regression.log：修复后 7 文件 30 项通过，含生产上下文/作用域回归。
verification-final.log：预览失败记录增强后 3 文件 10 项通过；合计 33 项不同相关测试。
verification-types.log、verification-build.log：类型/构建退出码 0。
verification-specs.log：严格规格 43 项通过；git diff --check 通过。

完整工作台交互及字体/图片浏览器验收仍由后续综合门槛验证；本项明确记录未验收，不把模拟或样式表挂载当作通过。
