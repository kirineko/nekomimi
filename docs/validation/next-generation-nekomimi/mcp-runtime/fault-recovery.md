# MCP 故障恢复门槛（6.6）

2026-10-07，macOS arm64，Node.js 24.15.0；固定 Pi MCP 1.0.4 公开接口。验证对象为未提交工作树，精确文件 hash 见 fault-manifest.json。

## 行为与证据

- 真实本地 HTTP 服务收到 tools/call 后增加副作用计数，直接销毁响应连接。实际 Durable/Codemode 管线记录子调用 unknown；脚本显式捕获后成功提交本地 remoteOutcome=unknown。重新创建宿主、发现和续跑后远端计数仍为 1，原调用 intent 仍仅一项。
- 既有部分失败测试继续验证：成功文件写入、失败分类、远端副作用后取消分别保留；失败脚本不提交状态，重启不重跑。
- stdio 夹具保持事件循环且忽略 SIGTERM，并写入收到信号的证据。关闭期间 cleanup=pending；公开 transport 执行终止升级，宿主再核对 POSIX 进程组消失，随后才报告 completed。
- 清理有界（transport 最多等待 5 秒，存活检查最多 2 秒）。POSIX 包装进程先退出时，对同一所属组补充强制清理。Windows 不声称验证整个进程组；仅记录 process 范围。
- 注入 client.close 失败时，原 socket lost/UNKNOWN 与清理失败同时保留，重复关闭不会误报成功。catalog 提供独立 cleanup 状态，运行内直接及发现调用将清理结果写入关联工具的 mcp.cleanup Journal 事实。

## 验证

- fault-tests.log：初次定向 3 文件 9 项通过。
- fault-regression.log：最终 6 文件 23 项通过，覆盖故障恢复、既有 MCP、脚本部分失败、按需发现、快照和 OAuth 轮换。
- fault-types.log / fault-build.log：类型检查和构建退出码均 0。
- fault-specs.log：严格规格检查 43 项通过；git diff --check 通过。

测试使用本地服务和合成凭证，没有调用真实模型。Linux 运行记录留在 11.8，Windows 按项目要求暂缓；本报告不以 macOS 结果代替其他平台验收。
