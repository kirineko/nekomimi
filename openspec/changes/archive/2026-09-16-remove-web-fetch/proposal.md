## Why

实际使用中 web_fetch 失败率过高，抓取兼容与代理配置增加维护成本。用户决定移除该工具及专属依赖，保留网页搜索与既有历史证据。

## What Changes

- **BREAKING** 删除 web_fetch 工具注册、提示词、服务端选项及抓取/解析/代理实现。
- 删除仅用于抓取的直接依赖 htmlparser2、ipaddr.js、undici 及无其他引用的传递依赖。
- 移除当前文档中的抓取与代理使用说明，更新浏览器及安装包验收。
- 保留历史 fetch 事件、状态、来源与 artifact 的只读展示和导出导入，不修改已发布记录。
- 非目标：不新增替代抓取工具，不调整 web_search 或模型网络连接，不修改系统代理。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-fetch`：退役整个主动抓取能力。
- `core-tools`：当前工具集不提供 web_fetch；历史调用仍可读取。

## Impact

涉及 src/tools.ts、src/web-fetch*、package.json/lockfile、当前 README/开发指南、抓取专属测试与安装包 fixture。与 spec.md 的基础工具和可观测历史章节相关；历史投影与只读展示保留。
