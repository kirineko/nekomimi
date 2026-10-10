# 11.1 主规格兼容审核（进行中）

**最终结论：11.1 已完成。** 42 个主能力与 30 个 delta（22 个既有变更、8 个新增）已核对；20 个未变主能力的契约与当前实现/测试映射见文末表。最终单元 788/788、浏览器 201/201、四格同包安装和安装后 47 个资源复核通过，类型/严格规格/发布检查通过。共享文件系统失败、真实模型未测及性能回归如实保留。以下按阶段保留的“未完成”描述是历史检查点，不覆盖本最终结论。

2026-10-08，当前仅完成入口清点与部分契约阅读，**11.1 未完成**。不能用 delta 严格校验通过替代与剩余主规格的语义核对。

## 已发现的交叉契约

`extension-process-host/独立执行与兼容` 仍明确承诺 V1 SDK 升级兼容；本 change 的 `extension-runtime/SDK 版本和命名` 与 design 已明确旧清单不保证兼容、SDK 3 准入以及工厂前拒绝。后者是已批准的破坏性变更，但归档同步不会自动修改另一 capability 中的旧 V1 承诺。已补齐 extension-process-host 对应 MODIFIED delta，绑定 7.1/11.1；现有 sdk-admission / sdk-v3-contract / customization-process 检查用于核对准入及执行。尚未修改或归档主规格。

`web-readable-presentation/按轮次组织会话展示` 保持不变，新实现和证据已补齐，见 `readable-turns/README.md`。不能继续使用已删除旧 Timeline 的测试作为新工作台证据。

## 已阅读、待完成实现与测试逐项对照

- core-tools：有界输出/完整附件、读取版本和精确 edit、路径与符号链接边界、实际 shell/进程组取消、移除主动 web_fetch 并保留历史、提示/参数语义及安全续读指引。
- local-web-service：固定服务工作区与会话授权、凭据/Host/Origin、持久 commandId、单活动任务/取消隔离、缺失凭据、静态资源边界及自动打开浏览器。Windows 运行结果仍须按 11.8 明确未测，不能由 macOS 推断。
- extension-process-host：除上述 SDK 冲突外，保留进程隔离非 OS 沙箱、RPC 身份与授权、迟到消息拒绝、unknown/degraded 和强制清理、原子注册及等待工作流版本保留。
- headless-session-export：显式继续/租约、无副作用回放、完整/删减导出、离线脚本与网络隔离、轮次和异常状态、同源语法高亮与失败降级。

## 尚无本 change delta 的主能力清单

以下是目录差集，不表示全部需要修改；未变契约应保留，并绑定当前实现/测试证据：

compact-header、core-tools、custom-model-providers、custom-web-panels、customization-packages、customization-release-readiness、customization-resources、deepseek-web-search、durable-custom-workflows、extension-process-host、file-change-presentation、headless-session-export、history-navigation、local-user-configuration、local-web-service、npm-release-delivery、response-recovery、runtime-diagnostics、skill-rule-loading、theme-color-values、web-feature-loading、web-readable-presentation、workspace-file-browser。

## 新发现的未变行为遗漏

`custom-web-panels/故障与历史回退` 要求当前运行新产生且授权/版本有效的面板直接展示。新 SavedRow 一律手动打开，与未变契约不一致；runtime-ui 旧场景迁移时也改成了显式打开，不能以绿灯替代原契约。应恢复仅新鲜 SSE 记录的一次实时挂载；快照/刷新/重连/历史分页/虚拟重挂保持只读，需要用户显式打开。11.1 未完成，待实现和双模式/禁用/重挂验证。

另需核对 `local-user-configuration` 的旧配置自动映射和旧会话迁移承诺与新版数据格式拒绝策略；读取和执行兼容不能混为一谈。

旧配置自动 profile 映射与已批准的不兼容格式拒绝确有冲突，已补 `local-user-configuration/配置入口与凭证隔离` MODIFIED delta；其余配置/凭证隔离场景完整保留。默认 `.nekomimi/v2` 仍处于 `.nekomimi` 下，未缩小数据隔离要求。旧历史显式迁移与观察仍需结合 local-experience / session identity 核对，不以复制成功宣称可继续执行。覆盖生成器已增加上述两项任务绑定；完整逐场景证据与生成结果在 11.9 更新，现有批次0映射暂保留。

## 交付门槛交叉核对

已读取 customization-packages、npm-release-delivery、customization-release-readiness 和 history-navigation 全部要求。customization-release-readiness 仍承诺 V1 兼容和必需 Windows 原生验收，与当前 SDK/数据拒绝设计及 npm-release-delivery 已批准的 Windows 暂缓相冲突，已补两项 MODIFIED delta；保留原场景标题和其余 macOS/Linux、无凭证 fixture、故障与发布状态门槛。包来源/依赖锁/危险归档、工作区及用户规则作用域、事务失败保留旧版、分享重装与卸载保留历史仍需结合 11.4 的最终包验证，不因单元通过而省略。历史导航的有界窗口、锚点、底部误差、自然后续分页、取消与异步竞态由当前 198 项浏览器回归中的 history-navigation、scrolling、scrolling-native、v2-history 检查复核，当前仍等待该整套结果。


