# 11.4 安装包验收（进行中）

2026-10-09，macOS arm64 / Node.js 24.15.0，未提交工作树。

## 已完成

正式 `npm run test:pack` 退出 0。生成 `nekomimi-0.2.1.tgz` 后在临时目录进行本地和 global prefix 安装；不导入源码工作树。实际验证 CLI、Web 静态资源、文件配置及工作区隔离、离线 HTML/诊断导出导入、Codemode worker/WASM、完整 SDK 文档与示例、能力包/Provider/持久工作流/面板/MCP、候选二进制素材/新增授权/应用回滚，以及 Durable 真实进程终止后的未知工具不重跑。所有模型响应使用本地 fixture，无真实模型调用。完整输出见 node24-pack.log。

归档兼容修复：`prepareDownload` 改用已有 tar 库 portable/noMtime 打包已验证 bundle，不再调用系统 tar；避免 macOS AppleDouble 元数据与宿主用户名/文件时间进入诊断归档。真实浏览器完整/脱敏包下载断言通过，保留 Journal 不变、内容可解析及敏感文本脱敏；新增无 `._*`、uname/gname、mtime 断言。类型与构建通过，见 portable-* 日志。

## 未完成

同一 tarball 在官方 Node 22.19.0 下的 `node scripts/pack-smoke.mjs <archive>` 也已退出 0，覆盖上述全部安装 fixtures；安装包 build 身份相同。Node archive 的 SHA-256 为 `c59006db713c770d6ec63ae16cb3edc11f49ee093b5c415d667bb4f436c6526d`，与官方 SHASUMS256.txt 核对一致，安装在临时目录，未改变默认 Node。见 node22-pack.log、manifest-node22.json。

任务 11.4 尚未勾选：包含原工作草稿、交接、创造错误修复、授权交付、原项目使用/修改/重启/停用的完整跨模式集成门槛仍待补齐；当前 SDK/package fixture 不能单独替代这一流程。Linux 尚未执行，Docker socket 不存在；不能用 macOS 结果推断 Linux。Windows 按项目约定暂缓。

构建 app 分块约 660 kB，仍有 500 kB 告警；功能安装验收通过不代表 web-feature-loading 体积契约通过。后续修改需重新生成和验证最终安装产物。
