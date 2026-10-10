# 核心候选源码准备（8.1）

2026-10-07，macOS arm64 / Node.js 24.15.0，未提交工作树。

## 实现

- 正式 CLI 新增 core preview/prepare/inspect/list。用户明确选择源码；静态核对 package/lock/构建入口及宿主版本，缺失或不匹配直接拒绝，不下载替代源码。
- prepare 必须带 preview 的 sourceRevision 与 targetHostBuild；来源、确认或宿主变化不复用旧检查。独立目标目录使用排他创建，不替换已有文件，不允许目标覆盖源码、项目根、当前安装或数据目录。
- 保存实际文件摘要、可执行标记、空目录，包含未提交与未跟踪源码；副本完成后复核两端内容。Git、依赖、生成产物、研究资料、运行数据及环境凭证明确排除并报告。其他符号链接和超限输入拒绝。
- Journal 保存意图、失败或 prepared 终态。prepared 绑定候选 ID、所属项目、目录 device/inode、原始源码基线和目标宿主；失败副本保留诊断，不登记为可用候选。
- 核心创造会话只准入已登记副本，将候选 ID 与原始 sourceRevision 固定到目标身份摘要中；目录替换、错误基线、宿主变化拒绝。候选可编辑，current revision 不覆盖原始基线。
- 读取目录、检查候选和恢复登记不运行脚本或模型，不宣称 built/applied。构建与受控切换分别由 8.2–8.6 承担。

## 验证

source-first.log：初始 2 文件 14 项通过。
source-regression.log、source-final.log、source-complete.log：分阶段 5 文件 42 项回归通过，最终覆盖真实 Git 未提交修改、未跟踪文件和索引保持；空目录及可执行文件摘要；旧确认拒绝；来源缺失/版本不符；目标已有文件保护；符号链接拒绝；查询 Journal 不变；目录替换及所属项目隔离；核心会话绑定及其他会话/候选回归。
source-cli.log：最终构建的正式 CLI 全流程 1 项通过，构建脚本故意 exit 99 仍未执行；命令无需真实凭证。
source-types.log、source-build.log：类型与构建退出码 0；source-specs.log：严格规格 43 项通过；git diff --check 通过。

真实当前仓库只读预览见 source-real-preview.json：1,861 个文件、500 个目录，约 9.5 MB，未执行脚本。首次预览因 reference 中研究资料符号链接拒绝的日志保留；明确根级研究/生成/运行目录排除政策后通过，未放松源码符号链接拒绝。预览摘要对应采样时工作树，后续验收文档写入会改变实际源码摘要；它不是最终提交或完整构建验收。

未对真实工作树执行核心副本准备、构建授权、版本切换或发布。平台外的验证保留给最终矩阵。
