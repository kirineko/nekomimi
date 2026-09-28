# 提示词与工具契约优化验收

本次参考本地 dsh 的有序章节、动态上下文及来源设计，以及 pi 的工具摘要/描述/参数分工；没有升级依赖或移植内部宿主。

## 复现

- `npx vitest run test/prompt-contracts.test.ts test/prompt-baseline.test.ts`：确定性组装、参数、路径、技能、环境与指南验证。
- `PROMPT_REPORT=1 npx vitest run test/prompt-baseline.test.ts`：重新生成 comparison.json；估算方法为现有 estimateTokens，不是服务商 tokenizer。
- `npm run build && node scripts/prompt-eval.mjs`：离线生成固定模型场景及预期，不调用模型。
- `PROMPT_EVAL_REPEATS=3 PROMPT_EVAL_MODEL=deepseek-flash node scripts/prompt-eval.mjs --live`：显式选择真实评测；需要 DEEPSEEK_API_KEY，使用隔离临时工作区，产生真实调用费用。每项记录模型、配置、轮次、错误、usage、耗时及 Journal 目录；导航/说明类结果需人工判读，不自动记作成功。

旧基线见 test/fixtures/prompt-baseline.json，记录源码提交、固定场景、模型标识和输入。环境路径归一化，记录的输入正文用于检查成本及结构，不能将不同运行的资源 hash 当作稳定业务身份。辅助请求对照使用原命名指令和原主前缀继承策略；新请求分别使用专用模板。

## 验收映射

| 契约 | 证据 |
| --- | --- |
| 分层、排序、共享来源、禁用指导 | prompt-contracts、context、customization-failures |
| Skill 正文、规则范围、目录预算、旧证据 | prompt-contracts、customization-rules、customization-workflow |
| 字节续读、编辑保护、shell 状态/取消 | prompt-contracts、tools、edges |
| 动作缺参及互斥、远端 schema、SDK 指南 | prompt-contracts、customization-mcp-content、customization-scopes |
| 项目/用户级开发、阶段及效果 | customization-lifecycle、customization-v2-composite、customization-scopes、浏览器定制测试和安装包验收 |
| 摘要预算、配对、取消、迟到和无副作用 | context-compaction、context-runtime、prompt-contracts |
| 命名隔离、输出约束、历史不变 | local-experience、prompt-contracts |

## 成本取舍

| 场景 | 原系统 / schema | 新系统 / schema | 原合计 → 新合计 |
| --- | --- | --- | --- |
| coding | 1406 / 1946 | 1569 / 3510 | 3352 → 5079 |
| restricted | 813 / 126 | 546 / 315 | 939 → 861 |
| customization | 1429 / 1946 | 1612 / 3510 | 3375 → 5122 |
| mcp | 289 / 529 | 760 / 1188 | 818 → 1948 |
| rulesSkill | 306 / 481 | 817 / 1140 | 787 → 1957 |
| compaction | 1406 / 0 | 175 / 0 | 1406 → 175 |
| title | 50 / 0 | 106 / 0 | 50 → 106 |

单位为估算 tokens；只包含系统文本及工具 schema，不含任务消息、工具结果或实际 usage。

比较系统文本和 schema 时分别报告，不能用其中一项的降低代表总成本降低。受限工具任务去除了不可用的定制指引；压缩请求去除了主任务操作流程。完整工具集因补充参数契约而变大，可能增加输入费用；是否降低无效调用和总轮数仍需真实评测。

常驻资源目录仅展示可用的简短入口及有界资源记录，完整资料通过 SDK 或资源工具按需读取。必要规则保持完整，目录省略会明确说明。真实模型质量评测本轮未运行，不声称完成率、缓存命中或模型费用得到改善。

## 执行记录

2026-09-28，macOS / Node.js v24.15.0：

- `npm run typecheck` 通过。
- `npm test -- --maxWorkers=2`：52 个文件、313 项通过。默认并发曾使 Git 大对象夹具和扩展/MCP重启流程超时；降为两个 worker 后全套通过，未放宽断言或测试超时。
- 随后补充环境历史分支、参数上限和命名取消保护；对应 `prompt-contracts + context-runtime` 39 项及 `prompt-baseline + prompt-contracts + local-experience` 41 项回归通过。SDK 示例类型检查及指南测试 34 项通过（上述集合有重叠，不能相加为独立测试总数）。
- `npm run test:browser` 首轮 43/45；两个失败分别为模拟模型把环境记录当成用户任务，以及在扩展页 iframe 尚未完成加载时点击关闭。提交前代码在隔离目录的扩展页场景通过。修正模拟请求筛选及等待面板真实内容就绪后，`npx playwright test --grep 'combines ordered views|cancels and remains usable'` 2/2 通过；45 场景均已有通过记录，未修改 Web 产品代码以规避断言。
- `npm run test:pack` 通过：临时 tarball 安装、全局 CLI/Web、导出导入、完整 SDK、全部目录指南及内容 hash、能力包、Provider、持久工作流、面板、MCP、主题资产、授权扩展与回退通过。验收平台是当前 Node 24，未声称本轮跑过完整跨平台发布矩阵。
- SDK 新增/修改文档相对链接检查通过；离线评测入口生成 6 个固定场景，真实模型评测未运行。
- `openspec validate --all --strict` 41 项通过；`git diff --check` 通过。

首次沙箱内测试因本地端口、进程查询和安装权限限制失败，相关检查已在允许这些操作的环境重跑；保留失败原因，不将受限运行记录解释为通过。
