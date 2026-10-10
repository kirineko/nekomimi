# 核心源码候选

公开扩展无法完成的宿主行为修改需要核心源码候选。源码由用户明确选择，不能把安装包的类型、示例和 dist 当作完整源码；系统不会下载替代源码、重置用户仓库或覆盖当前安装。

## 准备独立副本

先准备存在的项目目录、目标副本的父目录，并查询实际安装的 CLI：

```sh
nekomimi core preview '{"source":"/absolute/nekomimi-source"}' --workspace /absolute/project --home /absolute/data
```

preview 只读实际文件，检查 package、lock、src/cli.ts 和构建入口，返回 source.revision、文件摘要、排除项以及 targetHost.build。源码版本不匹配时修正源码或选择匹配的宿主；版本字符串相同也不等于内容相同，实际内容基线始终单独记录。

```sh
nekomimi core prepare '{"source":"/absolute/nekomimi-source","destination":"/absolute/candidates/review-core","sourceRevision":"<preview 的 source.revision>","targetHostBuild":"<preview 的 targetHost.build>"}' --workspace /absolute/project --home /absolute/data
nekomimi core list --workspace /absolute/project --home /absolute/data
nekomimi core inspect '{"id":"<返回的候选 id>"}' --workspace /absolute/project --home /absolute/data
```

prepare 只接受不存在的目标目录，保留未提交及未跟踪的源码、空目录和可执行标记；目标目录、原源码、当前安装及数据目录相互隔离。副本完成后重新核对来源与副本摘要，来源变化会拒绝提交。Journal 保存候选 ID、原始基线、所属项目、目标宿主和目录身份。失败时保留部分副本用于诊断，不登记为已准备，也不会自动执行它。

`.git`、`node_modules`、`dist`、`.nekomimi`、`.npmrc` 以及 `.env`/`.env.*` 不复制；根目录的 reference、.harness、artifacts、output、test-results、playwright-report、coverage 和 *.tgz 同样排除，它们是研究资料、运行数据或生成产物，不是产品源码。实际排除项列在 baseline 中。它们不属于此次源码输入摘要；依赖必须按 lock 另行准备，凭证不得沿用。拒绝其他符号链接、特殊文件及超限输入；当前上限为单文件 8 MiB、总文件 256 MiB、文件和目录各 20,000 项、目录深度 32 层。

## 开发与验收边界

创造核心会话选择返回的候选目录，宿主从登记事实绑定候选 ID 和原始 sourceRevision，未登记目录不能作为核心开发目标。之后可以在副本修改代码；inspect 的 changed 表示已偏离准备基线，原始 Journal 基线不会重写。所属项目、目录身份或宿主构建不匹配时拒绝继续。

source-prepared 仅表示源码准备完成，built 和 applied 均为 false。构建、依赖生命周期脚本、独立启动、真实宿主验收及受控版本切换是分别授权和验证的阶段；读取候选或打开历史不会触发这些操作。

## 可信构建

```sh
nekomimi core build-plan '{"candidateId":"<候选 id>"}' --workspace /absolute/project --home /absolute/data
nekomimi core build '{"candidateId":"<候选 id>","inputHash":"<plan 的 inputHash>","commandId":"<本次唯一命令 id>","authorize":true}' --workspace /absolute/project --home /absolute/data
nekomimi core inspect-build '{"buildId":"<构建 id>"}' --workspace /absolute/project --home /absolute/data
```

build-plan 不执行项目脚本。它记录当前源码、原始基线、lock、目标宿主、Node 二进制摘要、配套 npm 的完整文件摘要、PATH、构建脚本、命令及预期协议/存储契约。用户检查后，build 的 authorize 才明确授权 npm ci 和 npm run build，包括安装、prebuild/postbuild 等生命周期脚本。依赖安装使用官方 registry；不继承项目或用户 npmrc、模型/API 凭证、NODE_OPTIONS 或代理环境。

构建在任务专属副本执行，HOME、临时目录和 npm cache 独立。它仍是可信 OS 进程，并非限制任意文件或网络访问的沙箱。Journal 先保存执行意图，再派发进程，输出分块作为附件持久化；已知凭证跨输出块脱敏。默认总时限 15 分钟，每个命令日志最多 8 MiB；超限停止并保留缺口说明。

