# 能力目录与交付事实投影（7.6）

2026-10-07，macOS arm64 / Node.js 24.15.0，未提交工作树。

- 受控创建/更新记录实际 SessionBinding；目录按所属项目定位来源会话，保留开发目标、宿主构建和资源范围。当前内容与来源记录不同时显示观察到更新及修改者未知。
- 候选、当前活动版本、项目/用户范围分别投影。来源会话删除不删除资源，历史交付快照保持不变。
- 交付快照携带原始证据事件身份、hash、验证阶段、状态及运行环境；仅匹配内容、宿主和 Node/平台/架构/SDK 的验证作为当前证据。
- 两种工作台读取同一交付事实；查询不改生命周期 Journal，不运行工厂，不授权或激活。当前撤销状态与不可变历史分别展示。

## 验证

projection-first.log 保留首次路径断言失败：macOS /var 与 /private/var 指向同一临时目录；改为对照实际规范化 SessionBinding。
projection-regression.log、projection-final.log 均为 4 文件 26 项通过，包括来源已删除、外部修改、旧环境验证、历史与当前授权分离、用户级资源不继承授权、重启及只读查询。
projection-types.log、projection-build.log 退出码 0；projection-specs.log 严格规格 43 项通过；git diff --check 通过。

未运行真实模型。完整新工作台交互和浏览器验收保留在第 10/11 组。