## 2026-10-09 后续对照（仍未完成）

已继续阅读 response-recovery、runtime-diagnostics、custom-model-providers、skill-rule-loading、workspace-file-browser、deepseek-web-search、file-change-presentation、theme-color-values、web-feature-loading、compact-header 的完整要求。下列是当前代码与测试入口核对，不把文件存在当作完整场景覆盖，也不替代最终安装包验证。

| 未变保证 | 当前测试入口 | 审核状态 |
| --- | --- | --- |
| 精确文件修改、越界拒绝、有界输出和真实进程取消 | tools.test.ts、tool-pipeline.test.ts、durable-tool-adapter.test.ts | 已对照现有断言；全量单元结果见 full-regression |
| 本地认证、请求去重、并发及重启未知结果不重跑 | server.test.ts、diagnostics.test.ts | 已对照服务测试；平台结论仍受 11.8 限制 |
| 诊断独立、脱敏、损坏 watermark 下可读且不改 Journal | diagnostics.test.ts、browser/v2-run-recovery.spec.ts | 保留独立诊断入口及只读下载断言 |
| Provider 能力、受控凭证端点、显式历史分支、逐 attempt 记录 | customization-provider.test.ts | 覆盖 JSON/SSE 两协议、图片/工具拒绝、重定向及取消；新格式配置的显式 profile 迁移不等于旧数据格式准入 |
| 技能资源读取与规则变更先重新决策 | customization-rules.test.ts、resource-context.test.ts、context-revalidation.test.ts | 保留版本来源及规则撤销/持续变化门槛 |
| 已保存文件差异、脱敏及本地语法回退 | syntax.test.ts、browser/syntax.spec.ts、browser/v2-content-files.spec.ts | 不由当前磁盘补造历史；安装后 worker 路径留给 11.4 |
| 搜索证据及只读恢复草稿 | web-search-evidence.test.tsx、browser/search-brand.spec.ts、browser/v2-run-recovery.spec.ts | 不把模型自由文本当来源；恢复只写草稿 |
| 自由主题颜色、宿主恢复、更多菜单及可选功能懒加载 | customization-colors.test.ts、browser/theme-management.spec.ts、browser/header-recovery.spec.ts、browser/v2-feature-loading.spec.ts | 行为场景在本轮全量浏览器回归中；未替代体积门槛 |

新发现：`web-feature-loading/构建体积可验证` 明确要求保持 500 kB 告警阈值且无超限；当前正式构建 app 分块约 659 kB，有告警。因此该未变保证尚未满足，11.1/11.6/11.9 不可提前勾选。还需核对同环境冷启动 JS 总量，不能仅拆同步 vendor 分块就宣称体积改善。

实时面板修复的四项重点测试已通过。首次正式浏览器全量为 196/198，两项分别为嵌套确认退出同步与跨 iframe 布局同步问题；未改产品行为或放宽断言。加入内层关闭及目标 iframe 布局等待后，重复 10/10 通过，正式全量重跑 198/198 通过（3.7 分钟）。11.3 已勾选，11.1 尚有体积保证等待完成项。详见 live-panels。


安装包审计补充：macOS 系统 tar 的 AppleDouble 元数据已通过 portable 归档实现移除；同一浏览器导出场景新增完整/脱敏包无附加文件以及无宿主用户名/时间戳断言，现已通过。Node 24.15.0 正式 `npm run test:pack` 通过，具体范围与剩余最低 Node/跨模式门槛见 installed-package/README.md。原已记录证据不回写新源码摘要。


2026-10-09 按需加载后续：最大分块已降至 361261 bytes、无 500 kB 告警；首页 identity JS 479824 bytes，原版 480150 bytes，但 gzip 估算及直接会话入口仍有回归。39 项不同浏览器场景通过，首次逐消息延迟渲染的滚动回归已撤回并复验。完整范围和剩余要求见 loading-performance/README.md；11.1 尚未完成，不由主分块大小推断性能通过。

## 2026-10-09 剩余主规格逐项对照

实际集合为主规格 42 个、delta 30 个（其中覆盖既有 22 个、新增 8 个），剩余 20 个主能力保持原契约。旧清单中 workspace-references 已有 delta 但索引漏记，现已绑定 10.9/11.9；不把遗漏索引当成遗漏实现。

