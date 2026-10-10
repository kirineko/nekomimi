# 6.3 MCP 版本快照与恢复验收

McpDiscovery 首次发现将完整工具集合（含所有分页）、服务器身份/版本、配置 revision 与 schema 摘要保存到 Journal 的 mcp.discovery.snapshot 附件；模型收到的分页仍有界。运行内固定该快照，通知及远端列表变化不原地替换。

恢复只读取并核验 Journal 快照，未启用/hidden 或配置已变的服务器记录明确跳过原因，不创建连接。首次实际调用恢复工具前等待已授权连接就绪，核对服务器和 schema 的完整 revision；不符拒绝，必须显式 discover 采用当前版本。历史 snapshot 不能恢复授权，也不会触发业务工具。新运行不携带自动重试旧调用行为。

每次主请求准备记录 mcp.request.declarations：实际 MCP schema、activationRevision、已发现工具 ID/schemaHash 与其恢复验证状态。真实请求测试将附件 declared 逐字段与实际 HTTP 请求 tools 对照。服务器通知旧工具移除后，当前两次模型请求仍使用旧 string schema，原始 -32601/data 错误保留；运行结束的后续激活取得 number schema，下一运行采用新列表，未转发到另一个工具或重跑副作用。

27 项相关测试（8 文件）通过，包含完整分页恢复、恢复不连接、版本变更必须重新发现、活动快照不变、HTTP 列表通知、请求声明对应实际 bytes、停用服务后新宿主继续同会话零额外初始化/调用，以及 MCP 内容和工作流/部分失败回归。类型、构建、43 项严格规格和 diff 检查通过。没有真实外部服务或模型调用。6.4 内容生命周期及 6.5/6.6 的专门门槛仍待实施。
