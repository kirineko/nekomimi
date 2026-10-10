# 6.5 OAuth 身份与轮换取消验收

将发现、S256 授权 URL、code 交换、动态公开客户端注册和刷新迁移到固定 Pi MCP 的公开 OAuth API，保留宿主回调、精确端点限制、服务绑定、私有原子存储和跨客户端刷新锁。未采用自动认证重试。绑定键包括服务器 ID、URL、issuer、client、scope 和注册/回调配置。

回调 iss 出现时必须匹配 issuer，元数据要求时不能省略；错误回调不触发令牌交换。业务取消不打断已开始的刷新持久化，完成后检查取消并阻止业务派发。显式断开推进授权代次，旧代调用不得返回刷新凭证。刷新返回新令牌时仅保存新值，未返回时保留仍有效的原 refresh token；刷新未知/失败要求重新授权，不恢复旧值。

20 项相关测试通过：mcp-oauth-rotation、customization-mcp-oauth、customization-mcp、customization-mcp-content。新增本地轮换服务在响应前使旧 refresh token 失效，以 barrier 精确取消：轮换只一次，新令牌跨宿主重启保留，旧值不再落盘，取消工具零派发。另验证同 URL 双账户隔离、断开 A 不影响 B、错误 iss/state/issuer、过期回调、PKCE、公开注册和并发刷新。

真实宿主 MCP 调用后扫描 Journal 与全部附件，并启动本地 Web 读取浏览器管理 API，均不含测试 access/refresh 凭证。类型、构建、43 项严格规格与 diff 检查通过。只有本地服务和合成凭证，无真实账户授权。6.6 HTTP 断线和进程清理专项仍待完成。
