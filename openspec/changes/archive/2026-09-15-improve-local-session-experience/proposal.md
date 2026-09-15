## Why

当前 CLI 与 Web 分别存储会话，凭证依赖环境变量，用户无法直接在界面完成配置；时间戳会话名、缺少删除入口和原始 JSON 式 HTML 导出也增加了日常使用成本。统一用户数据目录并完善会话与阅读交互，让本地安装后的配置、执行、管理和离线检查形成完整闭环。

## What Changes

- **BREAKING**：产品品牌统一为 Nekomimi，仓库及目标 npm 包名为 `nekomimi`，发布命令为 `nekomimi`（替代 `harness`）。全局更新当前产品代码、帮助、文档、脚本与测试；历史记录及协议兼容标识不机械替换。npm 发布名可用性需在发布前核实，本轮不发布或重命名远端仓库。

- **BREAKING**：CLI/Web 默认配置、凭证、JSONL 与附件统一到 `~/.nekomimi/`，Windows 使用用户目录下同名目录；新会话不再写入项目 `.harness/`。提供显式旧数据迁移，保留源数据。
- **BREAKING**：产品不再从环境变量或 dotenv 读取模型凭证和产品配置。Web 增加设置面板，用户输入 API key 后保存至独立凭证文件；CLI 提供交互式配置入口，共用同一配置。
- 会话首条消息生成临时摘要标题，首轮结束后通过可追踪的辅助模型调用命名一次；失败回退，不影响任务结果。
- 会话支持确认删除，运行及命名未停止时拒绝删除；同步失效其他窗口，删除范围仅限会话数据。
- Enter 发送、Shift+Enter 换行，兼容中文输入法组合输入和重复提交保护。
- 离线 HTML 默认显示标题、轮次导航、消息、Markdown、配对工具结果及 diff，原始证据按需展开，保持自包含与无副作用。
- 对应 `spec.md` §3.2/3.5 请求证据与存储导出、§8 浏览器交互和本地服务边界。非目标：多用户、云同步、通用 provider 管理、操作系统密钥链、TUI 或自动执行历史任务。

## Capabilities

### New Capabilities

- `local-user-configuration`: 用户目录、配置和凭证持久化、Web/CLI 设置、旧会话迁移。
- `session-lifecycle`: 自动命名、辅助调用证据、会话删除及跨窗口一致性。

### Modified Capabilities

- `web-readable-presentation`: 产品品牌由 Deepy 改为 Nekomimi，统一发布命令和名称。

- `web-task-workbench`: Enter 发送和输入法安全行为。
- `headless-session-export`: 可读的自包含 HTML 阅读结构。

## Impact

涉及 `src/cli.ts`、`runtime.ts`、`server/`、`projection/`、`web/` 和 `export.ts`，新增独立配置、会话生命周期及导出展示模块。新增设置、迁移与删除接口，更新 CLI 引导、脚本和测试；已交付授权、单活动任务、Journal 保真与工作区隔离要求继续成立。迁移不重写 JSONL，不修改主规格直到归档。优先复用现有固定依赖，实施时验证离线渲染打包，无预设升级。
