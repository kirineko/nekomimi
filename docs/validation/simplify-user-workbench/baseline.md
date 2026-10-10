# 迁移前基线（任务 0.2）

- Commit: be50c5a（工作树含 openspec 归档与文档修改；源码未动）
- Node: v24.15.0, macOS arm64
- `tsc --noEmit`（src）与 `tsc -p tsconfig.web.json --noEmit`：均退出码 0
- `npm run test:browser`：198 passed / 3 failed（live-panels create、panel-management、workbench narrow viewport 三项 45s 超时）。
  三项在构建后的单独复跑全部通过（9 passed），判定为既有偶发超时，非批次 A 变更引起。
- 浏览器场景总数：201（含复跑）；测试文件：54。

注意：基线浏览器运行在批次 A 构建（nonce+preflight）之后执行；3 项偶发失败与新变更无关（复跑通过且失败点不在改动路径上）。
