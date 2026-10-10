# 移除调试分支后的最终平台验收

最终固定产物：archive SHA-256 `4e4e5a20223da0de09995ca59ccc615787620356f956fa71def84021acaa2135`；build `f7424580c8a12f881340ca43507c425c011e0f790cb7c566c67e0acf619eb2a3`。见 [artifact.json](artifact.json)。此前 [platform-final](../platform-final/README.md) 是移除 HTTP 原始异常调试分支前的历史证据，不能替代本轮新包。

## 已定位的共享文件系统失败

新包首次 Linux Node 24 使用宿主 `/tmp/nekomimi-linux-pack-data` 绑定容器 `/tmp`，快照 HTTP 500 再次出现，见 [linux24-shared-failure.log](linux24-shared-failure.log)。仅在该临时已安装副本中加入原始异常诊断后，第一轮便复现：`JournalReader.update` 打开 `durable.json` 得到 ENOENT，见 [linux24-isolated-diagnostic.log](linux24-isolated-diagnostic.log)。这个临时副本被修改过，**仅用于诊断，不作为安装通过证据**；最终 tarball 未被修改。

独立探针仅循环 writeFile 临时文件→rename 替换固定文件，并同时 readFile 固定文件，从不删除目标路径：

| 文件系统 | 原子替换 | 成功读取 | ENOENT |
| --- | --- | --- | --- |
| OrbStack 的 macOS 共享挂载 | 5000 | 63420 | 2219 |
| Linux 容器原生 `/var/tmp` | 5000 | 90962 | 0 |

原始结果见 [rename-probe.log](rename-probe.log)。这直接复现了快照异常所需的路径短暂缺失；问题不由模型或工具运行引起。生产 Journal 不降级水位或吞掉存储错误，也不靠自动重跑副作用补偿。Linux 正式验收改用原生容器 `/tmp`；仓库/tarball 仍只读挂载，npm 下载缓存可共享，因为它不保存运行 Journal。共享挂载不纳入本轮可靠存储通过范围。

## 当前验收

四组均执行同一个 `scripts/pack-smoke.mjs` 与同一 tarball，原断言/超时保留。四组均已通过（exit 0），见下表。无真实模型调用，Windows 按项目决定暂缓；Linux 范围为 aarch64 / Debian bookworm / OrbStack，不是 Linux 图形浏览器或 x86_64 全套。

| 平台 | Node | 完整安装结果 |
| --- | --- | --- |
| macOS arm64 | 24.15.0 | [通过](macos-24.15.0.log) |
| macOS arm64 | 22.19.0 | [通过](macos-22.19.0.log) |
| Linux aarch64 原生容器文件系统 | 24.15.0 | [通过](linux-24.15.0.log) |
| Linux aarch64 原生容器文件系统 | 22.19.0 | [通过](linux-22.19.0.log) |

每组包含 CLI/全局 Web、离线导入导出、完整 SDK 3 文档与资产、Codemode VM、Provider/MCP/持久工作流、候选安装/回退、22 次模型 fixture 请求的工作→创造→交付→工作闭环（v1/v1/v2/v2）、重启/停用及 Durable 崩溃 unknown 不重跑。命令驱动见 [platform-runner.py](platform-runner.py)，退出码见 [macOS](macos-results.json) / [Linux](linux-results.json)。此前两个不同产物的共享挂载失败保留，不计为原生 Linux 通过证据。

Linux 镜像仍为先前已拉取的官方 Node bookworm 镜像，digest 见 [Node 22](../platform-final/image22.log) / [Node 24](../platform-final/image24.log)。独立探针的等价复现脚本见 [rename-probe.mjs](rename-probe.mjs)。没有真实模型调用、上传、提交或发布。

## 最终已安装浏览器复核

macOS arm64 / Node 24.15.0 / Chromium 154.0.8037.98，实际消费本轮安装目录 `harness-pack-InXByQ/node_modules/nekomimi`。高亮 worker、上下文、证据、文件/变更、HTML 导出、核心恢复、10 个管理路由及候选差异均通过；47 个资源请求无缺失，零页面错误，Journal 不变。见 [installed-browser.json](installed-browser.json) / [日志](installed-browser.log)。不是开发源码服务的替代记录。
