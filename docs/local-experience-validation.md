# Nekomimi 本地会话体验验收

日期：2026-09-15。变更：`improve-local-session-experience`。平台：macOS arm64、Node 24.15.0、Chrome。

## 交付内容

- 产品、安装包与命令使用 Nekomimi / nekomimi；默认配置为 `~/.nekomimi/settings.json` 与 `auth.json`，会话按规范化工作区分区。
- 文件配置、Web 设置、交互式 CLI 配置；API 仅返回凭证是否配置，运行入口不读取产品环境变量。每次任务捕获配置快照。
- 旧目录显式复制迁移，保留源日志和附件；重复迁移跳过，锁定、损坏和冲突逐项反馈。
- 首消息临时标题、一次性记录式模型命名、继续任务优先取消命名；确认删除、下载保护及跨窗口删除通知。
- Enter 发送、Shift+Enter 换行、组合输入保护。用户人工确认：中文第一次 Enter 选词不发送，随后 Enter 正常发送。
- 离线 HTML 按轮次展示 Markdown、工具输入/结果与 diff，原始证据折叠保留；共享展示模块，不改变 bundle 协议。

## 验证证据

- `npm run typecheck`：通过。
- `npm test`：10 个文件、61 项测试通过，包括配置修订竞争、原子写失败保留旧文件、迁移发布后登记失败重试、活动源锁、配置快照与命名取消。
- `npm run test:browser`：4 项通过，包括配置→迁移→Enter→命名→继续→离线导出→确认删除，以及双窗口通知、刷新、窄屏和安全渲染。
- `npm run test:pack`：干净安装 `nekomimi-0.1.0.tgz`，CLI 帮助、离线导出导入、Web 静态资源/提交/导出通过。
- `openspec validate --all --strict`：11 项通过。
- `git diff --check`：通过。
- 真实调用：用户在 Web 设置保存凭证后，脚本从文件读取并复制到临时测试 home。合成任务写入 greeting.txt，随后确认并生成模型标题；3 次 attempt 均 HTTP 200 / completed，耗时分别 1075、1819、930 毫秒。会话 ID：`84f33c36-66b8-4a6c-9dd4-1740cd7e8fc1`。
- 真实证据与截图仅保留在 `/private/tmp/nekomimi-web-live-uKUA8E`，不进入仓库。

## 验收中修正

辅助标题在默认思考模式下耗尽 64-token 预算。按照 [DeepSeek Responses API 文档](https://api-docs.deepseek.com/api/create-response/) 将辅助请求设置为 `reasoning.effort=none`，主任务参数不变；另修正中文与英文文件名混排的长度校验。一次真实主任务出现超时，重试后完整通过，失败记录保留在临时目录。

旧 Journal 测试依赖固定 70ms 等待，负载下偶发失败；改为在 2 秒内等待持久化条件，不降低持久化断言。

## 边界

仅验收上述 macOS/Chrome 环境，Windows 权限和其他平台输入法未经实际验证。历史研究报告、归档规格、bundle 协议标识、迁移路径及参考仓库名称保留原样。npm 名称可用性在正式发布前核查；当前未发布、未远端重命名、未移动工作目录。本次变更已于 2026-09-15 归档，随实现一并提交。

## UI 补充验收

按用户后续反馈，设置面板改为模型与凭证卡片，移除 Web 迁移入口；删除改为省略号菜单，保留确认弹窗。新增共享猫耳品牌组件，侧栏和回复署名统一使用。类型检查和 4 项浏览器回归通过。此前迁移验收作为历史记录保留，CLI 维护工具不变。

后续界面调整：当前设置面板只提供 API key 管理，模型名称与服务地址编辑入口暂不提供。

## Review 修复验证

修复 HTML 脱敏字段名碰撞和并发迁移登记丢失；新增回归验证自定义脱敏后导出成功、源 Journal 不变，以及并发迁移登记完整、删除后重复迁移不复活。CLI 迁移持有工作区 sessions 租约。类型检查、63 项单元/集成测试、4 项浏览器测试与 11 项 OpenSpec 严格校验通过。再次审查未发现新的高置信度阻塞问题。

## 归档

23/23 任务完成；5 份 delta 已同步至主规格，归档至 `openspec/changes/archive/2026-09-15-improve-local-session-experience/`。归档前严格校验 13 项通过，归档后主规格严格校验 12 项通过。最近代码回归为 63 项测试及 4 项浏览器用例通过。
