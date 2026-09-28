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

## 2026-09-28 定制能力面板改版

变更：`simplify-anime-customization-panel`。保留现有管理协议与服务端持久化，将面板分为模型、资源、能力包、工作流与面板；加入猫耳徽章、淡紫与樱粉点缀、统一卡片与宿主控件。新增配置、资源详情及高级操作按需展开。

### 功能入口

| 操作 | 新入口 |
| --- | --- |
| 主对话 / 辅助 / 命名模型 | 模型 → 用途摘要选择器；默认项仍表示原 DeepSeek 设置 |
| 新增配置、端点授权与 API key | 模型 → 新增配置；请求路径在高级请求设置，最终授权范围始终显示 |
| 旧 DeepSeek 迁移、跨 Provider 分支 | 模型 → 高级模型操作 |
| 资源启停、来源、遮蔽、校验、重载 | 资源 → 资源卡片 / 资源详情 |
| 用户目录写入授权、扩展候选与 MCP OAuth | 资源 → 对应具名入口 |
| 能力包候选、安装与已安装版本管理 | 能力包 → 检查候选 / 管理能力包 |
| 工作流启动、回答、未知结果核对与证据 | 工作流与面板 → 持久工作流 |
| 自定义面板打开与预览 | 工作流与面板 → 打开或预览面板 |

### 行为证据映射

`test/browser/customization-studio.spec.ts` 使用真实本地 Web 外壳和管理 API 响应夹具，隔离失败与界面状态；`test/browser/customization.spec.ts` 继续使用真实本地管理服务、扩展与协议 fixture 验证副作用边界。

| Delta Scenario | 验证证据 |
| --- | --- |
| 初次打开面板 | empty studio：模型默认页、完整表单和高级操作默认收起 |
| 切换分类查看资源 | resource diagnostics + 原定制闭环：来源、版本、遮蔽、诊断与各分类操作可达 |
| 查看不同分类的控件 | studio screenshots：模型、编辑器、资源、工作流截图及颜色对比数据 |
| 选择与取消选择 | model selection：搜索、方向键、Home/End、Escape、取消无写入、单用途选择、失败和重开 |
| 无可用 Provider | empty studio：空状态引导资源分类，无自动授权 |
| 取消草稿与保存失败 | draft survives + validates fields：失败保留非敏感输入、清除密钥、保留已确认凭证引用、取消清除草稿、显式重试 |
| 轮询期间编辑 | draft survives：管理轮询与切页不丢草稿或焦点，冲突后读取新 revision |
| 隐藏分类发生失败 | resource diagnostics + studio screenshots：全局失败收据、待生效、分类计数、旧有效版本和未知结果核对入口 |
| 取消不撤销已提交操作 | closing during a submitted save：重开读取完成结果且只提交一次；候选预览切页不再次启动工厂 |
| 仅使用键盘操作 | empty studio + model selection：页签导航、选择、Tab 焦点约束、逐层 Escape、关闭返回入口 |
| 窄屏与长内容 | studio screenshots：1440×900、390×844、360×800、200% 等效浏览器缩放，无面板及页面横向溢出，关闭和选择选项可达 |

### 截图与边界

截图在本地 `output/playwright/customization-studio/`（按项目惯例忽略入库），命名为 `{desktop,mobile,narrow,zoom-200}-{models,editor,resources,workflows}.png`。`contrast.json` 保存实际浏览器计算颜色的对比值。200% 验收使用 720×450 CSS 视口验证 1440×900 桌面缩放后的等效重排，并通过 CDP 请求 2 倍设备比例；截图按 CSS 像素保存。这是布局模拟，不是修改 Chrome 用户缩放设置；未使用会扭曲固定定位的 CSS zoom。截图中的资源与错误为验收夹具。

