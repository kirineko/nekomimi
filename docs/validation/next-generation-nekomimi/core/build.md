# 可信构建与不可变产物（8.2）

2026-10-07 至 2026-10-08，macOS arm64 / Node.js 24.15.0，未提交工作树。

## 实现

- build-plan 只读生成输入 manifest：候选及当前/原始源码 revision、lock hash、目标宿主、Node 二进制 hash、配套 npm 完整文件树、PATH、固定命令、构建脚本及预期 API/SDK/数据契约。
- build 必须明确 authorize=true、inputHash 和 commandId；静态检查及未授权请求不执行项目脚本。实际执行 npm ci 和 npm run build，包括声明的生命周期脚本。
- 使用独立源码副本、HOME、临时目录、npm cache 与空白 npm 配置；源码 .npmrc 不沿用，环境不继承模型/API 凭证或 NODE_OPTIONS。可信脚本仍有 OS 权限，不称为沙箱。
- 每个进程派发前先提交意图；记录 PID、进程组、输出附件及真实 exit/signal。输出背压、跨块凭证脱敏、每命令 8 MiB 上限和 15 分钟总预算生效。
- 取消处理受管 POSIX 进程组，TERM 后 1 秒 KILL，最多 5 秒确认；明确 cleanupScope，不能确认则 unknown。已接受但缺失终态的 commandId 不再次执行；重复完成命令返回原收据。
- 产物全树包含实际安装依赖、文件/目录及内部相对链接。拒绝逃逸/绝对链接和硬链接；文件与目录同步落盘并只读固化后再记录成功。manifest 作为 Journal 附件保存。
- inspect-build 复核 manifest、当前源码/lock/工具链及产物；变化使 validForCurrent=false。构建结果与独立启动、真实宿主验收和应用状态分开，hostIntegration=not_run、applied=false。

## 验证

build-final.log：4 文件 24 项通过；build-cli-final.log：最新正式 CLI 1 项通过，共 25 项不同相关测试。
覆盖真实 npm postinstall/build、未授权零效果、输入确认过期、构建期间编辑、lock/PATH 改变、产物篡改、跨块脱敏、输出限额、真实取消与忽略 TERM 的子进程、非零退出、未知终态不重跑、重复命令无新效果、外部符号链接/硬链接拒绝、源码和会话准入回归。
CLI 验证 build-plan → 未授权拒绝 → 明确授权构建 → inspect-build；失败脚本在静态准备阶段没有执行。
build-types.log 与 build-build.log 退出码 0；build-specs.log 严格规格 43 项通过；git diff --check 通过。

## 保留的失败证据

build-first.log 为新测试语法错误，修正后执行真实夹具。
build-runtime.log 保存两个初始失败：macOS 不允许在根目录移除写权限后移动该目录；Journal 附件路径使用临时目录别名被安全检查拒绝。修正为先移动再固化根目录，附件读取使用规范 Journal 目录，未放宽权限或附件校验。
build-verified.log、build-regression.log、build-complete.log、build-durable.log 保留修正及后续落盘强化的阶段性验证。

本项只构建临时无外部依赖夹具，不构建或切换当前真实安装，不发布，不调用真实模型。Linux 实测保留至最终平台矩阵；Windows 构建清理路径明确拒绝。8.3 的独立启动/健康/协议/存储验收尚未完成。
