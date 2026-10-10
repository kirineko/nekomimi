# 10.9 轮次阅读与旧时间线清理

2026-10-08，基线 commit `be50c5a8a1557ef160056b964cd29e65b395685d` 上的未提交工作树；macOS arm64 / Node.js 24.15.0 / Chrome 154.0.8037.98。最终文件 hash 见 manifest.json，不将未提交结果冒充基线提交自身的结果。

## 实现与契约

新工作/创造时间线按相邻 runId 分组，回答和工具结果保持原顺序。调用及命名默认折叠；空成功结束状态不重复占行，原始调用仍可在证据中读取。每轮证据入口直接选择对应运行，全局入口仍选择最新运行。

失败、取消和结果未知保留在正文；没有任务终态的成功 attempt 不代表任务成功，显示“当前记录未包含任务结束状态”。缺失 runId、被分页隔开的同名 run 和非相邻 run 不误合并。扩展结果、面板及附件不因空文本而被当作重复成功状态丢弃。首条记录保留为稳定锚点，回复到达不替换身份；展示不写入 Journal、不执行模型或工厂。

迁移旧 conversation-display 测试至实际新投影，删除旧 Timeline、RuntimeViews、ToolCard、Artifact、Brand 五个无调用模块，移除 CustomPanel 中无人调用的 PanelManagement。共享安全面板保留；源码边界文档改为新证据组件，滚动 hook 移除旧页面选择器回退。

## 验证与修复记录

- 新投影/分组：7 项单元检查通过，覆盖失败、取消、未知、命名、重试恢复、分页、无身份、扩展结果和锚点身份。
- 双模式 Journal 夹具：五个连续/部分轮次，折叠与展开、直达命名证据、异常展示及刷新；零业务 POST，Journal 字节不变，模型 transport 禁止调用。工作/创造截图均已通过图像工具查看。
- 最终定向浏览器：7/7，包含真实长历史分页、持续输出下输入、上下文选择清单和完整请求附件分页、取消、导出与窄屏焦点。
- 完整类型检查、构建、严格 OpenSpec 验证通过。构建仍有 app chunk 超过 500 kB 的提示；性能基线任务尚未完成。
- 最终完整浏览器 **196/196 通过**，见 full-final.log；10.9 完成，当前 79/89。

首次定向 20/23：两个新测试发现轮次入口错误地默认最新运行，已通过传入 runId 修复。原生滚动条检查发现 mouse.up 返回后仍有 compositor 派发的最后一笔原生滚动，随后触发行高更新；重复检查 4/10、尝试同步布局 7/10，事件观测确认时序。试验性滚动逻辑均撤回，测试改为等待浏览器真正的 scrollend，再检查结束后位移，**2px 阈值保持不变**；连续 10/10 通过。触摸长按/惯性与手动模式断言保留。

首次完整浏览器 195/196：旧长历史断言预期 60 个展示节点，新投影正确折叠两条成功调用和一条空结束记录后为 57 个。测试现在按 fixture 检查 57/117/177/180 个展示锚点，并保留原 60/180 条历史窗口、输入响应、滚动与完整证据读取行为；没有取消分页或附件检查。随后定向 7/7 通过。

## 命令

```sh
npm run typecheck
npm run build
npx vitest run test/conversation-display.test.tsx test/conversation-turns.test.ts --maxWorkers=2
npx playwright test test/browser/scrolling-native.spec.ts --repeat-each=10 --workers=2
npx playwright test test/browser/readable-turns.spec.ts test/browser/workbench.spec.ts --workers=2
npx playwright test --workers=2
openspec validate --all --strict
```

这些是假 transport 和已保存 Journal 的行为验收，不是实际模型质量、最低 Node 或 Linux 验收。7.8 与第 11 组剩余门槛另行完成，未提交、归档或发布。