本次验证为 macOS / Node.js 24.15.0 / 本机 Chrome，不宣称已覆盖 Safari、Firefox 或真实移动设备。无生产凭证和真实模型请求。模型凭证与配置仍为现有两步写入，失败不承诺事务回滚；已确认凭证引用仅在本次编辑草稿中保留，取消或关闭清除草稿，结果未知须用户重新输入后显式提交。第三方面板 iframe 内部主题不在本次改版范围。

### 验证结果

- `npm run typecheck`：通过。
- `npm test`：默认并发首轮 229/231 通过，工作流组合与服务分页两项触发既有超时；`npm test -- --maxWorkers=2` 完整复验 39 个文件、231/231 通过（102.63s），未修改超时或跳过用例。
- `npm run test:browser` 首轮发现名称 pattern 校验失效；修正转义并重建后，`npx playwright test` 全量 29/29 通过（1.5m），含七项新增面板场景、九项定制服务闭环及聊天/设置/文件/追踪回归。
- `openspec validate --all --strict`：32/32 通过；`git diff --check` 通过。
- 浏览器计算颜色的对比度：正文 14.13:1、辅助文字 6.60:1、主按钮 6.40:1、控件边框 3.49:1、选中页签边框 3.92:1；键盘焦点使用主紫色轮廓。减少动态效果测试确认过渡时长为 0s。
- 已查看桌面、390px/360px 窄屏和等效缩放截图；长名称/路径正常换行，滚动正文时头部与分类保留，错误与未知结果文字可见；模型编辑输入焦点与禁用状态可辨认。
- React 组件检查：状态容器和模型草稿分离；分类使用 hidden 保留表单/面板实例，隐藏内容不能接收焦点；轮询清理、陈旧响应过滤与焦点恢复沿用公开接口；未新增依赖或修改后端协议。

## 紧凑会话导航与斜杠命令发现（2026-09-28）

对应变更 `improve-session-navigation-and-command-discovery`。会话采用标题与时间/状态两行布局，按活动时间排序后分页，日期分组按浏览器本地日历计算；没有新增消息摘要。活动时间来自创建、接受任务、运行开始及终态，后台命名和中间记录不改变位置。列表元数据缓存可重建，不读取附件正文，历史 Journal 未迁移。

命令目录使用实际激活资源，与执行端共用名称匹配；包含内置命令、扩展命令、工作流触发器和技能。同名使用可唯一解析的限定名，仍有歧义的项不作为候选。服务启动负责初始化已有授权的资源，初始化不产生用户重载收据；只读目录请求不激活资源或执行命令。

### 行为证据映射

| 契约 / 场景 | 验证证据 |
| --- | --- |
| 活动排序、旧记录与证据不变 | `test/session-navigation.test.ts`：边界事件、无时间、无效时间、后台命名、Journal 内容对照 |
| 全局排序与分页版本 | 同上：35 个会话跨页、相同时间 ID 排序、坏目录、继续/新增/删除使旧版本失效、旧 offset 调用兼容 |
| 目录与执行名称一致 | `test/command-catalog.test.ts`：扩展重名、工作流冲突、限定名仍冲突、内置保留名、技能同名资源 ID |
| 只读与激活状态 | 同上：认证拒绝、启停、服务重启后首次执行前可发现；工厂计数、handler 文件及 Journal 对照，读取目录不执行代码；响应不包含凭证或函数 |
| 真实自定义命令闭环 | `test/browser/session-navigation.spec.ts`：启用 `/moe`，首次 Enter 只补全，第二次发送后显示真实结果，最近会话排序在刷新后保持，删除其他会话保留选择和草稿 |
| 紧凑信息、跨日、分页冲突 | 同上：长标题截断、时间完整提示、固定时钟跨日分组、版本冲突重新读取、online 刷新不丢草稿 |
| 自然关闭删除交互 | 同上：菜单单实例、外部点击/Esc、遮罩关闭、内部点击不关闭、焦点初始/循环/恢复、处理中防重复与禁止关闭、失败反馈及成功导航 |
| 命令输入边界 | 单元及浏览器：命令词光标、参数保留、正文/路径不触发、方向键/Tab/Enter、Esc 不立即重开、IME 合成事件、Shift+Enter、无匹配 |
| 目录失败与竞态 | 浏览器：不可用/未就绪可重试，资源目录 revision 更新、旧响应晚到不覆盖，首次创建会话后提交失败保留草稿与错误 |
| 既有功能 | 全量浏览器回归包含原定制面板、MCP OAuth、能力包、工作流、文件变更、追踪、诊断下载、历史回放与导出 |

