# Pi MCP 公开覆盖矩阵

任务1.6完成：Pi MCP 1.0.4，macOS arm64，Node 22.19.0/24.15.0，各4项综合测试通过。命令见 `corrected-runs.json`，夹具为 `fixture.mjs` / `mcp.test.mjs`，最终日志为 `node*-corrected.log`。

| 能力 | 实测 | 采用边界 |
| --- | --- | --- |
| stdio/HTTP初始化、tools分页和结构化错误 | 两种真实本地transport通过 | 可复用transport/client，宿主保留权限/证据/工具身份 |
| resources/templates分页、read | 两种transport通过 | 可复用便利API；宿主增加总量/页数预算、URI策略 |
| prompts/list/get | 两种transport用公开request通过，保留角色和参数 | 无专用便利方法，保留产品协议封装，不需私有入口 |
| subscribe/unsubscribe及资源通知 | stdio通知、HTTP POST SSE通知通过 | 公开request/onNotification可用；宿主控制订阅生命周期与显式刷新 |
| cancel、协议错误、stdio stderr | 取消拒绝、-32601保留、stderr分离通过 | 取消不等于外部副作用撤销 |
| HTTP副作用请求断线 | drop请求仅一次，无POST重放 | GET长连接恢复及复杂断线仍需批次6回归 |
| OAuth state、PKCE、code交换、refresh轮换 | 实际本地callback/token端点通过 | 可复用公开API，不执行浏览器登录或真实账户授权 |
| issuer拒绝、同URL不同账户 | 恶意issuer拒绝；独立store隔离通过 | store作用域由宿主负责；不能仅以URL作为账户身份 |

## 保留现有 adapter 的部分

凭证落盘/服务与账户identity、轮换取消竞态、失效重授权、配置治理、授权门禁、原始证据和上下文选择仍保留产品适配。当前不批准整体替换现有 OAuth 逻辑；1.6的可行性覆盖不代替6.5中的持久凭证重启及业务取消时轮换验收。legacy HTTP+SSE、sampling、MCP tasks不在此版本独立client覆盖范围，不能默认为支持。

## 探针修正

首次 HTTP 断线计数错误地包含前一个已取消但迟到的 hang 请求，断言失败；原探针另存为 `mcp.initial.test.mjs`，原日志保留。修正后按工具名 drop 独立计数，不放宽禁止重发的条件，两种Node均通过。

未记录或使用真实密钥；测试token只在内存传输，无凭证持久化通过声明。通用request成功也不等于系统所有MCP场景已交付。
