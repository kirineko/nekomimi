# 10.2 后台模拟与预览验收

2026-10-08，macOS arm64 / Node 24.15.0；未提交工作树，基线 HEAD be50c5a8a1557ef160056b964cd29e65b395685d。

## 实现

静态校验、模拟和面板预览共用 validation-tasks Journal 接受、取消与结果收据。任务绑定 commandId、阶段、会话、目标、候选内容、宿主构建及输入摘要；相同命令不重复运行，改变输入拒绝，无可靠终态显示 unknown。模拟与面板证据回链任务和会话。60 秒预算及取消覆盖工厂启动，实际清理确认后才记录取消。

页面提供模拟命令/模拟模型回复、独立授权、后台预览及运行中取消。导航只查询原任务，迟到接受回执不会挂载面板。只有当前明确请求可打开准备好的预览；返回页面需重新授权打开已完成实例。关闭或服务重启后读取实例返回过期，不重跑工厂。nonce 仅存内存，不写任务 Journal。目标目录移动后，错误页仍提供所属会话任务查询与停止；收尾不会重建旧开发目录。

## 当前验证

- npm run typecheck：退出 0；npm run build：退出 0。
- npx vitest run test/candidate-executions.test.ts test/validation-tasks.test.ts test/customization-validation-cancel.test.ts：3 文件 15 项通过，退出 0。
- npx playwright test test/browser/create-candidates.spec.ts test/browser/core-candidate.spec.ts：11 项通过，退出 0。
- openspec validate --all --strict：43 项通过，退出 0；git diff --check 通过。

单元覆盖实际模拟输出与因果链接、命令重复/输入冲突、预览复用/关闭/服务重新打开、真实卡住工厂 PID 清理、目录移动后取消、遗留意图 unknown 不重跑及认证/跨 Origin 拒绝。首次新增 HTTP 测试漏写同源 Origin 返回 403，修正测试请求后通过；保留初次失败日志，未修改认证策略。

浏览器覆盖明确授权、差异与阶段、静态后台任务、360px、加载/错误、迟到接受回执、模拟持久结果、移动目标后停止实际工厂、非法 JSON 不派发、关闭预览后过期诊断，以及核心候选只读/实际构建取消/编译隔离探测三项回归。核心隔离探测的产物准入 fixture 边界沿用 core-operations.md，不声称真实模型质量通过。

## 10.2 完成映射

目标导航/扩展只读差异/静态任务：progress.md；核心差异及保存日志：core-readonly.md；核心后台操作：core-operations.md；扩展启动清理：extension-cancellation.md；持久模拟/预览及最终 UI 回归：本文。已覆盖 10.2 的阶段、空/加载/失败、显式预览、取消与导航不重跑要求。

本记录不替代 10.3–10.9 的交接/管理/整体 UI 或第 11 组全量、包与多平台门槛；未调用真实模型，未提交、归档或发布。
