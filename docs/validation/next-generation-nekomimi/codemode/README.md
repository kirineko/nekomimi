# Codemode 统一管线与安装资产验证

任务 1.5 完成：macOS arm64 / Node 22.19.0、24.15.0，最终独立安装 tarball 中的 8 项测试均通过。结果见 `final-runs.json`、`node*-final.log` 及各场景 JSONL。

`codemode.test.mjs` 将直接调用和沙箱嵌套调用都交给公开 `runToolCall`；每个调用固定身份、父关联、版本和参数，恰好一次授权/intent/after-hook/result，intent 经 fsync 后才执行。另验证撤权、schema 拒绝、intent 失败、成功子调用后脚本失败、预取消、成功 storeWrites 的显式提交接口，以及无宿主 I/O、CPU/内存/输出上限。

## 安装验证

在临时目录复制 package.json、测试、worker wrapper 和已发布 quickjs-wasi 的 wasm，npm pack 后在另一个目录从 tarball 安装，使用包内 worker.mjs 和 wasm 真正启动 VM。`pack-corrected.json` 记录四项资产和 integrity；`consumer-lock-corrected.json` 固定依赖。本例不是生产 Nekomimi tarball；批次 1/3 仍需完成实际打包接入。

最终命令是直接用 Node 执行安装包内 node:test 文件，路径见 `runs.json`。初次 `node --test` 排除了 node_modules 内测试路径，随后发现自编探针少一个对象闭合括号；旧命令/pack/日志保留，修正后重新打包安装，而非直接改安装目录使其通过。

## 边界

沙箱 schemas 只提供声明，必须借宿主管线校验。memoryLimitBytes 默认为无额外限制，本切片显式设16MiB；3秒默认执行预算，CPU压力测试覆盖100ms终止。这些是测试参数，不是未经测量的产品默认值。

本轮证明接入可行性，不代表生产实现完成。同文件新鲜度/并发队列、远端 unknown 收敛、未 await 远端副作用、图片附件持久化、会话/分支状态恢复仍由 tasks 5.1–5.8 验收。没有真实模型调用。
