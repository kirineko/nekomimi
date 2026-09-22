# V2 本地候选验收记录

2026-09-22，`deliver-customization-v2` 已交付 **0.2.0 macOS 本地候选**。用户明确“暂不验证 Linux、Windows”；这两类原生验收及依赖它们的全平台候选核验、最终归档保留待办，不计为通过。本地验收结束时 OpenSpec 任务为 52/55，尚未执行公开发布。随后用户明确要求归档并发布 0.2.0；归档保留当时未完成标记，发布与平台结果另见 [0.2.0 发布记录](releases/0.2.0.md)。

## 交付物

- [安装包](../artifacts/nekomimi-0.2.0.tgz)：532275 bytes。
- [候选元数据](../artifacts/candidate.json)及[源码内容清单](../artifacts/source-manifest.json)。源码以工作区内容摘要标识，包含未提交修改，不冒充已提交版本。
- [SDK 2 使用说明](../extension-docs/v2.md)、[迁移说明](customization-v2-migration.md)、[十一份规格场景映射](customization-v2-scenarios.md)。
- [真实模型演练报告和生成代码](../artifacts/v2-live/report.json)。原始 Journal 位于报告记录的临时合成工作区；报告和生成代码已复制到项目 artifacts。

```text
sha256: 41f658ade40b7024d56b2508e3cc25efb1a6868c72d7183579bf5ceb14caf015
integrity: sha512-pxqKHnspDc593tW+eXKzCOusaz41qxyI7dilbLPpOz4wSei9jmiCGpgSxULfqDU13rwN8EQAfdGgZJdqHt5YIA==
源码基线提交: 2e20c4beda4f2fd74057619712389f0607a5b089（工作区有未提交修改）
源码清单 sha256: 3888d8f3010d2ee25972575b8cd219a4285705716ab319539655441da98dad4f
```

官方 registry 的 `nekomimi@0.2.0` 查询于本日返回 E404。此结果只用于候选版本选择；正式发布前仍需重新查询。npm 查询与安装显式使用 `https://registry.npmjs.org`。

本地安装：`npm install --global --registry=https://registry.npmjs.org ./artifacts/nekomimi-0.2.0.tgz`。这里只提供安装命令，未将候选安装到用户默认全局目录；全局安装验收使用临时 prefix。

## 实现与组合闭环

| 能力 | 实际证据 |
| --- | --- |
| 对话开发 | SDK 查询、文件生成、语义类型诊断、修复、候选 hash 校验、独立模拟试验、显式激活、回退 |
| 命令和工具 | 独立 Node 进程，SDK 1/2 兼容，RPC 身份/授权/预算，宿主意图与实际效果记录 |
| 能力包 | 本地/npm/Git、固定版本和依赖锁、无 lifecycle scripts、Rule 目标绑定、升级/分享/卸载/引用保留 |
| Provider | Responses/Chat JSON/SSE、任意 JSON 协议 adapter、逐 attempt 记录、主/辅助/命名配置、凭证隔离、显式历史分支 |
| MCP | tools/resources/templates/prompts、分页和内容预算、固定快照、订阅、公开 SDK OAuth/DCR/PKCE/刷新/断开 |
| 工作流 | 独立 Journal、固定定义、持久等待、重启回答、unknown 核对、CAS 状态/outbox、触发去重与因果预算 |
| UI | TS/TSX 和锁定 React 依赖构建、激活前预览、侧栏/结果插槽、主题、iframe/CSP/MessageChannel、幂等回答、离线回退 |

确定性 `/review` 包从模型工具生成文件并修复错误，实际读取合成 Git diff，载入 Skill 和目标 Rules，调用 OAuth MCP resource/prompt 与自定义 Provider，保存审查面板并等待回答。验证了服务重启、挂起期间升级/回退、构建失败保留旧锁、第二工作区重新绑定并实际使用、卸载阻止挂起流程推进、历史和 revision 保留。

安装包验收从 tarball 安装后的公共 SDK 与随包文档生成完整审查包，在临时全局安装中启动 Web，并验证本地 OAuth、上下文组合、工作流重启、面板桥接回答和完成结果。两种 Node 使用**同一份上述 tarball**；未借用源码中的运行时实现。

## 检查结果

| 检查 | macOS arm64 / Node 22.19.0 | macOS arm64 / Node 24.15.0 |
| --- | --- | --- |
| 单元/集成回归 | 38 文件、219 项通过 | 38 文件、219 项通过 |
| 全量真实浏览器 | 未单独重跑；安装包 Web 冒烟通过 | 22 项通过（已安装 Chrome） |
| 同一包本地/临时全局安装及完整审查闭环 | 通过 | 通过 |
| SDK/TSX/pi/MCP OAuth 兼容探针 | 通过 | 通过 |
| 类型检查 | 共用最终源码类型检查通过 | 通过 |

