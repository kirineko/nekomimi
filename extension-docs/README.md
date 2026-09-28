# Nekomimi SDK

一个开发入口，覆盖扩展运行时、上下文、模型、工作流、能力包与界面。先使用 `customization_sdk({entry:"public"})` 获取安装版本的完整类型；`entry:"ui"` 查看主题和视图契约。查询结果中的支持能力不等于当前资源授权，新增权限需用户明确授权。

## 从目标开始

| 目标 | 文档与完整示例 | 主要权限 |
| --- | --- | --- |
| 新增命令、工具、钩子、运行状态 | [扩展基础](extensions.md)、[example.ts](example.ts) | commands/tools/hooks/state/ui |
| 加载 Skill、分层规则与 MCP | [上下文定制](skills-rules-mcp.md)、[平台指南](platform.md) | 各资源授权 |
| 接入模型和辅助调用 | [平台指南](platform.md)、[http-providers.ts](http-providers.ts) | providers/model |
| 持久等待、恢复、工作区状态 | [平台指南](platform.md)、[durable-review.ts](durable-review.ts) | workflows/workspace-state |
| 修改整体风格和运行时区域 | [运行时 UI](runtime-ui.md)、[樱花组合包](examples/sakura/README.md) | themes/views 及具体桥接权限 |
| 展示面板和工具结果 | [运行时 UI](runtime-ui.md)、[panel-extension.ts](panel-extension.ts)、[review-panel.ts](review-panel.ts) | panels/ui |
| 打包、精确锁定、激活与回退 | [平台指南](platform.md) | 按包清单逐项授权 |
| 验证、排错与验收 | [调试指南](validation.md) | 模拟/预览不代替激活授权 |

## 开发路径

1. 读取契约与相关完整示例，使用 `customization_candidate` 创建候选或在工作区创建扩展；不修改安装目录。
2. 声明所需能力，运行完整类型和清单校验，修复后重新校验内容摘要。
3. 按需模拟试验和独立 UI 预览；报告这些阶段的实际边界。
4. 用户授权后激活，运行真实宿主入口；记录效果、交互、取消与回退结果。
5. 需要分享时使用精确版本能力包；回退保留历史和状态兼容检查。

默认类型为 `ExtensionAPI` / `ExtensionFactory`。旧类型后缀与旧清单继续由兼容层处理，不能绕过新能力授权。sdk/package/rpc/ui 的协议数字独立演进，不需要按 V1/V2 选择不同开发指南。

工厂仅注册定义；所有模型调用使用 ctx.model 或 Provider 宿主入口，所有受管执行保留证据。Journal 是权威历史，UI 内容和模型投影不是原始证据。可信 Node 扩展直接调用文件或网络 API 不保证被宿主记录。

- [定制交付全流程](customization-lifecycle.md)：当前宿主诊断、已有扩展新增权限、字体图片、预览应用与来源管理。

- [项目级与用户级定制](scopes.md)：默认值、实际路径、授权和跨项目交付。

- [上下文占用、自动/手动整理及 Provider 边界](context.md)

## 模型按需开发入口

先调用 `customization_sdk()` 查看当前安装版目录，再用 `entry: "guide:README.md"` 读取本页。按目标读取所需指南，不必一次加载所有示例。文档中的相对引用相对当前文档目录解析，例如 README 引用 `extensions.md` 对应 `guide:extensions.md`；示例也通过相同受限入口读取，无需访问任意安装路径。

- 简单 Skill、Rule 或资源修订：使用 `resource_write`，技能/规则遵守适用路径，参见 [上下文指南](skills-rules-mcp.md)。
- 项目内隔离开发：使用 `customization_candidate`，读取 SDK 类型和对应示例，再校验确切内容 hash。
- 分享、版本管理及跨项目能力：使用 `customization_package` 或受支持的用户级 `resource_write`。默认项目级；用户明确要求跨项目时使用用户级，写目录和运行代码的授权仍分开。
- 二次元风格：先读 [运行时 UI](runtime-ui.md) 和 [樱花示例](examples/sakura/README.md)，分别考虑字体、配色、间距、气泡、动效及运行区域。需要全局风格时不能仅交付一个结构化面板。
- 工具调用及恢复：[工具提示契约](tool-prompts.md)。

交付时调用 `customization_status({resourceId})` 检查实际阶段。报告可见效果、入口和必要下一步，详细版本/hash/JSON 留在证据中。静态通过、模拟预览、已加载与已应用是不同证据；pending 重载需当前运行结束后才能处理，不能等待自己的结束并提前声称成功。取消或结果未知先检查状态，重开历史不应重新激活。
