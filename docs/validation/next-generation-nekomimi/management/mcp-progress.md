# 10.4 MCP 授权与诊断进展

MCP 独立页已接入全局和创造目标路由，创造导航提供文字入口。资源范围按目标隔离，展示连接加载状态、OAuth 状态、授权服务、发现/活动版本以及可展开的已保存目录与诊断。查看/刷新不执行远端发现、读取内容或工具调用。

开始和断开授权均需确认连接及配置摘要；服务端在发起 OAuth 发现前比较 hash，配置变化返回 409。OAuth 成功不自动启用连接。授权中以只读查询刷新状态，链接仅保留页面内存；刷新后不再次发起授权，可完成原页面或显式断开。凭证不进入浏览器管理数据或持久存储。

## 验证

- `npm run typecheck` / `npm run build` 退出 0：`mcp-page-types-final.log` / `mcp-page-build-final.log`。
- `npx playwright test test/browser/mcp-management.spec.ts test/browser/resource-management.spec.ts test/browser/candidate-management.spec.ts`：10 项通过，见 `mcp-page-browser-final.log`。新增 3 项真实本地浏览器 OAuth 测试覆盖取消零网络、显式回调、不自动启用、断开、刷新 pending 无重发、链接不持久化、配置变化在发现前拒绝、密钥不入页面及 360px。
- `npx vitest run test/customization-server.test.ts test/mcp-oauth-rotation.test.ts`：5 项通过，见 `mcp-page-unit.log`。
- `openspec validate --all --strict`：43 项通过，见 `mcp-page-spec.log`；`git diff --check` 通过。

测试使用本地 OAuth 夹具，没有真实外部账号或模型调用。环境 macOS arm64 / Node v24.15.0；源码快照及日志摘要见 `mcp-manifest.json`。本批没有失败检查。

10.4 仍未勾选，总进度 72/89；能力包、工作流、高级模型/面板等管理能力仍需迁移与综合验证。