`npm run test:release` 7 项通过；`openspec validate --all --strict` 24 项通过；`git diff --check` 通过。末次 Git 失败退出清理调整后，包来源的 6 项测试及最终 tarball 安装另做针对性复验。安装包不含凭证、会话、源码 checkout 或开发测试目录。

V1 基线在实施前复验：132 项、类型检查和严格规格校验通过，六份新主规格及两份修改已同步，保留原场景，并归档到 `2026-09-22-enable-user-customization-mvp`。V2 的全量回归包含 V1 SDK、配置、状态、表单、MCP 和历史用例。

## 故障矩阵

| 故障 | 验收入口与结果 |
| --- | --- |
| 死循环、拒绝 SIGTERM 的子孙进程、执行后崩溃、迟到 RPC、日志洪泛 | process/rpc/failures 测试通过；macOS 确认进程树退出，unknown 不重发，清理失败阻断后续运行 |
| 磁盘失败、慢 Journal、跨 Journal 崩溃 | diagnostics/rpc/durable-workflows 测试通过；意图先持久化、ACK 有界、元数据补投不重做效果 |
| 依赖篡改、路径/链接越界、压缩膨胀、Git 历史对象库超限 | package-source/packages 测试通过；不执行 hooks/scripts，固定旧锁，临时内容清理 |
| 候选检查后变更、更新中断、构建失败 | candidates/composite/panels 测试通过；失败不替换旧版本，类型检查不执行工厂 |
| MCP 断线、OAuth 失效/恶意端点、parser 错误/取消、撤销凭证 | MCP/Provider 测试通过；不自动重跑未知副作用，不跨重定向转发密钥 |
| UI 越权、伪造 nonce、超限消息、跨窗口冲突、取消后旧请求 | 浏览器通过；宿主 DOM/cookie、网络/导航隔离，权威状态与幂等回答，保留宿主关闭/取消入口 |
| 状态/schema 不兼容、挂起时升级/卸载 | 工作流与组合测试通过；原定义和状态保留，显式迁移，撤权后阻断新调用 |
| 删除组件、离线导出/导入、缺少 props artifact | 面板测试通过；fallback 和结构化内容仍可读，离线无组件脚本/下载，缺失附件报错 |

## 真实模型演练

模型为本机配置的 `deepseek-flash`；只使用临时合成工作区。真实生成/修复共 **22 个 attempt、4 次成功运行、累计 50.113 秒**，不含人工排查和本地验收等待。

| 阶段 | attempts | 模型运行时间 |
| --- | --- | --- |
| 五类能力生成 | 12 | 35.397 秒 |
| 注入类型错误后修复 | 4 | 5.528 秒 |
| 实际注册 schema 诊断后修复 | 3 | 5.033 秒 |
| 工具全名诊断后修复 | 3 | 4.155 秒 |

实际通过：生成命令调用生成工具读取文件、生成 Provider 的请求/解析、生成工作流暂停与重启回答、生成浏览器面板筛选。

失败归因保留：模型曾读取尚不存在的 panel.ts，产生一次记录的工具错误后继续创建。类型错误是验收明确注入；初始提示错误地指定空工具 schema 和过短工具名，这两处由真实模型根据实际诊断修复，**不能算作无偏的自然生成失败率**。演练脚本还修复了初始文件缺失、重新加载/工具白名单、浏览器选择和等待条件问题，详见报告；没有隐藏为首次全成功。

生成和修复使用真实模型；生成的 Provider 以合成 JSON transport 响应验收。OAuth/MCP 与确定性组合均为本地 fixture，不宣称第三方供应商账户或认证实测成功。凭证未复制到 artifacts，也不加入 CI。

## 保留边界与后续工作

- 按用户指令延期 Linux、Windows 原生验证；Windows 异常退出后的子孙进程清理尤其需要原生验证。CI 入口已补齐，但未触发公开标签 CI。
- V2 change 已按用户后续明确指令归档；10.1、10.4、10.5 保留归档时未完成标记，平台和发版结果由发布记录接续。
- 独立 Node 进程不是 OS 权限沙箱。可信扩展直接 Node 文件/网络操作不保证被 SDK 授权或 Journal 强制约束。
- Git 临时对象库使用预算监测和退出清理，不是 OS 硬磁盘配额；包缓存回收保守保留安装历史和工作流引用。
- 跨 Provider 历史可能不兼容，须显式分支；工作流 unknown 必须核对，不能自动重跑；代码回退不等于状态 schema 自动降级。
- 公开发布仍须用户明确发版指令，并遵循标签 CI 全通过后才创建正式 Release 的原流程。