| 未修改能力 | 保留保证与当前证据入口 |
| --- | --- |
| compact-header | 统一更多菜单、导出取消、控件主题；compact-header、loading-performance 及 header-recovery/theme-management 浏览器 |
| core-tools | 精确文件编辑、版本/路径边界、有界附件、shell 进程组取消、退休抓取历史；tools、tool-pipeline、retired-web-fetch 测试 |
| custom-model-providers | 注册/选择能力、受控凭证端点、协议分支与原始证据；customization-provider、model-routing；安装包 Provider 夹具 |
| custom-web-panels | 隔离桥、持久回答、版本校验、文本回退；customization-panels、v2-runtime-slots；live-panels 补回实时自动展示，历史仍只读 |
| customization-packages | 固定来源/锁、归档安全、范围、事务失败保旧版、分享卸载保留历史；customization-package-source/customization-packages/customization-scopes；完整安装夹具 |
| customization-resources | 同名冲突、范围授权、快照、忙碌重载、清理失败阻断、修复再加载；customization、customization-scopes、sdk-runtime/boundary/projection |
| deepseek-web-search | 启停、原始有界来源、部分结果及取消；搜索证据测试与 search-brand 浏览器；不将模型自由文本当搜索来源 |
| durable-custom-workflows | 稳定步骤/版本、unknown 核对、跨重启等待、单活动触发、撤销门禁；customization-durable-workflows、workflow-management；安装包持久流程夹具 |
| file-change-presentation | 只呈现已记录 diff、原始附件、分页/定位及语法回退；workbench-services、syntax、v2-content-files 浏览器 |
| headless-session-export | 显式续跑、只读回放、完整/删减导出、离线安全与高亮；runtime、sdk-admission、privacy-admission；安装包离线导入与 HTML |
| history-navigation | 180 行有界窗口、2px 锚点、自然翻页、旧请求隔离和终态不抢读；history-navigation、scrolling、scrolling-native、v2-history；450 行实际对照 |
| local-web-service | 项目绑定、Host/Origin/凭证、持久 commandId、忙碌和取消隔离、静态路径；server、cli、diagnostics；全局安装双项目与别名目录夹具 |
| npm-release-delivery | 全局命令、元数据/完整性/最低 Node、tag/Release 分工；release-check 7 项和四格平台矩阵。未触发发布、未以 apply 代替真实发布验收；Windows 按既有暂停场景处理 |
| response-recovery | 预算、显式限制/取消、只读恢复草稿和单一结果；runtime、v2-run-recovery、readable-turns |
| runtime-diagnostics | 独立非权威诊断、watermark 故障仍可读、诊断存储失败不篡改事实；diagnostics、v2-run-recovery；故障注入日志保留 |
| skill-rule-loading | 有效版本的显式 Skill、目录 Rules、受限资源读取、检查期间重新决策；customization-rules、resource-context、context-revalidation |
| theme-color-values | 自由颜色、非法值拒绝、必要宿主恢复控件；customization-colors、theme-management、header-recovery |
| web-feature-loading | 专用界面按需、失败/取消/重试和焦点；loading-performance；最大分块 361261 bytes、无 500kB 告警；同 identity 传输首页 JS 480150→479824，gzip/直接会话回归另列。安装包实际打开全部既有可选类别与新增管理页，47 个资源请求无缺失、无页面错误 |
| web-readable-presentation | 安全 Markdown、高亮有界、命名与轮次、追踪顺序、响应式三栏和图标；readable-turns、local-syntax-scroll、compact-header、默认入口及安装包浏览器 |
| workspace-file-browser | 有界树、隐藏项、显式本机打开、路径/链接边界、历史定位与缺失诊断；workbench-services、references、v2-content-files；安装包真实文件页 |

三个交叉契约已由 delta 明确修正：extension-process-host 旧 SDK 工厂准入、local-user-configuration 不兼容数据拒绝、customization-release-readiness 的 SDK/Windows 门槛。未修改的真实面板展示及体积要求已由实现和验收补齐，而非删除原 Scenario。

本表是语义对照，11.1 仍等待最新全量回归收尾。首次最新单元为 754/787，33 项均超时，不能用此前全绿覆盖；关键故障恢复/MCP 隔离 23/23 通过，原断言及时间门槛未改。完整 2-worker 重跑与 Linux/最终浏览器结果另记。


## 最终审计追加：诊断输出与文件系统

移除会打印原始异常的遗留 HTTP 调试分支；新增 `http-error-privacy.test.ts` 在真实 HTTP 500 路径注入模拟凭证，修复前失败、修复后 HTTP/控制台均不泄露。最终完整单元 133 文件 788/788 通过；无需放宽凭证保护契约。

Linux 快照异常已由隔离诊断定位为读取 durable.json 的 ENOENT；只做原子替换与并发读取的独立探针在 OrbStack 共享挂载出现 2219 次 ENOENT，在原生 Linux 文件系统为 0。正式四格安装验收使用 macOS / Linux 原生持久目录并全部通过，共享挂载失败如实列入平台矩阵；未改变生产 Journal 水位、安全失败和副作用恢复规则。最新全量浏览器仍等待收尾，11.1 暂不勾选。

最终全量浏览器 201/201 和实际最终安装包资源复核通过，11.1 现已完成。证据：[最终回归](final-regression/README.md)、[最终平台](platform-clean/README.md)、[运行/性能限制](runtime-performance/README.md)。不把规格兼容审核等同于真实模型质量或发布验收。
