# 运行时 UI 与整体主题

整体换肤使用 `registerTheme`，局部互动使用 `registerPanel` 或 `registerView`。只创建一个面板不会修改宿主整体风格。完整文件见 [樱花组合示例](examples/sakura/README.md)，类型见 `customization_sdk({entry:"ui"})`。

## 全局主题

主题提供 typography（family、fallback、font、size、weight、lineHeight）、colors（background、surface、foreground、muted、accent、border、userBubble、assistantBubble）、spacing、radii、shadows、bubbles、assets、motion、density。字体和背景是包内相对路径，构建校验内容摘要及格式；字体为 WOFF/WOFF2，背景为 PNG/JPEG/WebP，不能填外部 URL。缺失字体回退系统字体。

字体大小 12–24px、行高 1.2–2.2、字重 300–800；间距比例 .75–1.5；圆角 0–32px。动效为 none/fade/float 预设，时长 100–4000ms、位移 0–8px；减少动态效果偏好禁用装饰动画。配色必须为六位十六进制，禁止任意选择器、CSS、脚本及可执行素材。

`themes` 是独立权限。激活包不自动切换主题，在「外观」预览或应用；工作区覆盖优先于用户默认，可取消预览、跟随默认或恢复默认界面。主题失效时保留选择记录并回退，不影响会话事实。

## 区域与交互

`registerView` 需要 `views`，使用 PanelDefinition 加 title、order、match。区域为 session-header、message-content、tool-result、composer-toolbar、sidebar-widget、page。消息匹配 role，工具匹配 tool；同一结果的替代 renderer 由用户选择，无选择使用宿主默认。普通挂件按 order、resourceId、id 稳定排序。

基础 registerPanel 继续支持 result/sidebar；清单需要 panels，通过 `ctx.ui({kind:"panel",title,panelId,summary,props})` 记录结果。summary 是给用户看的结果摘要，fallback 应包含仍可理解结果的信息，不要只提示“查看 JSON”。props 必须满足 schema，结构化证据仍被保存。

浏览器默认导出 `PanelModule`，mount(root,context) 只操作 iframe 内 DOM。上下文提供 props、request、subscribe 和 onThemeChange；可返回清理函数。不要依赖宿主 React、cookie、网络 API 或任意 CSS。内容高度自动通知宿主并受上限约束。

| request 动作 | 权限 | 输入/行为 |
| --- | --- | --- |
| draft.set | ui-draft | `{text}`；不自动发送，已有草稿由用户选择替换/追加/保留 |
| command.run | ui-command | `{commandId,command}`；只调用已注册斜杠命令，继承记录、去重和取消 |
| session.navigate | ui-navigation | `{sessionId}`；只允许绑定会话 |
| view.open | ui-navigation | `{viewId}`；打开同资源 page 视图 |
| state.read / state.subscribe | ui-state | 返回绑定会话的有界状态；subscribe 回调返回清理函数 |
| workflow.state/answer/cancel | panels 或 views | 必须关联同资源工作流；回答保留 CAS，不隐式继续 |

每个操作必须列入 actions 和 requiredCapabilities；声明不是授权。预览不开放宿主桥接。实例失效、撤权、换会话及收起解除通信；请求失败返回可处理错误。停止任务使用宿主控件，不由插件隐藏或替代。

## 当前、历史与离线

当前命令产生的已授权面板直接显示；刷新/历史先显示摘要，用户可显式重新打开。关闭再打开只挂载保存的结果，不重新执行命令。JSON、哈希和错误细节进入开发详情；离线 HTML 不执行插件。请在真实宿主验收，不能以独立预览代替。
