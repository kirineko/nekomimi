# 发版 CI 故障调查与验证

## 调查范围

- 基线：`9b11a6b6dbcefa99b3dd22d25d4a8eb789ec7350`，包版本 0.2.0。
- 最新失败：[CI 35754385924](https://github.com/kirineko/nekomimi/actions/runs/35754385924)，触发时间 2026-09-22 16:28:52 UTC。
- Linux × Node 22.19.0/24.15.0 均通过；Windows、macOS 22、macOS 24 分别失败于候选浏览器测试、未知工作流浏览器测试、syntax 单元测试。
- 这是发布前标签 CI 失败；最新 Publish npm 为 0.1.5 成功记录，不能称为 0.2.0 npm 上传失败。

## 提交脉络

| 提交 | 内容 | 最新 CI 中的状态 |
| --- | --- | --- |
| `8f41332` | SDK v2 与 0.2.0 候选 | 后续标签检查尚未全部通过 |
| `af44264` | Provider 取消同步到 transport dispatch | 最新测试未报此处失败 |
| `d51a766` | 安装包扩展校验诊断 | Windows 安装包步骤已通过 |
| `ac92a75` | Windows 路径规范化及进程树退出确认 | Windows 原生测试已通过 |
| `19e1b4b` | 规范化前校验 archive 原始路径 | Windows package-source 测试已通过 |
| `9b11a6b` | Windows overlapped RPC 与 macOS EPERM | Windows process/MCP 测试已通过 |

## 最新失败证据与修复

1. Windows 候选测试第二次 submit 返回新的 runId，management 的新 receipt 已 activated，但断言仍看到唯一的旧轮次 Ready。旧测试的 conversation-heading 完成条件可以匹配上一轮；改为等待指定 receipt、生效后的新轮次以及该轮结果与完成状态。保留回退后第三轮 Ready 与历史新版本内容断言。远端日志不能单独证明完整根因，需 Windows 复验确认。
2. macOS 22：16:33:58.776 启动工作流，16:34:01.693 management 中有异常且仍 running，16:34:03.321 的请求中才读到 unknown，已接近默认 5 秒 UI 断言边界。保留清理期间 running 的语义，为清理和页面轮询设置局部 20 秒等待。
3. macOS 24：分页及长行截断合并用例超过 15 秒；本机独立运行该用例约 5.1 秒。将长行正则分词与分页断言拆分，长行场景独立 30 秒预算，保留 Unicode、CRLF、截断与 token 文本精确相等断言。

## 本地验证

环境：macOS，Node.js 24.15.0。

- `npm run build`：通过。
- `npm run typecheck`：通过。
- `npm run test:release`：7/7 通过。
- `openspec validate --all --strict`：32/32 通过。
- 首轮单元/浏览器并行验证：单元 220/221 通过，一个原有 customization-workflow 测试超过 30 秒；该测试独立复验通过（8.56 秒）。浏览器 19/22 通过，两个原有用例超过 5 秒，另一个新选择器匹配到两条 status，已修正为本轮最后一条。
- 最终 `npx playwright test`：22/22 通过（1.3 分钟），包括候选三轮更新/回退、未知结果恢复与副作用计数。
- `node scripts/pack-smoke.mjs`：通过；本地/全局安装、Web、离线导入导出、SDK 1/2、能力包、Provider、持久工作流、面板及 stdio MCP 均验证完成。
- 第二次默认并发完整单元运行：220/221 通过，原有 Git 历史大小限制场景超过 30 秒（第一轮该场景通过）；因此额外用单 worker 完整复验。
- `npx vitest run --maxWorkers=1`：38 个文件、221/221 测试全部通过（185.81 秒）。默认并发仍有上述偶发超时，不能用串行通过宣称并发稳定。
- `git diff --check`：通过。

## 尚未验证的边界

用户随后明确要求重发 0.2.0；官方 registry 未发现该版本，GitHub 无对应 Release。已授权提交、推送及更新未发布候选标签。远端 Windows 与 Linux/macOS Node 22/24 矩阵通过前，任务 2.2 保留未完成，change 不归档。工作流触发规则、包版本与发布流程保持不变。

## 重新发布期间的追加修复

提交 `870e335` 的 [CI 35882756788](https://github.com/kirineko/nekomimi/actions/runs/35882756788) 中 Linux 两组通过，macOS 22 单元 220/221 通过，唯一失败为 `customization-durable-workflows` 的显式重试/迁移综合用例超过 15 秒总预算。该用例串行包含多次 pinned extension 启动、释放与重载，现仅将该用例总预算设为 60 秒，所有产品内部预算和语义断言保持不变。使用官方 Node 22.19.0 运行完整 durable-workflows 文件：14/14 通过（27.85 秒）；类型及严格规格校验通过。新提交仍须完整标签 CI 通过。

同轮 Windows 的安装包、进程、MCP、package-source 与候选更新/回退均通过，最后在面板工作流启动等待表单时超过默认 5 秒。trace 显示仍在 pinned activation，没有错误结果。结合本地 Provider/持久工作流同类超时，统一定制浏览器文件为 20 秒断言与 90 秒场景预算，无重试且保留所有语义断言。官方 Node 22.19.0 下完整定制浏览器测试 9/9 通过（47.6 秒），类型和严格规格校验通过。
