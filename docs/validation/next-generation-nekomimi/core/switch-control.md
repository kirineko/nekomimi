# 托管 Core 切换（任务 8.5）

## 实现范围

`src/core/switches.ts` 生成包含实际当前宿主、候选构建与产物、验证 ID、协议和数据/工作目录影响范围的确认计划。接受切换前取得构建/验证 Journal writer，关闭业务准入并重新核对计划。确认内容变化拒绝；重复 commandId 返回原收据；已接受无终态为 unknown，不自动再执行。

`managed.ts` 持有安装租约，以实际运行子进程身份检查下一候选。`managed-child.ts` 与 `managed-worker.ts` 使用 IPC 传递控制和稳定浏览器令牌，停止旧进程后在同端口启动目标。目标先带业务 fence 启动，经身份/健康核验并记录 selected 后释放；令牌不进入 argv/Journal。跨版本 ApiError 使用候选自己的构造器还原，保留 HTTP 409 及错误码。

隔离验证增加 `core-switch-control` 检查：真实 POST 在初始 fence 下拒绝，控制回调通过 HTTP 可达。缺少该通过记录的目标不能切换。前端顶部只读展示实际服务的完整构建摘要；连接失败隐藏缓存身份，显示待确认。完整候选确认页面归任务 10.8，故障回退和重启恢复归 8.6。

## 验证

- `switch-control-unit.log`：6 文件 30 项通过，覆盖确认/幂等、实际 writer 保留、IPC 状态码、两个真实子进程同端口启动、初始写入 fence、令牌脱敏及隔离验证。切换状态机部分使用模拟 runtime，不能单独充当完整切换证据。
- `switch-control-regression.log`：3 文件 35 项通过，覆盖服务、工作/创造独立运行和 Durable 工作流。
- `switch-control-browser.log`：2 项通过，实际普通服务身份与手动启动诊断；模拟托管状态切换、断连及恢复时的展示。模拟项不冒充真实进程替换。
- `switch-control-types.log`、`switch-control-build.log`：类型和构建通过。
- `switch-control-specs.log`：43 项严格规格检查通过。
- `switch-control-source.log`、`switch-control-receipt.json`：完整真实双构建验收退出码 0；从 `3fe4ef6d82800c94cfcdb76051e03d5477f463e0dcef4dc335563005119a91aa` 切换到 `1414cc8c511113321337e23e220ee3e4073460d658137c7fae9ce00e66a32a55`，重复确认没有额外 process.started，浏览器完整摘要与实际 status/收据一致。`switch-control-workbench.png` 已人工检查。
- `switch-control-first-build.json` 保存第一代构建/验证；第二代完整证据在 switch-control-receipt.json。`switch-control-cleanup.json` 保存父进程正常退出、端口关闭结果，其中 identity 是初始启动身份，切换后的实际身份以切换收据及浏览器证据为准。

任务 8.5 已完成，整体进度 69/89。

之前的双层门禁与 46 项回归见 `switch-gates.md`。此次未执行真实模型、未改动活动安装、未提交或发布。测试环境为 macOS arm64 / Node.js 24.15.0，不能据此宣称 Linux、Windows 或最低 Node 通过。
