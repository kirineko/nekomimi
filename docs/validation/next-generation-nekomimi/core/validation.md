# 核心候选独立启动（任务 8.3）

环境：macOS arm64 / Node v24.15.0。基线 commit be50c5a8a1557ef160056b964cd29e65b395685d，验收对象为未提交工作树，文件摘要另见 validation-manifest.json。

## 实现范围

- core validate 要求可信执行授权、buildId、产物 revision 和唯一 commandId；派发前后复核当前源码、工具链和产物。core inspect-validation 只读返回当前适用性。
- 意图先进入 Journal，事件关联 candidateId 和 validationTaskId；完成命令返回原收据，已接受但无终态返回 unknown，不自动重启。
- 独立 HOME、临时目录、数据和工作区；不继承 API/NPM 凭证、NODE_OPTIONS、代理或其它宿主环境。探针禁用外部 fetch，不提交模型/工具任务。可信候选仍有当前 OS 权限，明确不是恶意代码安全沙箱。
- 当前宿主写入会话及 Durable Journal commit；宿主子进程探针加载候选的实际编译模块，核对 API/SDK/数据版本及 dist 全树内容对应的构建身份，检查 Web HTML/资产、本机 API、无凭证配置、会话读写/重启、Durable 读写/重新打开和旧格式拒绝。
- 父进程独立检查旧目录全树内容不变、当前宿主读回候选记录、无业务执行和已观察端口关闭。总预算 60 秒，输出上限 1 MiB，沿用受管 POSIX 进程组 TERM/KILL 和有界清理证据。
- stage=isolated-startup，hostIntegration=not_run，applied=false。合成数据夹具下运行真实本机候选服务，不称为真实模型/外部服务/生产宿主验收；不切换活动安装。

## 定向验证

validation-complete.log：4 文件 19 项通过，覆盖真实候选启动、跨宿主 Durable 与会话存储、旧目录篡改检测、协议不兼容、伪造构建身份、外部 fetch 拦截、取消及 PID/进程组清理、命令冲突/未知结果不重跑，以及已有真实 npm 构建与 CLI 回归。

validation-types.log、validation-build.log 退出码 0；validation-specs.log 严格校验 43 项通过；git diff --check 通过。

## 真实源码闭环及发现的修复

scripts/core-candidate-smoke.mjs 从当前实际源码准备独立候选，通过正式 CLI 执行 npm ci、npm run build、产物固化、启动验证、相同命令重复读取和 inspect-validation。临时目录保留原始 Journal、进程输出及完整收据。

validation-source-first.log 保存首次实际源码构建失败：依赖和编译都通过，但 npm/esbuild 安装脚本生成了目录内硬链接，原固化策略全部拒绝。修复为预检所有链接组，只有链接总数完全属于当前产物的内部组才能复制成独立文件；与目录外共享的硬链接继续拒绝。内容及可执行标记在固化后全树复核。已有外部硬链接保护测试和新增内部拆分测试均通过。

真实源码第二轮通过，见 validation-source-complete.log 和 validation-source-receipt.json：构建 88e509a8-65a8-454e-8660-2ae05e7d22e7，验证 edf13a22-b4f8-4517-9d9c-87bdfac895c4，产物 revision 87716ab9aa0378ce746a3913a4b249bd1c7c836750aed01dc7da07d58e0e7277。实际两次 HTTP 服务端口 50531/50536 均关闭，重复验证命令返回完全相同的收据，inspect-validation 当前适用性为 true。Linux 和最低 Node 验收保留到最终平台矩阵；Windows 仍明确暂缓。不调用真实模型，不改 PATH 或全局安装，不发布。
