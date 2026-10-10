# Pi 1.0.4 发布包消费验证

## 范围与结论

对应批次 0 任务 1.2。验证日期：2026-10-06（UTC）。仅在 macOS arm64 执行，不代表 Linux/Windows 或真实模型验证。

**结论：五个发布包可在独立消费项目通过 Node 22.19.0/24.15.0 的入口及 Codemode worker/WASM 冒烟；类型消费在项目既有 `skipLibCheck: true` 设置下通过。额外的完整依赖声明检查存在一个上游可选 peer 缺失问题，未隐藏。**

- 官方 registry：`https://registry.npmjs.org`。所有 npm 元数据、安装、pack 显式指定该地址。
- 消费项目位于仓库外的系统临时目录，路径和命令见 `run.json`。没有源码 alias、source 条件或 reference 依赖。
- 五个直接依赖均精确为 1.0.4：`pi-agent-core`、`pi-ai`、`pi-durable`、`pi-codemode`、`pi-mcp`；消费锁文件固定完整传递依赖。生产 package/lock 未改动。
- `npm install --ignore-scripts --no-audit --no-fund` 成功；未执行包生命周期脚本。本轮不是依赖漏洞审计。
- 官方 tarball 经 `npm pack --ignore-scripts` 获取，再独立计算 SHA-512，与官方元数据的 integrity 逐包相等；文件列表、大小、URL 和摘要见 `tarballs.json`。
- Node 22.19.0 使用 nodejs.org 官方 darwin-arm64 归档，在临时目录解压；SHA-256 与官方 SHASUMS256.txt 相等。未修改系统 Node 或版本管理器。未另验 GPG 签名。

## 实际测试

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| Node 24.15.0 发布入口与 VM | 退出 0 | `runtime-node24-corrected.log` |
| 最低 Node 22.19.0 发布入口与 VM | 退出 0 | `runtime-node22-corrected.log` |
| TypeScript 5.9.3 strict / NodeNext / ES2023，不跳过依赖声明 | 退出 2：一个缺失可选 peer 的 TS2307 | `types-strict-corrected.log` |
| 同上，使用项目既有 skipLibCheck、noUncheckedIndexedAccess | 退出 0 | `types-project-options.log` |

`probe.mjs` 检查 exports 中不带通配符的 import/types/default 文件存在；不把 source 条件当成发布消费路径。对实际消费的通配符入口 `pi-ai/api/openai-responses`、`pi-ai/utils/event-stream` 执行了导入，未声称遍历执行所有通配符入口。检查并导入 Durable env/storage、MCP oauth/testing、Codemode source/declarations 等公开入口。导入的模块解析路径均在独立消费项目中。

Codemode 从安装包加载 worker 及 `quickjs-wasi/quickjs.wasm`，真实创建 VM，调用一次注入的 echo 工具并断言返回 42、调用状态 ok，最后关闭 VM。不是只检查文件存在。尚未验证 Nekomimi 打包后的资产复制、证据管线和取消边界（任务 1.5）。

## 类型声明限制及探针纠错

完整依赖声明检查发现：`@google/genai@2.21.0` 的声明导入 `@modelcontextprotocol/sdk/client/index.js`，但后者是其 optional peer，最小消费项目未安装。没有为了掩盖结果补装额外 SDK。现有项目本来就使用 `skipLibCheck: true`，采用该选项的消费者类型检查通过；不能据此声称上游完整声明闭包无问题。若未来要求 `skipLibCheck: false`，需显式固定该 peer 或等待上游修复后重新验证。

首次自编探针有四个错误假设，原文件保留为 `probe.initial.*`，原失败日志也保留：

1. 错把 `Harness` 当构造器；发布声明实际是 `Harness.open(...)` 对象。
2. OpenAI Responses 导出名实际为 `stream`，不是 `streamOpenAIResponses`。
3. `AgentOptions.streamFn` 为必填。
4. `Model` 必须提供 API 类型参数。

按发布包声明修正探针后重新运行，不修改 Nekomimi 或上游包，也不将探针错误标为产品缺陷。网络下载最初的 Python urllib TLS EOF 已记录于 `downloads.log`；改用 npm/curl 正常证书校验后完成，未禁用 TLS 校验。

## 复现

在仓库外新建临时目录，复制本目录的 `package.json`、`package-lock.json`、`probe.mjs`、`probe.ts`，在该目录执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
node probe.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2023 probe.ts --skipLibCheck --noUncheckedIndexedAccess
# 额外完整依赖检查：去掉 --skipLibCheck，当前锁文件预期得到上述 TS2307。
```

分别使用 Node 22.19.0、24.15.0 执行 probe。不要使用开发 source 条件。本轮只确认发布可消费性，不宣称任务 1.3–1.10 或整体重构已完成。
