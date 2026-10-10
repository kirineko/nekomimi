# 6.1 MCP transport 与认证边界迁移

依照批次 0 公开覆盖矩阵，安装固定依赖 @earendil-works/pi-mcp 1.0.4（ignore-scripts，官方 npm registry），将 McpConnection 的 client、stdio 和 Streamable HTTP transport 切换为 Pi 公开 API。

连接对象缓存 connect Promise，并发及重复连接共享一个 owner/初始化。宿主保留有界分页、重复身份/游标检查、官方公开协议 schema 验证和 URI template 适配；校验不替换原始返回 envelope。初始化结果及 tool 元数据保留，JSON-RPC 错误保留 code/message/data 并作为工具错误；网络中断仍保留 UNKNOWN，关闭连接且不重放工具。

stdio 禁止全量继承环境，保留此前官方 SDK 的基础环境白名单和显式凭证映射；stderr 独立有界、脱敏。HTTP 受控 fetch 限制响应体与重定向；宿主继续负责 credentialEnv、OAuth token 注入/撤销和凭证轮换预算，没有启用 Pi 自动认证重试或自动重放。OAuth 持久身份与轮换取消的进一步迁移/验收仍由 6.5 完成；本阶段不声称已交付全部 OAuth 新规格。

验证：pi-mcp-owner、customization-mcp、customization-mcp-content、customization-mcp-oauth、codemode-partial-failure 共 17 项通过，覆盖真实本地 stdio/HTTP 初始化/分页/通知/内容/取消、认证及部分失败恢复。新增 owner 测试确认并发 connect 仅一次初始化、两页工具、初始化扩展字段保留，以及带 code/data 的结构化协议错误。类型、构建、43 项严格规格、diff 检查通过；没有真实外部账户授权或模型调用。

未完成边界：6.2 发现策略和延迟连接、6.3 活动工具版本快照、6.4 内容生命周期、6.5 OAuth 新门槛、6.6 故障恢复仍保留未勾选。安装包及跨平台矩阵由第 11 组验收。
