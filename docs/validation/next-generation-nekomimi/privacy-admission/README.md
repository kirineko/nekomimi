# 11.5 旧目录与敏感数据保护

2026-10-09，macOS arm64 / Node 24.15.0，未提交工作树；全部模型调用使用本地 fixture。

## 修复

项目交付独立回执日志现在在只读查询和取得写入租约后均检查格式；不支持的版本在写入意图或执行工厂之前拒绝。交付入口传入默认和 Provider 凭证，异常回执在返回客户端、持久化及同命令重读时脱敏。已知 intent 缺少终态仍返回 unknown，不自动重跑。

## 验证

| 范围 | 结果与直接断言 |
| --- | --- |
| project-delivery、data-format、sdk-admission、local-experience、server、journal | 6 文件 48/48 通过；旧会话/候选恢复树摘要和旧配置字节不变，SDK 1/2 在工厂前拒绝，未来交付日志格式拒绝，交付错误 HTTP 与回执无默认及 Provider 凭证，未知结果不重跑 |
| runtime、customization-panels、customization-server、review-regressions、durable-model-service、durable-journal-storage | 6 文件 49/49 通过；导入/导出不增加模型请求、不改变源 Journal；资源删除后仍可离线恢复证据；HTML 无可执行面板代码；跨分片凭证、shell 两通道、响应及 Durable Journal 脱敏 |
| local-experience、v2-content-files、project-delivery 浏览器 | 5/5 通过；配置与双窗口、离线导出无密钥或外部网络、历史不会自动挂载面板、完整/脱敏包保留 Journal 且无宿主归档元数据、安装二次授权与丢失响应去重 |
| 类型检查 / 构建 / 严格规格 | 均退出 0；严格规格 43/43 |

首组命令误列不存在的 test/export.test.ts；Vitest 实际仅运行表中 6 个文件，不将不存在文件计作通过。第二组覆盖真正的导入/导出测试入口。

11.5 已完成，整体 84/89。上述结果针对固定夹具和已知凭证，不宣称能识别任意未知敏感文本。构建的约 660 kB 分块告警仍由 11.1/11.6 处理。11.4 的双 Node 安装证据早于本次交付回执修复；最终产物必须再验，未回写旧 manifest。未调用真实模型、未发布或归档。
