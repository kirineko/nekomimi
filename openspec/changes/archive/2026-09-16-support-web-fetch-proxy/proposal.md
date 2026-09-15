## Why

当前 web_fetch 强制本机 DNS 与直连，在用户启用 Fake-IP 代理时会拒绝公开网站；普通 HTTP 403 也无法区分网站验证页。需兼顾无代理用户的零配置体验和已有代理用户，并参考 Deepy 改善通用网页兼容性。

## What Changes

- 自动采用环境 HTTP(S) 代理，未配置时检测 macOS/Windows 已启用的系统静态代理；未启用代理保持直连。提供仅影响 web_fetch 的显式代理/直连覆盖。
- 路由选择先于 DNS 校验；直连保留公开地址固定连接，代理委托可信代理解析域名。支持 NO_PROXY，失败不自动回退直连。
- 使用 Deepy 风格浏览器请求头，保留编码、压缩、正文优先与摘要回退；通用识别明确的网站验证响应，保留失败证据。
- 增加脱敏的路由和错误分类；不做 LeetCode 特化、浏览器自动化、PAC 执行、SOCKS 传输或模型请求代理改造。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-fetch`: 可选代理路由、直连与代理信任边界、通用请求兼容及验证页错误。

## Impact

对应 spec.md 的工具能力与可观测性方向。修改 src/web-fetch.ts、src/web-fetch/network.ts，新增代理策略与平台检测模块；复用固定版本 Undici 公共接口，不增加依赖或改变模型参数。更新测试、README 与开发文档。代理模式无法在客户端核验代理远端 DNS 的最终地址，必须在规格中明确委托边界。
