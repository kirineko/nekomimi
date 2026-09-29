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

## 统一平台 SDK 与运行时 UI（2026-09-28）

完整主题、六类运行时扩展区域、受控桥接、SDK/文档整合及 `/moe` 内容展示的验收记录见 [runtime-ui-validation.md](runtime-ui-validation.md)。包括全量回归、安装包检查、截图路径、资源修订证据及未验证环境。

## 输出预算与紧凑顶栏（2026-09-28）

实际未完成原因、128K/64 轮默认值、错误提示、主题化菜单/导出与验证边界见 [response-recovery-header-validation.md](response-recovery-header-validation.md)。

## 会话连续滚动稳定性（2026-09-30）

变更：`stabilize-conversation-scrolling`。滚动位置统一由 `useConversationScroll` 管理；锚点使用内容布局坐标缓存及当前滚动位置，取消旧模式切换时的无条件恢复。会话切换清理观察器、帧任务与输入状态；新的手动浏览使等待中的返回最新请求失效。底部跟随判定从 48px 收紧为 2 CSS px，返回入口浮层不占聊天视口高度。旧窗口末尾的分页区域保留局部滚动余量，保证“查看较新”不被浮层遮挡，最新窗口没有该占位。

### 复现与测量

macOS 26.6.2、Node.js 24.15.0、Chrome 154.0.8037.58；桌面 1440×1000 CSS px。240 条合成历史，分别加载 60/180 条窗口，包含长 Markdown、代码、模拟 diff 与带实际 iframe/MessageChannel 握手的延迟面板。Journal 数据和 HTTP fixture 均为合成数据，无真实模型调用、凭证或工具副作用。

修复前真实 wheel 输入复现：离开底部使视口从 **762px 变为 725px**；滚至预期距底部 30px 时最终距离为 **0px**。修复后视口维持 **762px**，距离保留 **30px**。旧锚点回拉是静态排查发现的风险，未将其单独列为修改前已实测复现的根因；修改后的连续往返与导航隔离已有自动回归。

同机前后短时采样（静态约 0.8s，流式约 1.8s；原始逐帧数据含实际时长）：

| 场景 | 帧间隔 p95，前 → 后 | 脚本累计耗时，前 → 后 | 布局累计耗时，前 → 后 |
| --- | --- | --- | --- |
| 60 行静态 | 16.7 → 16.8ms | 3.65 → 5.05ms | 0.178 → 0.166ms |
| 180 行静态 | 16.8 → 16.8ms | 2.73 → 2.64ms | 0 → 0ms |
| 180 行、6 次历史更新 | 16.7 → 16.7ms | 19.78 → 18.49ms | 0.255 → 0.199ms |

以上采样均未出现超过 50ms 的长任务；小幅耗时差异不足以宣称普遍性能提升。主要改进证据是位置跳动消失，并非 FPS 提升。流式场景未出现需要扩大重构的渲染瓶颈，因此本变更没有修改消息 Context 或 Markdown 渲染架构。

原始基线与对照记录见 `output/playwright/scroll-before-final.json`、`output/playwright/browser-full-final.json`；提交保留的采样附件见 [scrolling-samples.json](validation/scrolling-samples.json)。前后采样均先完成本地认证，再进入目标会话，避免首次认证期间无关提示影响视口。旧版基线从 HEAD 中恢复改动前的三个前端文件，在临时目录独立构建，不回滚工作区。

### 行为覆盖与边界

