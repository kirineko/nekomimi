# 正式 Codemode 沙箱与安装资产（任务 5.1）

2026-10-07，macOS arm64 / Node 24.15.0。固定 `@earendil-works/pi-codemode` 1.0.4，lock 中固定其 quickjs-wasi 3.6.2。仅从公开包入口及 worker export 解析运行资产；未使用 reference、源码 alias 或内部 import。依赖自己的发布包携带 worker/WASM，Nekomimi 安装包声明精确依赖。

`src/pi/codemode.ts` 提供宿主适配：默认总时限 30 秒、QuickJS 内存 16 MiB、源代码 256 KiB；调用者只能缩短时限，不能传 Infinity。使用固定版本的输出上限 16 Mi 字符／100,000 项，单状态值 256 Ki 字符／总状态 1 Mi 字符。字符和 UTF-8 字节单位分别标明，执行限制可通过 CODEMODE_LIMITS 查询。无 globals 宿主后门，只允许显式注入工具。每次执行创建独立 VM，关闭会取消在途脚本。

`test/codemode-sandbox.test.ts` 三项综合场景通过：process/fetch/require/WebAssembly/timer 不可用，动态模块导入失败，跨 VM 不共享全局或临时状态；无限循环、内存和输出压力有界失败，保留可用输出，宿主计时器仍响应；运行中取消、无限时限及源代码／状态超限被拒绝。`types-first.log`、`build-first.log`、`sandbox-first.log`、`specs.log` 保存类型、构建、三项测试及 43 项严格规格结果。

`installed.json` 保存本轮 npm tarball integrity、文件列表和独立安装目录；`installed.log` 记录从 tarball 安装后真正运行 VM、worker/WASM 及 CPU 超时/宿主响应检查通过。`scripts/pack-codemode-fixture.mjs` 已接入常规 pack-smoke，后续完整安装包验收会重复这个门槛。本轮只运行独立沙箱安装验收，不冒充完整 CLI/Web pack-smoke 或 Linux/最低 Node 综合回归。

本项完成沙箱基础。模型脚本入口与嵌套管线由 5.2 接入，调用预算／同文件序列化／unknown 收敛由 5.3 验证，持久小状态与输出图片投影由 5.4 实施；这些不能用沙箱成功结果代替。
