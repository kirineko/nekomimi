# 11.8 平台与 Node 验收记录

2026-10-09。最终 tarball archive SHA-256 `4e4e5a20223da0de09995ca59ccc615787620356f956fa71def84021acaa2135`，build `f7424580c8a12f881340ca43507c425c011e0f790cb7c566c67e0acf619eb2a3`。精确命令和原始日志见 [最终平台证据](platform-clean/README.md)。

| 平台 | Node | 安装与运行 | 完整源码单元/浏览器 |
| --- | --- | --- | --- |
| macOS arm64 | 24.15.0 | 最终同包完整夹具通过 | 最终单元 788/788；最终浏览器 201/201 |
| macOS arm64 | 22.19.0 | 最终同包完整夹具通过 | 未运行此 Node 下完整源码套件 |
| Linux aarch64（OrbStack / Debian bookworm，原生容器数据目录） | 22.19.0 | 最终同包完整夹具通过 | 未运行 Linux 源码全套或图形浏览器 |
| Linux aarch64（OrbStack / Debian bookworm，原生容器数据目录） | 24.15.0 | 最终同包完整夹具通过 | 未运行 Linux 源码全套或图形浏览器 |
| OrbStack macOS 共享挂载作为 Linux Journal 目录 | 24.15.0 | **可靠存储验证失败**；原子 rename/并发读探针复现 ENOENT | 不是通过其它平台测试即可忽略的限制 |
| Windows | 全部 | 按 AGENTS 与 delta 暂缓 | 不推断验收通过 |

[前一产物记录](platform-final/README.md) 保留当时 Node 22 超时及 Node 24 快照错误；后者现已由独立文件系统探针定位。前一轮未确认根因的说明是历史状态。没有降低生产 Journal 水位或吞掉错误，没有提高测试超时；最终新包移除了原始异常调试输出。11.8 完成实际平台记录，未推送、创建标签/Release 或触发发布 CI。
