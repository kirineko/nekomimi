# 前端技术切片与双工作台样稿

## 范围和状态

任务1.8、1.9完成。初版评审要求保留布局、调整视觉；高对比明暗新版已获用户明确批准：“按当前样稿推进（推荐）”。所有页面数据和运行/停止/授权状态都是明确标注的模拟，不接后端、不调用模型、不应用候选；不代表新工作台已实现。

环境：macOS arm64，Node22.19.0/24.15.0；两种Node上类型检查、Vite构建与Chrome headless 7项综合测试均通过。最终日志 `node*-reviewed-{build,browser}.log`，完整机器结果 `node*-reviewed-results.json`。没有Linux/Windows、Firefox/WebKit验收结论。

## 固定依赖与来源

依赖完整版本及license见 `package.json`、`package-lock.json`、`licenses.json`。React19.3.0/Vite8.3.0与当前产品相同；候选为Radix Dialog1.2.0/Slot1.4.0、Tailwind4.3.3、TanStack Query5.104.1/Router1.170.41/Virtual3.14.13、react-resizable-panels4.14.2。许可证均已记录，非漏洞扫描或法律审计。

Button来自2026-10-06获取的官方shadcn new-york-v4 registry（https://ui.shadcn.com/r/styles/new-york-v4/button.json），原内容保存于 `shadcn-button.registry.json`，MIT声明保存为 `SHADCN-LICENSE.md`。引入时仅将cn替换为本地utils，将radix-ui聚合导入换为独立Slot包；不是把自编控件叫做shadcn。最终代码和来源均纳入证据hash。

构建保留了上游use-client模块指令警告；本切片为纯客户端Vite SPA，不依赖SSR/RSC语义，不通过屏蔽警告假称无警告。未引入Next.js或生产依赖。

## 浏览器验证

1. Radix Dialog键盘打开、深色预览、Escape与焦点恢复；使用实际shadcn Button。
2. Router两个工作台与深链接；工作/创造草稿独立且导航保留；Query key包含host/mode。
3. 分栏separator的ArrowRight实际改变尺寸；工作区占满可用高度。
4. 300条虚拟列表DOM少于40行，延迟图片加载触发真实测量；模拟流中输入不失焦，远距离滚动仍有界。
5. 360px窄屏核心控件可用且无横向溢出。
6. 720px视口加CSS zoom:2（360 CSS px有效宽度）检验200%放大后输入/停止可用；**这是自动化CSS缩放实验，不冒充浏览器菜单原生zoom或屏幕阅读器验收**，后续整体验收仍需实际目标设备。
7. 两工作台各六状态截图，窄屏和深色截图，检查样稿遍历无pageerror。

最初视觉人工检查发现分栏库inline布局使高度停留在min-height；最终通过显式Group高度修正并加入高度断言。初版7/7结果和截图保留为 `initial-*`、`screenshots-initial/`；后续图片检查发现窄屏高度及全页截图异常；改为视口内flex布局、等待图片decode/测量稳定，新增停止按钮视口位置断言，两种Node仍7/7。最终样稿在 `screenshots/`；前一版保留在 `screenshots-before-mobile-fix/`，布局诊断为 `layout.json`。

## 样稿与 tokens 草案

- [工作正常态](screenshots/work-正常.png)
- [创造正常态](screenshots/create-正常.png)
- [工作360px](screenshots/work-360.png)
- [创造360px](screenshots/create-360.png)
- [创造深色](screenshots/create-dark.png)
- 其余加载/空/错误/已取消/待授权截图在同目录，以模式和中文状态命名。

待替换初稿（用户未批准）：暖白/灰绿、低装饰密度；文字明确区分工作/创造、目标、候选阶段；证据常驻侧栏，窄屏折叠。

| Token | 浅色 | 深色 |
| --- | --- | --- |
| surface | #fcfbf8 | #202723 |
| panel | #f4f2ed | #18201c |
| text | #282c30 | #e9eee9 |
| muted | #606971 | #a9b8af |
| border | #dcded9 | #45554a |
| accent | #406953 | #658c72 |
| accent-surface | #e4ede6 | #34463b |

字体system-ui；基础14px/1.6；标题20–24px；主要间距12/16/24px；控件圆角8–16px。危险、状态和禁用不只靠颜色，减少动效媒体查询覆盖过渡。尚未宣称全部WCAG对比度/读屏通过。

## 单机性能基线

`node*-reviewed-metrics.json`：1000字符fill+断言约6.2/6.0ms；滚动+虚拟化断言约27.5/26.5ms。包括Playwright开销，单次测量，无统计分位数，不能声称快于旧UI。构建初版JS约470kB（gzip149kB），CSS约17kB；这是无业务后端的组合原型体积，不是产品包预算。正式阶段需按相同机器、fixture与脚本重复测量。

## 复现

把本目录源码与package/lock复制至仓库外临时目录：

```sh
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
npm run build
npm test
node node_modules/vite/bin/vite.js preview
# 浏览 http://127.0.0.1:4178/work 或 /create
```

测试使用本机Chrome。最低Node复验时同时将其bin目录放在PATH首位，以确保Playwright启动的Vite也使用22.19.0。

## 高对比样稿（2026-10-07）

按照用户已选择的清晰高对比、轻量猫系点缀调整tokens，三栏与窄屏布局保留。新色值：surface #f8fafc、text #172033、muted #4b5563、accent #5a3ec8；深色surface #131b2b、text #f0f4ff、muted #b7c0d2、accent #beaaff。错误/待授权采用各主题独立可读颜色，猫系标记仅留在品牌入口。参考图、六状态、窄屏与深色见` screenshots-high-contrast/`；类型/构建及7项Chrome测试通过，实际指标见`high-contrast-metrics.json`。用户查看明暗样稿后明确批准“按当前样稿推进（推荐）”，任务1.9完成。此样稿依旧使用模拟数据，不代表正式工作台实现。
