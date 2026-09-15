## Context

web_fetch 独立注册于 CoreTools，抓取、解析和代理逻辑位于 src/web-fetch.ts 与同名目录。htmlparser2、ipaddr.js、undici 的直接引用仅来自该模块。历史投影、ToolCard 和导出从 Journal 已保存字段读取，不依赖抓取执行代码。

## Goals / Non-Goals

**Goals:** 删除执行路径和专属依赖，当前工具指导与文档一致，历史证据继续只读可用。

**Non-Goals:** 不新增替代抓取方案，不调整搜索与模型传输，不清理用户历史、修改系统代理或重写历史发布记录。

## Decisions

1. 删除工具定义、WebFetchOptions 和执行模块，保留历史 fetch.finished 投影及只读摘要展示。旧模型调用按现有未知工具处理。
2. 移除三项直接依赖并更新 lockfile；被其他依赖需要的传递包保留。构建先清理 dist，防止旧抓取模块在源码删除后仍被打包；安装包断言不含抓取资源。
3. 用工具集/实际模型请求检查、旧 Journal 导出导入回归替代执行测试。浏览器保留 favicon 与搜索闭环检查；安装包 fixture 验证当前工具定义没有 web_fetch。
4. 主规格退役留待本 change 归档时同步；历史归档与版本记录继续描述当时行为，当前文档移除抓取代理教程。

## Risks / Trade-offs

移除工具及服务端选项对依赖这些接口的调用方不兼容；旧会话可以读取证据，但无法重新执行抓取。保留的历史展示只是只读兼容，不包含任何抓取或代理依赖。
