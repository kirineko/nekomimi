# 中断诊断

此变更先补齐故障证据，不假定 Windows 中断由文件占用造成，不加入存储重试或自动重复工具。

## 如何采集

1. 安装包含此变更的预览包，在原项目目录运行 `nekomimi web`，保留终端。
2. 正常使用，发生中断后展开页面上方“检测到运行异常”，点击“下载诊断”。该文件与普通会话导出分开，请同时提供两者。
3. 若页面无法连接，复制终端中包含 `nekomimiDiagnostic` 的 JSON 行。请不要提供 API key 或配置文件。
4. 同时说明是否关闭/重启终端、按下 Ctrl+C，以及是否运行了多个服务。强制杀进程不保证留下诊断。

## 记录位置和字段

辅助诊断保存在用户数据目录对应工作区的 `sessions/<session-id>/diagnostics/<diagnostic-id>.json`。每个故障使用独立文件；旧会话没有该目录仍可正常读取。文件不作为 Journal 历史、不进入模型请求，也不用于恢复工具执行。

字段包括时间、平台、Node 版本、会话/运行/attempt 标识、最后写入序号 `seq`、已确认序号 `durableSeq`、`operation`、`code` 和 `syscall`。没有错误正文、调用参数、文件内容、环境变量、API key 或绝对文件路径。错误码不存在时字段省略，不猜测系统原因。

- `journal.append` / `journal.sync`：日志追加或同步失败。
- `watermark.open/write/sync/rename/directory-sync`：持久化确认文件对应阶段失败。
- `artifact.*`：证据附件保存阶段失败。
- `journal.lock` / `journal.lock-acquire`：租约失效或获取失败。
- `background.run` / `background.naming`：未能写入正常结束记录的后台异常。

辅助写入失败时 stderr 仍保留首条诊断，并输出 `nekomimiDiagnosticWriteFailed`。完全不可写磁盘、强制退出或终端输出失效仍可能导致信息缺失。

## 当前证据与限制

Windows 现场旧导出包含 13 轮任务，其中 4 轮缺少结束记录、6 次尾部恢复；20 次有结束记录的模型调用全部成功。至少一次退出码为 0 的 PowerShell 完成事件位于未确认尾部。完整性校验通过。

本地注入持久化失败可复现相同恢复形态，这证明该链路能产生此现象，并不能证明现场实际发生了 EPERM 或 rename 失败。下一步根据新诊断定位原始故障，再建立针对性修复和原生 Windows 回归。