取消向受管 POSIX 进程组发送 SIGTERM，1 秒后升级 SIGKILL，最多 5 秒确认。记录 exitCode、signal、cleanupScope 和 passed/failed/cancelled/unknown；不撤销已有副作用。没有可靠终态的已接受命令不会自动重跑，重复 commandId 只返回历史结果；不同输入复用 commandId 拒绝。当前构建清理支持 macOS/Linux，其他平台明确拒绝，不推断通过。

成功产物保存完整文件/目录/内部相对链接清单和摘要，包括安装后的依赖，同步落盘并设为只读后才提交成功事实。越界/绝对符号链接及与产物目录外共享的硬链接拒绝，避免固化产物时修改外部文件权限。npm/esbuild 生成的完整内部硬链接组在固化前复制为独立文件，字节和可执行标记保持不变。inspect-build 重新检查当前源码、lock、工具链和产物；变化后 validForCurrent=false。只读权限不是对可信本机用户的防篡改保证，摘要复核才决定结果能否使用。构建通过的 hostIntegration 仍是 not_run，applied=false；独立启动、协议/存储兼容及真实宿主验收另行完成。

## 独立候选启动检查

构建通过后，使用返回的确切产物 revision 显式授权独立检查：

```sh
nekomimi core validate '{"buildId":"<build-id>","artifactRevision":"<artifact-revision>","commandId":"<unique-command-id>","authorize":true}' --workspace /path/to/project --home /path/to/data
nekomimi core inspect-validation '{"validationId":"<validation-id>"}' --workspace /path/to/project --home /path/to/data
```

这是可信候选代码执行，仍具有当前 OS 用户权限。检查使用新建 HOME、数据、工作和临时目录，不继承凭证或 NODE_OPTIONS；探针禁止 fetch 外部请求，不提交模型任务或业务工具。它不是针对恶意代码的 OS 网络/文件沙箱。

当前宿主生成会话和 Durable commit 夹具，独立进程导入候选的真实服务与存储实现，检查 API/SDK/数据版本、实际 dist 字节对应的构建身份、Web 资源、无凭证状态、会话读写和重启、Durable commit 读写和恢复，以及旧格式拒绝。父进程再次核对旧数据全树 hash，使用当前宿主读回候选记录，并检查本机端口已关闭。默认总预算 60 秒，日志上限 1 MiB；取消/超时沿用有界进程组清理，未确认状态为 unknown。

结果阶段是 isolated-startup；hostIntegration 始终为 not_run，applied 为 false。真实本地服务检查不等于生产宿主或外部服务验收。失败保留部分报告与日志；已接受但无终态的命令不自动重跑。inspect-validation 重新核对构建输入和产物；源码、工具链或产物变化后，旧通过不再适用。此命令不切换安装，也不修改 PATH 或全局 npm 包。

## 托管启动与安装租约

普通 `nekomimi web` 或源码运行不是托管切换入口。先检查候选的启动信息：

```sh
nekomimi core launch-info '{"buildId":"<build-id>"}' --workspace /path/to/project --home /path/to/data
```

返回明确的 Node 可执行文件和参数数组，以及 currentMode=unmanaged、switchSupported=false。它不启动进程或创建安装注册，不修改 PATH、npm 全局安装或 shell 配置。源码入口和未支持平台只能使用明确的手动命令。

编译后的 Linux/macOS CLI 可通过通过验证的产物启动受管服务：

```sh
nekomimi core launch '{"validationId":"<validation-id>","artifactRevision":"<artifact-revision>","authorize":true,"port":0}' --workspace /path/to/project --home /path/to/data
```

该命令在前台运行父进程，取得安装级 Journal 写租约后启动候选 Web 子进程，核对实际构建身份及本机健康响应，再记录当前选择并输出浏览器地址。浏览器令牌只通过 IPC 传递并展示给调用用户，不写启动 Journal。生产数据目录保留原路径；它不是独立测试，必须明确授权候选执行。启动本身不会提交模型或业务任务。

安装注册位于当前用户 HOME 的 `.nekomimi/installations/<hash>`，hash 来自规范化后的安装 CLI 路径；不同工作区或 `--home` 不产生第二份安装租约，入口符号链接也不能绕开。父进程在整个服务生命周期持有租约，第二个同安装启动返回 busy。SIGINT/SIGTERM 请求有界终止所属进程组；父进程 IPC 断开时子进程停止服务，模块加载阶段失联则不再启动服务。无法确认清理时报告 unknown。

