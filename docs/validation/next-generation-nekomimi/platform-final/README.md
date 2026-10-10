# 11.8 最终同包平台验收

2026-10-09；未提交工作树，基线 HEAD `be50c5a8a1557ef160056b964cd29e65b395685d`。全部测试使用离线模型 fixture。

## 固定产物

四个平台/Node 组合安装同一 `nekomimi-0.2.1.tgz`，archive SHA-256 `96e1029818569808f956eed34cc3cf522427417e90898b5ad6770334334e0632`，宿主 build `b136be4b97794a0e20b4583c0dd03b08e00494bed814026d965cae67362b1362`。见 [artifact.json](artifact.json)、[npm-pack.json](npm-pack.json)。打包使用独立临时 npm cache；没有提交、标签或发布。

## 实际结果

| 平台 | Node | 完整 pack-smoke | 原始记录 |
| --- | --- | --- | --- |
| macOS arm64 | 24.15.0 | 通过 | [macos24.log](macos24.log) |
| macOS arm64 | 22.19.0 | 通过 | [macos22.log](macos22.log) |
| Linux aarch64 / Debian bookworm / OrbStack | 22.19.0 | 第二轮通过 | [linux22.log](linux22.log) |
| Linux aarch64 / Debian bookworm / OrbStack | 24.15.0 | 诊断复跑通过 | [linux24.log](linux24.log) |

每组均包含本地/全局安装、CLI、只读导入导出、真实 Web 静态资源及 shell 工作目录、SDK 3 指南、Codemode worker/WASM、Provider/MCP/持久工作流、候选二进制素材，以及工作→受记录创造→失败保留 v1→修复 v2→项目授权安装→重启→停用闭环。创造夹具每组 22 次本地模型请求，工作命令版本依次 v1/v1/v2/v2。Durable 故障夹具验证崩溃后不会重跑未知副作用。

macOS Node 22 使用官方独立分发包并核对官方校验表，未替换系统 Node。Linux 使用官方 `node:22.19.0-bookworm` 与 `node:24.15.0-bookworm`；镜像 digest 见 [image22.log](image22.log) / [image24.log](image24.log)。容器只读挂载仓库和 tarball，安装与测试目录独立；后续 Linux 目录保留在 `/tmp/nekomimi-linux-pack-data`。

## 首次失败和诊断边界

- Linux 22 首次全局 Web 任务在原 200×100ms 轮询门槛超时，见 [linux22-first-failure.log](linux22-first-failure.log)。未修改生产代码、断言或门槛，原夹具完整复跑通过。首次容器未保留临时目录，因此无首次 Journal 可供诊断。
- Linux 24 首次全局 Web 快照返回 HTTP 500，见 [linux24-first-failure.log](linux24-first-failure.log)。失败目录 `harness-pack-c9RcH5` 保留；Journal 显示模型请求前，由夹具失败清理触发取消，不能据此推断模型/工具错误。
- 为取得失败原因，验收驱动的错误消息增加请求路径和已捕获服务输出，诊断运行启用 `NEKOMIMI_DEBUG_HTTP=1`，安装包不变。完整复跑以及另外 10 个独立临时工作区的全局 Web 闭环均通过，见 [linux24-global-repeat.log](linux24-global-repeat.log)。原始 HTTP 500 未再次出现，**根因仍未确认，未宣称已修复**。首次测试同时有宿主回归负载，但负载不是已证实原因。

## 已安装浏览器资源

macOS Node 24 / Chromium 154 针对实际安装目录执行 `scripts/pack-optional-browser.mjs`：Markdown、TypeScript 高亮 worker、上下文、调用证据、文件/变更、HTML 导出、核心恢复、10 个管理路由和候选差异等实际浏览器断言通过；47 个资源请求无失败，原 Journal 不变。见 [installed-browser.json](installed-browser.json)、[installed-browser.log](installed-browser.log)。不是只对源码开发服务验收。

## 范围限制

Linux 为 aarch64 容器，不是 x86_64 或 Linux 图形浏览器验收；macOS Node 22 与 Linux 两组未运行完整源码单元/浏览器套件。Windows 按项目决定暂缓。fixture 不代表真实模型质量、成本或图片能力实测。平台任务完成表示所需平台记录已交付，包含以上首次失败和未确认根因。
