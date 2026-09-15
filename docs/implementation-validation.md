# 第一版应用验收（2026-09-15）

Change：`establish-observable-headless-core`。此报告验证根目录应用，不以之前的选型探针替代应用验收。

## 环境和结果

- macOS arm64，Node 24.15.0；pi-agent-core / pi-ai 固定 0.85.1。
- TypeScript strict 类型检查、构建通过；29 项 Vitest 测试通过，覆盖 Journal、工具、上下文、provider/runtime、CLI。
- CLI SIGINT 测试使用本地回环 HTTP 服务。在受限执行环境中监听曾超时；允许本地连接后通过，退出码 130，Journal 最终状态 cancelled。
- 本地 tarball 在 `/private/tmp/harness-pack-a5fSF4` 干净安装，公开入口、CLI help、离线回放、HTML、bundle 检查与导入通过。没有发布。
- OpenSpec 严格校验通过，change 已于 2026-09-15 归档。

## 五项 capability 对照

| Capability | 应用证据 |
| --- | --- |
| execution-journal | 并发 seq、写锁冲突、附件 hash 损坏、磁盘失败阻断、批量水位、SIGKILL 后 unknown、尾行隔离与中段损坏测试 |
| model-call-evidence | 真实 pi Responses 解析器运行；wire body/hash、unknown SSE、独立 429 retry、failed/incomplete、截断帧、取消、字节/事件上限、慢盘背压、原始 reasoning 和多工具配对 |
| prompt-context-provenance | 工具排序与禁用指导移除、稳定 manifest、逐项 eventId/seq/itemIndex/hash/source、实际请求关联 context revision |
| core-tools | 精确原版匹配、重复/重叠拒绝、BOM/CRLF、外部修改、路径/symlink、长 UTF-8 分页、图片、shell 双通道/退出码/超时/取消及完整附件 |
| headless-session-export | run/resume、CLI SIGINT、单写入者、只读 replay/import、完整 manifest、篡改拒绝、HTML 转义/CSP、删减包不可继续且源记录不变 |

测试来源：`test/journal.test.ts`、`tools.test.ts`、`context.test.ts`、`runtime.test.ts`、`edges.test.ts`、`cli.test.ts`。

## 应用边界的真实 DeepSeek 验证

显式脚本 `npm run test:live`：凭证不存在时输出 SKIPPED，存在时只访问临时合成文件。使用默认 auto 工具选择和 instructions。

1. 文件链路：`/private/tmp/harness-live-rM9G5W`。读取 source.txt，写入 copied.txt，逐字检查副本，再显式继续询问历史内容。两轮 run 均 completed，5 次 HTTP 200/completed；实际响应包含 reasoning，累计水位 302，HTML 导出成功。
2. 图片链路：`/private/tmp/harness-image-qcfJ68`。用户传入有效 16×16 红色 PNG，read 返回同一图片，再继续回答；2 次 HTTP 200/completed，tool.result 存在。
3. 失败记录：初次受限联网出现 Connection error；另一张损坏 PNG 被服务端以 HTTP 400 拒绝。修正网络执行环境和 PNG 夹具后复验通过，没有将失败计入成功。无效图像不会触发工具。

真实验证总计 7 次成功请求。失败记录保留在各自临时 session 中；没有把 API key 写入报告。`scripts/live-image-smoke.mjs` 可单独复验图片，避免重复文件链路。

## 持久化与边界

本机连续 30 次强制持久化 append（含 Journal fsync 和水位文件同步）：中位数 13.97ms，P95 23.79ms，最大 28.00ms。仅代表本次本机采样；100ms/64KiB 是批量触发阈值，慢盘不保证固定时限。

模型原始输出 items 以同一 Journal 事件写入，避免崩溃留下半组 reasoning/tool call 投影。低层 Agent 管理当前运行循环；每次 transport 请求从 Journal 重建完整 provider 历史，不依赖 Agent 内存中的历史作为权威。未知旧工具结果仅加入明确的恢复状态，不重新执行或伪造 reasoning。

响应流通过拉取式持久化背压、16MiB/10,000 事件上限约束单次调用；没有声称长期会话内存恒定。回放和导出目前一次加载 Journal/附件，大会话需要后续分页。

## 限制

- Windows PowerShell 与进程树结束分支尚未实机测试；Windows 不通过 Node 同步目录句柄。当前平台验收为 macOS。
- Shell 是本机执行，不是隔离沙箱；文件工具路径边界不限制 shell 权限。
- 文件变更前检查和 rename 之间仍存在操作系统层竞态窗口，没有跨进程恶意替换的原子 CAS 保证。
- 认证头不入日志，配置密钥做字面值清理；脱敏不等于自动发现所有隐私文本，完整包包含任务原文。
- provider usage 原样保留，未提供经验证的价格计算，明确记录 costEstimateAvailable=false。
- 目前不自动加载项目指导；每次通过 `--instructions` 明确指定。没有模型迁移、压缩、Web/TUI 或插件系统。


## 2026-09-15 审查修复复验

- 修复 shell 取消/超时后后台子进程残留：保留 SIGKILL 升级流程，并等待进程组消失后记录 shell.finished；退出期间短暂 EPERM 有限重试，无法确认时报告错误。
- shell 双通道和模型响应共用字节级跨块凭证脱敏；匹配附件标记 redacted，普通二进制字节不变。仅缓冲可能构成凭证的尾部，正常完整 SSE 帧及时交付。响应检测到凭证后停止 attempt；EOF/断流时保留可安全写入的尾部证据。
- 新增 `test/review-regressions.test.ts`，8 项回归覆盖全部凭证分割位置、单字节块、二进制邻接字节、shell 双通道及导出、取消/超时后的后台进程、HTTP 200/500 响应、EOF/断流尾部保留。
- 本次 `npm run typecheck`、`npm test`（9 个测试文件、53 项测试，含构建）通过；`openspec validate --all --strict` 三个 change 通过。进程组及本地 HTTP 测试在允许相应操作的环境运行。
- 再次审查修复和相关调用链，未发现新的可操作问题。本次未运行真实模型调用；Windows 进程树终止仍未实机验证。
