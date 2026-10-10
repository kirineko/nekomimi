# 6.2 MCP 发现策略与稳定身份验收

已接通 direct/deferred/codemode/hidden：连接基础见 demand-connection.md（历史部分完成快照）。本次增加每运行独立的 McpDiscovery 捕获、mcp_discover 和 mcp_call。发现按确切服务器 ID 获取有界工具页，返回固定 schema revision；调用要求先发现、版本一致、确切工具 ID、参数符合捕获 schema，并重新校验当前资源授权。codemode 策略拒绝非脚本调用，hidden 无发现和调用入口。发现不扩权，也不重新连接第二个 owner。

直接工具和按需工具统一使用服务器稳定 resource ID 与原始工具名的摘要生成 ID，显示名仅为前缀。规范化后的相同名字仍分离；其它服务器的工具 ID 不能借用当前服务器 revision 派发。SDK 工作流示例测试改为显式发现调用，避免拼接名字。

8 个文件 28 项测试通过：mcp-discovery、mcp-demand、pi-mcp-owner、customization-mcp、customization-mcp-content、customization-mcp-oauth、customization-workflow、codemode-partial-failure。包含真实 HTTP 中 deferred/codemode 脚本发现及调用、永久未就绪服务器不阻塞普通首轮、隐藏服务零初始化、显式等待超时/取消、名称规范化冲突准确路由、错误 schema/revision/服务器 ID 零调用、授权撤销、SDK 工作流与部分失败恢复。类型、构建、43 项严格规格和 diff 检查通过。

6.3 仍未完成：当前发现保存在运行内并记录 mcp.discovery；请求边界清单、列表变化的版本证据及受支持会话恢复尚需专门实现/验收。本次不据此宣称所有 MCP 新规格已完成。无真实外部账户或模型调用。
