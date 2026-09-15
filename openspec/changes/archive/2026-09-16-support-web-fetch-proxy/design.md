## Context

Nekomimi 0.1.3 在 resolveTarget 之后创建固定 DNS 的 Undici Agent，未读取环境或系统代理。本机公开域名解析到 198.18.x.x，导致请求前拒绝。Deepy 复用浏览器式请求头，urllib 同时具备系统代理发现；相同出口中英文 LeetCode 的对照证明请求头并不能保证绕过网站挑战。

## Goals / Non-Goals

**Goals:** 无代理零配置、已启用代理自动可用；保持 Journal 权威、公开 Undici 接口和全部抓取限额；通用 HTTP 优化及准确诊断。

**Non-Goals:** 网站特化、全局 dispatcher 修改、模型/API 代理、浏览器自动化、PAC 脚本执行、SOCKS 协议。

## Decisions

1. 新增仅服务端的代理策略。NEKOMIMI_WEB_FETCH_PROXY=direct 强制直连，auto/未设置自动检测，HTTP(S) URL 显式覆盖。环境小写优先；HTTP 用 HTTP_PROXY/ALL_PROXY，HTTPS 用 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY。存在环境代理配置时不读取系统；NO_PROXY 可单独叠加系统绕过列表。每次调用创建配置快照，每跳按同一快照分流。
2. macOS 以 scutil --proxy 读取静态代理与 ExceptionsList；Windows 使用 PowerShell 读取当前用户 Internet Settings ProxyEnable/ProxyServer/ProxyOverride；Linux 只使用环境。检测限时 2 秒并支持取消。无启用代理保持直连；启用但无可用静态代理的 PAC/SOCKS 返回不支持；检测失败明确错误。只读，不修改系统或读取凭证库。仅开启自动发现而未提供静态代理或 PAC 地址时按无代理处理，避免 Windows 默认自动检测开关破坏无代理用户；本轮不执行 WPAD。
3. 路由在本机目标 DNS 之前决定。直连继续全部地址校验与 pinning；代理路径使用 Undici ProxyAgent CONNECT，保留原始 Host/TLS 证书校验，域名解析交给可信代理。拒绝本地 IP 字面量与 localhost/.localhost/.local/单标签名称，移除末尾点后判断。不能保证远端域名解析为公开 IP，此为启用可信代理的显式边界；不谎称与直连同等 SSRF 保证。
4. NO_PROXY 支持逗号/空白分隔、域名及子域、*.后缀、端口、IPv6 和 *；系统 <local> 表示单标签名。同源重定向逐跳复用路由判断。代理故障不回退直连。不采用全局 EnvHttpProxyAgent，避免 NO_PROXY 走到未固定 DNS 的 Agent，也避免影响其他调用。
5. 代理认证通过 ProxyAgent 仅发给代理。日志只记 mode/source，不记地址或账号；底层异常替换为固定错误分类，原始代理异常不进入 Journal。响应仍统一按原始 Content-Type 的 charset 解码再脱敏，展示用的脱敏头不得反向参与解码。HTML 实体解码后的文本先合并解析分块，再脱敏和 Markdown 转义；Journal 仅清理非可信文本值，保留固定协议字段和 artifact 身份。
6. 复用 Deepy 请求头基线（Chrome UA、Accept、Sec-Fetch-*），仍仅广告 gzip/deflate。cf-mitigated: challenge 为明确验证标记；保留响应正文证据后报错，普通 403 不泛化。已实现的 charset、压缩、正文优先及摘要回退保留并回归。
7. 使用可注入系统读取、路由与 transport 测试接口；现有自定义 FetchNetwork fixture 保持隔离，不意外读取本机代理。每跳 fetch.route 加入 Journal，fetch.finished 保留最终路由及 errorCode。卡片沿用已有错误显示和详情证据。

## Risks / Trade-offs

代理受用户信任且可能看见请求；远端 DNS 无法由客户端校验。macOS/Windows 检测格式需要确定性 fixture，Windows 实机未验证应记录。仅代理连通不代表网站必定返回正文。代理启停在下一次抓取重新检测；调用内配置不变。检测失败优先可见性，不静默改变用户出口。未知/不支持代理协议明确提示改用 HTTP(S)。
