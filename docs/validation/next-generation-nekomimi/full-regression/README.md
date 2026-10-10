# 11.2 全量回归（进行中）

2026-10-08，未提交工作树，基线 `be50c5a8a1557ef160056b964cd29e65b395685d`；macOS arm64 / Node.js 24.15.0。**11.2 已完成：最终整套 130 文件、777/777 通过，428.20s。**

首次 `npm test -- --maxWorkers=2` 完成构建并运行 130 文件、777 项测试，775 通过、2 失败，耗时 458.84s，见 unit-first.log。注入式 Journal/水位故障会输出预期诊断；不能把这些 stderr 行独立当作测试失败。

## 两项修正

1. customization-process 的预算夹具以 200 次 read 尝试耗尽 128 次生产操作预算，每次操作经过真实 RPC 和持久记录，30s 测试超时。夹具现在先断言生产上限仍为 128，运行期间临时设小预算并在 finally 恢复；保留真实扩展进程与文件读取、完成证据一致性，还显式捕获耗尽后再尝试模型，验证模型派发仍被阻止。生产代码和上限未改变。
2. CLI 模拟 opener 使用真实 Node 子进程，Vitest 默认 1s expect.poll 没有等到启动记录。独立诊断确认模拟 opener 可执行、实际 URL 可被记录；测试等待对齐生产 openBrowser 的 5s 超时，保留恰好一次实际 URL、opener 失败后的服务可用性、启动失败不打开及 SIGINT 清理断言。

首次定向预算已通过，CLI 仍暴露上述精确等待失败，见 first-focused.log。修正后这两个文件全部 **17/17 通过**，22.55s，见 fixes.log。完整类型检查通过，见 types.log。

```sh
npm test -- --maxWorkers=2
npx vitest run test/cli.test.ts test/customization-process.test.ts --maxWorkers=2
npm run typecheck
```

工作台完整浏览器 196/196 与 10.9 的证据独立保留于 ../readable-turns/，不刷新历史证据 hash。最终完整复跑见 unit-final.log，真实结果为 130 文件、777/777 通过，未将分批结果拼成一次通过。当前整体进度 80/89，7.8 与其余第 11 组任务继续保留；这不是全规格交付或跨平台结论。
