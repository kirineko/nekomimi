# 10.3 完成验收

2026-10-08；macOS arm64 / Node 24.15.0；未提交工作树，基线 HEAD be50c5a8a1557ef160056b964cd29e65b395685d。任务 10.3 完成，整体 72/89。

## 最终增量

交付卡链接携带工作会话、交接 ID 和确切版本。候选页面核对持久交付快照中的源会话/候选/版本，无法匹配时局部拒绝。内容一致才显示对应候选差异与当前检查记录；内容变化、来源删除或读取失败只显示原交付快照及诊断，不展示当前内容为旧交付版本。另行查看当前候选需明确导航。

从交付卡离开时保存其相对滚动偏移及证据展开状态。显式返回和浏览器后退都可恢复同一工作会话的交付锚点，异步卡片/历史到达时继续定位；用户滚动、触摸、指针或键盘操作后停止自动定位，避免干扰阅读。状态按宿主/会话/交接隔离。此专用交付锚点不替代 10.7 完整虚拟列表、分页和动态媒体门槛。

## 要求与证据映射

| 10.3 要求/关联场景 | 权威证据 |
| --- | --- |
| 预览目的、约束、目标、引用，确认前不创建目标或任务 | handoff-cards 浏览器新目标预览/取消/确认；handoff-preparation 只读预览测试 |
| 工作/创造两侧草稿独立，取消不提交 | create-conversation 浏览器真实双会话导航/取消；handoff-cards 草稿与迟到回执测试 |
| 选定内容的独立摘要、采用后重新确认、取消与源变化 | handoff-summary 浏览器 5 项及 handoff-preparation 单元 8 项 |
| 相同命令去重、丢回执和刷新后恢复、不自动运行目标 | handoff-cards 丢响应；handoff-recovery 浏览器 2 项；handoff-transfer 故障测试和 handoff-crash-recovery 8 个实际 SIGKILL 屏障 |
| 来源/目标跳转、精确交付版本、返回阅读位置 | delivery-navigation 浏览器 2 项（显式返回/浏览器后退、偏移误差小于 3 CSS px、证据展开、变化/删除/无效快照） |
| 历史快照与当前状态分离、版本过期/源删除、收卡不应用 | handoff-cards 浏览器只读卡与工厂标记检查；delivery-receipts 服务端真实版本/权限/应用事实测试 |
| 工作明确引用已接收交付，关联实际请求/运行 | handoff-cards 浏览器真实 runtime + 假模型，Journal delivery.referenced/runId；mode-handoff-roundtrip HTTP/headless 闭环 |
| 创造输入可用、绑定开发目标、明确停止 | create-conversation 实际创建候选，仅开发目录变化，SSE 结果与取消检查 |

前序细节见 ui-progress.md、recovery-and-references.md、summary-and-create-input.md。其“进行中”是各自历史快照，以本文与当前 tasks.md 为准。

## 当前统一验证

- `npm run typecheck` 与 `npm run build`：退出 0。
- 浏览器六文件：delivery-navigation、handoff-cards、handoff-recovery、handoff-summary、create-conversation、v2-workbench；29 项全部通过，退出 0。
- 单元五文件：handoff-preparation、mode-handoff-roundtrip、delivery-receipts、handoff-transfer、handoff-crash-recovery；68 项全部通过，退出 0。
- `openspec validate --all --strict`：43 项通过；`git diff --check` 通过。

模型调用全部使用本地假 transport/响应，不是实际模型质量测量。浏览器原生后退是真实导航；缩放仍是已注明的 CSS zoom 实验。Linux/最低 Node、本批次之外的全部浏览器/包/性能/隐私门槛仍在第 11 组，不以这组通过宣称完成。未同步主规格、归档、提交、推送或发布。