## 运行中的候选切换

托管 Web 服务提供需要浏览器认证的 `/api/v1/core/status`、`preview`、`switch` 和 `receipt` 控制入口。普通 Web 启动仅能查询实际身份，切换请求明确拒绝。工作台顶部展示服务返回的实际构建；刷新失败时显示“运行版本待确认”，不把缓存身份当作当前版本。

新候选必须绑定当前运行子进程的宿主身份。使用 status 返回的 `identity.entry` 对应 CLI 准备、构建和验证后，POST preview 的 `{ "validationId": "<id>" }` 返回当前宿主、目标构建、产物 revision、数据/工作目录、契约及影响范围对应的 `planHash`。独立检查还须通过 `core-switch-control`：验证新服务启动时先关闭业务写入，以及父进程控制接口可达。

检查预览后，POST switch 明确提交 `commandId`、`validationId`、`artifactRevision`、`planHash` 和 `authorize: true`。父进程取得构建/验证派发写租约并关闭 HTTP 与会话写入口，检查全部工作/创造任务、命名、审批、工作流和未确认清理；任何阻碍都拒绝切换，重新确认前不会强行终止任务。通过门禁后再核对预览并持久保存意图，停止旧服务，在相同端口启动受控的新服务，核对实际身份和健康响应后记录选择与收据。不覆盖安装文件、PATH 或全局 npm 包。

旧 HTTP 连接可能在切换时断开。使用 GET receipt 的 `commandId` 查询收据，或以完全相同的命令内容重发；不会重复启动宿主。复用同一 ID 但改变确认内容会拒绝。已接受且没有确定终态的命令返回 unknown，不自动重新执行。

构建或独立验证通过仍不等于已应用。只有切换收据 `status=applied` 才确认该切换完成，当前实际运行身份另查 status。目标启动或健康检查失败时，只有旧进程和失败候选都确认清理后，才尝试恢复保留构建。先复核旧产物完整性，再由旧版本自身的只读读者核对当前数据格式、工作区身份和 Journal；不兼容、缺少检查协议或清理未知则保留数据和构建，进入 recovery-required，不强行回退。成功恢复旧服务时，切换收据仍为 failed，actualBuild 报告实际旧构建。

## 恢复检查、对账与显式启动

`nekomimi core recovery-info` 只读安装 Journal，报告最后和前一个已确认选择、无终态切换、记录进程组的观察结果及 planHash。历史 selected 仅表示过去通过过启动检查；`running=not-observed` 不表示当前版本已确认运行，也不证明没有未记录的进程。读取不加载候选、不打开业务存储、不发信号。

`nekomimi core reconcile '{"commandId":"<unique-id>","planHash":"<recovery-info hash>","authorize":true}'` 取得安装写租约并复核同一计划，仅追加一条元数据对账收据。活跃 writer、记录进程组仍存在、无法观察或派发意图缺少 PID 观察时拒绝。重复命令返回原收据，无终态切换仍为 unknown，不编造应用成功，不重新执行候选或业务任务，不改动数据格式。此命令仅做元数据对账，服务恢复使用下面的独立确认。


```sh
nekomimi core recover-plan '{"selection":"last"}'
nekomimi core recover '{"selection":"last","commandId":"<unique-id>","planHash":"<recover-plan hash>","authorize":true}'
```

selection 可选 last 或 previous，分别指最后已确认构建和之前不同的已确认构建；重复恢复同一构建不覆盖 previous 引用。计划绑定安装历史、所选产物、目录、原端口和存储检查。恢复时保留构建/验证派发 writer 并取得安装租约，再次核对同一计划，以业务门禁关闭的状态启动候选，再检查实际身份和本机健康。候选自己的只读存储检查先于可写服务初始化；存储不兼容、Journal 有未完成写入、进程清理未知或任务门禁未通过时明确拒绝，保持只读恢复，不自动修复或迁移业务数据。

恢复从已有不可变产物启动，不重新执行源码构建、候选验证或未确认业务任务，也不要求旧源码和工具链仍存在。成功时与 core launch 一样前台运行并输出新的浏览器连接地址；地址含连接凭证，请只在本机使用。相同恢复 commandId 不重复启动；已接受但缺少终态返回 unknown，须先检查事实，再以新的明确计划决定下一步。历史 started 收据不证明服务此刻仍运行，当前状态需访问实际服务。