- 逐帧验证连续 wheel 上下换向，无超过 2px 的非输入反向位移；键盘 End/PageUp、真实底部与旧窗口底部判定分别覆盖。
- 覆盖上方内容增长、布局变化与用户移动同帧发生、历史中新消息、任务完成/失败/取消，不将合法锚点补偿误判为滚动跳动。
- 覆盖分页失败重试、窗口裁剪、返回最新等待中再次浏览、会话切换及迟到响应。
- Chrome CDP 触摸输入：按住 700ms 后移动并释放；鼠标按住原生滚动条 750ms 后拖动。原生滚动条测试单独关闭无头模式默认的 `--hide-scrollbars`，而非用赋值模拟拖动。
- 窄屏 390px 和 900px、根字号 20px 下验证浮层尺寸、键盘焦点、外部透明区域穿透；横向代码滚动不改变会话模式。
- 使用真实 Chrome 的自动化输入；不是物理触控板、真实手机、操作系统缩放或 Safari/Firefox 验收。帧率结果只适用于本次固定环境与合成规模。

### 检查结果

- `npm run typecheck` 与 `openspec validate --all --strict` 通过，严格规格校验 42/42。
- `npm test` 默认并发首轮 312/314 通过，扩展工作流与 Git 对象历史大小检查各出现一次 30s 超时；保持原超时与断言，`npm test -- --maxWorkers=2` 全量复验 **52 文件、314/314 通过**（139.00s）。未修改这两个后端用例或测试超时。
- React 检查：滚动控制使用瞬时引用；监听器、观察器、动画帧和收尾计时器随会话切换/卸载清理；新的浏览意图使迟到返回请求失效；没有新增运行时依赖。

- `npm run test:browser -- --reporter=list,json`：最终构建全量 **57/57 通过**（2.5m），包含新增 12 项滚动回归；快速换向历史导航另连续复验 5/5 通过。前轮发现的运行时 UI 层级选择器、分页异步布局等待及程序滚动标记竞态已修正，未跳过测试或放宽位置容差。
- 已查看浮层截图 `output/playwright/scroll-overlay-390.png`、`scroll-overlay-900.png`；`git diff --check` 通过。

### 自然滚动交互修订

根据用户反馈移除“有新消息”提示和待点击展示路径：最新窗口继续接收消息，用户在底部时自动跟随，上翻时保留当前阅读位置；向下滚动即可读取已追加内容。历史窗口达到 180 行时保留阅读侧记录，用户向下到底自动按 after 游标接续后续页，不跳过中间记录。“返回最新”仅为可选快捷操作。

新增浏览器用例实际通过键盘滚动读取新消息，不点击返回入口；覆盖直接追加、历史窗口上限、自动接续和恢复跟随。已有长回复用例改用 End 读取新消息并确认下一条消息自动跟随。重复验证追加时的锚点以及自然接续两项场景，6/6 通过。原生滚动条、触摸输入及物理设备覆盖边界沿用上文。

自动接续后若内容很少，浏览器可能已将位置限制在底部，继续向下输入不会产生 scroll 事件；滚动协调器也处理该输入，避免漏掉后续加载或恢复跟随。新内容保持既有实时/回放边界，浏览历史时不会自动激活历史面板。

本次修订验证：构建、类型检查与严格规格校验 42/42 通过；完整浏览器运行 57/58 通过，唯一失败为长历史用例仍查找已取消的“有新消息”文案。仅更新该用例的按钮选择器并新增旧提示不存在断言后，同一构建上连续复验 3/3 通过，其余 57 项无需重复。未改后端，沿用前轮 314/314 单元测试结果。

本次自然滚动采样：60/180 行静态 p95 均 16.7ms，180 行持续更新 p95 16.8ms，无超过 50ms 的长任务；返回入口显隐的视口高度仍为 762px，距底部 30px 不提前吸附。原始输出为 `output/playwright/natural-scrolling.json`，采样附件以 `natural/` 前缀补充到 `docs/validation/scrolling-samples.json`，与上文第一版修复结果分开保存。

## 工作区文件与目录引用块

`add-workspace-reference-chips` 已完成，详细覆盖、截图路径和性能样本见 [工作区引用块验证](workspace-references-validation.md)。单元测试 322/322；完整浏览器 64/65，修正唯一失败用例的 HTTP 成功状态断言后同一构建复验 3/3，65 项均验证完成；类型检查和严格规格校验 42/42 通过。