### 截图与边界

本地截图保存在 `output/playwright/session-navigation/`（按项目惯例忽略入库）：`sidebar-desktop.png`、`sidebar-mobile.png`、`groups-long-title.png` 与 `commands-{desktop,mobile,zoom-200,keyboard}.png`。已检查长标题、时间/状态布局、可见焦点和有界命令列表。

桌面视口为 1440×1000，窄屏为 390×844，200% 等效重排使用 720×450 CSS 视口，软键盘可用高度使用 390×430 模拟；后两者不是实际操作系统键盘或 Chrome 用户缩放设置。IME 使用合成组合事件验证应用保护，不等同于真实输入法端到端验证。环境为 macOS、Node.js 24.15.0、本机 Chrome；未实测 Safari、Firefox、真实手机或屏幕阅读器。全部模型/凭证为测试夹具，无生产调用。分页数量级只覆盖测试规模，不宣称大型历史性能指标。

### 回归中修正的问题

- 首次提交创建会话会改变输入框 React key，导致失败时草稿与错误丢失：保持输入框实例，验证失败输入仍在。
- 启动初始化的“已生效”收据容易被视为后续资源操作成功：初始化使用独立生命周期收据，不混入用户管理结果，MCP OAuth 原场景复验通过。
- 新增时间和菜单按钮具有会话名称，原诊断测试的宽泛按钮选择器发生歧义：收窄为会话导航项，不降低诊断断言。

### 验证结果

- `npm run typecheck`：通过。
- `npm test -- --maxWorkers=2`：最终复验 41 个文件、237/237 通过（107.46s）。测试中的 storage diagnostic 为既有故障注入用例输出。
- `npm run test:browser` 首轮发现初始化收据和原诊断按钮选择器问题，同时跨日分页夹具页长不符合设定；修正后针对三项复验通过，最终构建上 `npx playwright test` 全量 34/34 通过（1.7m），未跳过用例或增加超时。
- `openspec validate --all --strict`：32/32 通过；`git diff --check` 通过。
- React 检查：请求序号隔离晚到响应，监听器与定时器在卸载时清理，目录读取与执行分开；保持输入框实例以保留首次创建后提交失败的草稿与错误，弹窗背景隔离和焦点恢复通过浏览器验证。无新增运行时依赖。

### 侧栏视觉反馈修订

根据实际截图反馈，将会话行从 62px 收紧为 52px，缩小分组和列表头留白；标题/时间共用左边缘，菜单/状态共用右边缘。选中行改为浅紫渐变、细边框与左侧强调线，完成/运行/取消/失败状态使用低饱和绿/紫/琥珀/玫瑰色标签，日期分组增加圆点及淡紫分隔线。菜单向左展开，避免较矮行高下遮挡下一行操作。

最终构建的真实浏览器测量：行高 52px，标题与时间左边缘均为 25px，菜单与状态右边缘均为 209px，第二行时间与状态底边均为 240px。桌面和 390px 窄屏状态夹具截图为 `output/playwright/session-navigation/sidebar-refined-{desktop,detail,mobile}.png`，已人工查看。`npm run build`、5/5 导航浏览器测试、32/32 严格规格校验与 `git diff --check` 通过；本次仅调整 CSS 和对应设计/任务记录，未重复运行无关后端测试。
