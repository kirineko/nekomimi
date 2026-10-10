# 10.4 模型配置进展

本批为未提交工作树验证快照，任务 10.4 仍未完成；总进度 72/89。基线提交、文件摘要及日志见 `models-manifest.json`。

独立模型页已接入工作/创造及绑定目标路由。八类用途分别确认并以读取时的修订提交；冲突不自动重试。默认配置显示运行时实际模型与凭证可用性；同模型不同配置分别报告凭证，不能借用另一配置的可用状态。

新增自定义配置显式打开；保存前展示端点和可编辑请求路径。没有自定义 Provider 时显示空状态。每次编辑使用独立凭证引用，失败清除密钥并保留非敏感字段；凭证写入结果未知时必须重新输入，修订冲突需用户明确采用新修订。取消丢弃草稿；不持久化密钥到浏览器。

验证：
- `npm run typecheck`、`npm run build` 退出 0，见 `model-page-final-types.log` / `model-page-final-build.log`。
- `npx vitest run test/model-catalog.test.ts test/customization-provider.test.ts`：26 项通过，见 `model-page-unit.log`。其后仅有前端及浏览器测试调整，后端未修改。
- `npx playwright test test/browser/model-settings.spec.ts test/browser/v2-workbench.spec.ts`：15 项通过，见 `model-page-final-browser.log`。覆盖用途隔离、取消、版本冲突、凭证清理/错误脱敏、空目录、刷新、焦点及窄屏。
- `openspec validate --all --strict`：43 项通过，见 `model-page-spec.log`；`git diff --check` 通过。

环境：macOS arm64 / Node v24.15.0；未调用真实模型。能力、权限、候选、能力包及其他管理入口仍需整合；以上结果不代表完整 10.4 或最终跨平台验收。
