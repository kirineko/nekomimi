# V2 规格场景与验收入口

日期：2026-09-22。以下映射指向实际执行的测试或交付入口；Linux、Windows 按用户 2026-09-22 指令延期，平台门槛单独列为待完成，不能从 macOS 结果推断其他平台。该 change 已按用户后续归档发版指令归档；跨平台结果由发布记录接续。

## custom-model-providers

验证入口：[test/customization-provider.test.ts](../test/customization-provider.test.ts)、[test/browser/customization.spec.ts](../test/browser/customization.spec.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 添加自定义 Provider | macOS 实测通过 |
| 模型不支持图片或工具 | macOS 实测通过 |
| 配置自定义端点 | macOS 实测通过 |
| 不兼容会话切换 | macOS 实测通过 |
| 无账户测试 Provider | macOS 实测通过 |

## custom-web-panels

验证入口：[test/customization-panels.test.ts](../test/customization-panels.test.ts)、[test/browser/customization.spec.ts](../test/browser/customization.spec.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 创建审查面板 | macOS 实测通过 |
| 组件尝试越权 | macOS 实测通过 |
| 两个窗口同时确认 | macOS 实测通过 |
| 卸载后导出 | macOS 实测通过 |

## customization-development

验证入口：[test/customization-validation.test.ts](../test/customization-validation.test.ts)、[test/customization-candidates.test.ts](../test/customization-candidates.test.ts)、[test/customization-candidate-trial.test.ts](../test/customization-candidate-trial.test.ts)、[test/browser/customization.spec.ts](../test/browser/customization.spec.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 从需求创建定制 | macOS 实测通过 |
| 错误代码修复 | macOS 实测通过 |
| 模拟不冒充真实 | macOS 实测通过 |
| 校验后又被改写 | macOS 实测通过 |
| 回退有状态扩展 | macOS 实测通过 |
| 扩展权限变化 | macOS 实测通过 |

## customization-packages

验证入口：[test/customization-packages.test.ts](../test/customization-packages.test.ts)、[test/customization-package-source.test.ts](../test/customization-package-source.test.ts)、[test/customization-v2-composite.test.ts](../test/customization-v2-composite.test.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 安装带规则的能力包 | macOS 实测通过 |
| 浮动来源变化 | macOS 实测通过 |
| 恶意包内容 | macOS 实测通过 |
| 更新中途失败 | macOS 实测通过 |
| 导出后在另一项目使用 | macOS 实测通过 |

## customization-release-readiness

验证入口：[test/customization-v2-composite.test.ts](../test/customization-v2-composite.test.ts)、[scripts/customization-v2-live-smoke.mjs](../scripts/customization-v2-live-smoke.mjs)、[scripts/pack-smoke.mjs](../scripts/pack-smoke.mjs)、[.github/workflows/ci.yml](../.github/workflows/ci.yml)

| 规格场景 | 验收状态 |
| --- | --- |
| 完整审查能力包 | 本地组合与真实演练通过；跨平台候选门槛待完成 |
| 旧项目升级 | 本地组合与真实演练通过；跨平台候选门槛待完成 |
| 模型生成候选失败 | 本地组合与真实演练通过；跨平台候选门槛待完成 |
| 离线账户独立安装验收 | 本地组合与真实演练通过；跨平台候选门槛待完成 |
| 候选完成但未上传 | 本地组合与真实演练通过；跨平台候选门槛待完成 |

## durable-custom-workflows

验证入口：[test/customization-durable-workflows.test.ts](../test/customization-durable-workflows.test.ts)、[test/customization-v2-composite.test.ts](../test/customization-v2-composite.test.ts)、[test/browser/customization.spec.ts](../test/browser/customization.spec.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 完成步骤后重启 | macOS 实测通过 |
| 效果发生后响应丢失 | macOS 实测通过 |
| 服务重启后回答 | macOS 实测通过 |
| 触发递归与重复通知 | macOS 实测通过 |
| 暂停期间升级 | macOS 实测通过 |

## extension-process-host

验证入口：[test/customization-process.test.ts](../test/customization-process.test.ts)、[test/customization-rpc.test.ts](../test/customization-rpc.test.ts)、[test/customization-failures.test.ts](../test/customization-failures.test.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 旧扩展升级运行 | macOS 通过；Windows/Linux 原生进程清理门槛待完成 |
| 旧进程迟到响应 | macOS 通过；Windows/Linux 原生进程清理门槛待完成 |
| 扩展无限循环 | macOS 通过；Windows/Linux 原生进程清理门槛待完成 |
| 候选重复注册 | macOS 通过；Windows/Linux 原生进程清理门槛待完成 |

## local-user-configuration

验证入口：[test/local-experience.test.ts](../test/local-experience.test.ts)、[test/customization-provider.test.ts](../test/customization-provider.test.ts)、[test/browser/customization.spec.ts](../test/browser/customization.spec.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 仅环境变量中存在凭证 | macOS 实测通过 |
| 配置损坏 | macOS 实测通过 |
| 保存并重启 | macOS 实测通过 |
| 运行中替换或清除凭证 | macOS 实测通过 |
| 旧配置升级到多 Provider | macOS 实测通过 |
| Web 修改模型与端点 | macOS 实测通过 |

## mcp-context-and-auth

验证入口：[test/customization-mcp-content.test.ts](../test/customization-mcp-content.test.ts)、[test/customization-mcp-oauth.test.ts](../test/customization-mcp-oauth.test.ts)、[test/browser/customization.spec.ts](../test/browser/customization.spec.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 显式读取远端资源 | macOS 实测通过 |
| 远端提示请求越权 | macOS 实测通过 |
| 资源连续变更 | macOS 实测通过 |
| 刷新与重启 | macOS 实测通过 |
| 恶意回调或发现 | macOS 实测通过 |

## model-call-evidence

验证入口：[test/provider.test.ts](../test/provider.test.ts)、[test/customization-provider.test.ts](../test/customization-provider.test.ts)、[test/customization-v2-composite.test.ts](../test/customization-v2-composite.test.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 最终请求保真验收 | macOS 实测通过 |
| 工具内模型调用 | macOS 实测通过 |
| 扩展辅助调用重试和取消 | macOS 实测通过 |
| 自定义 Provider 请求 | macOS 实测通过 |
| Thinking 请求使用项目指令和工具 | macOS 实测通过 |
| 不支持的能力组合 | macOS 实测通过 |

## prompt-context-provenance

验证入口：[test/context.test.ts](../test/context.test.ts)、[test/customization-rules.test.ts](../test/customization-rules.test.ts)、[test/customization-mcp-content.test.ts](../test/customization-mcp-content.test.ts)、[test/customization-v2-composite.test.ts](../test/customization-v2-composite.test.ts)

| 规格场景 | 验收状态 |
| --- | --- |
| 按工具贡献提示验收 | macOS 实测通过 |
| 扩展版本切换 | macOS 实测通过 |
| 上下文追溯验收 | macOS 实测通过 |
| 规则和技能更新 | macOS 实测通过 |
| MCP 提示与工作流输入 | macOS 实测通过 |
| 更新后的指导撤销 | macOS 实测通过 |
