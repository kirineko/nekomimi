# 批次 D 验证记录：综合回归、文档与交付（4.1–4.5）

## 4.1 完整回归

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` / `npx tsc -p tsconfig.web.json --noEmit` | 通过（退出码 0） |
| `npx playwright test`（浏览器，`dist/web-dist`） | **217 / 217 通过**，7.2 分钟；基线为 201（198 通过 + 3 个负载下超时后重跑通过），新增 16 个场景 |
| `npx vitest run` | 见下方“单元测试说明” |
| `openspec validate --all --strict` | 51 项通过；`openspec validate simplify-user-workbench --strict` 通过 |

浏览器新增场景：`auth-guide`、`csp-nonce`、`style-baseline`、`details-drawer`、`management-routes`（5）、`developer-view`（3）、`auto-refresh`、`evidence-consistency`。
迁移记录：按 design D11 对照表只改入口路径与措辞，没有删除或放宽断言；检查器、证据、上下文详情内的断言保持原样。

### 单元测试说明

本机持续有 Spotlight（`mds_stores`）占用接近 1 个核心，vitest 默认并发下 server/runtime 层的 15s/30s 超时用例会批量超时
（34–36 个，均为 `Test timed out`，且单独运行全部通过）。这些用例不涉及 Web 层，也未被本变更修改。

- 低并发（`--maxWorkers=3`）：795/796 通过；唯一失败为 `runtime.test.ts › stops at 64 turns…`，
  本机该用例单独运行耗时约 32s（超过其 30s 限制），重复运行 2 次单独通过。
- 更低并发（`npx vitest run --maxWorkers=2`）：**135 个文件、796/796 全部通过**，退出码 0。
  默认并发的失败是本机负载所致，不是回归；在无其他负载的 CI 机器上应直接通过 `npm test`。

## 4.2 安装包验收

- `npm run test:pack` 通过（打包内容白名单、全局安装、CLI、离线导出/导入、SDK/Provider/工作流/MCP 安装验证）。
- 在临时目录全局安装 tarball 并启动 `nekomimi web`；CLI 输出仅有 `Web: http://127.0.0.1:…/#token=…`，无 nonce。
- 对该已安装实例用 Playwright（Node v24.15.0）验证：CSP 违规 0；控制台错误 0；会话链接 `text-decoration-line: none`；
  响应头 `style-src 'self' 'nonce-…'` 且不含 `unsafe-inline`；打开 Radix 对话框（会话信息）无违规；
  “设置 → 开发者视图”可用且写入本地偏好 `nekomimi:developer-view=1`。
  （HTML 中的 `csp-nonce` meta 在前端读取后被有意移除，故页面内看不到该节点。）
- **未测**：Node 22.19.0。本机 fnm 仅有 22.12.0（低于最低支持版本）、20.20.2、24.15.0，因此最低支持版本未实测；
  发版前应在 Node 22.19.0 上重复本节。

## 4.3 可访问性与窄屏复核

- 360px 宽 + 根字号放大到 200%（28px） + `prefers-reduced-motion: reduce`：无横向溢出；“上下文”入口与“发送”不相交；
  “发送”可通过滚动到达（顶栏与会话头部在极端缩放下折成多行，占去大半视口，属已知边界）。
- 键盘主流程、浮层 Escape 最上层优先、抽屉焦点归还：`details-drawer.spec.ts`、`workbench.spec.ts`（四个视口）、
  `inspection.spec.ts`、`context-details.spec.ts`、`context-meter.spec.ts`、`evidence-consistency.spec.ts` 覆盖并全部通过。
- 截图：`screens/work-light.png`、`work-dark.png`、`work-360-zoom200.png`、`details-drawer.png`、`session-menu.png`、
  `settings-menu.png`、`settings-hub.png`、`create-light.png`、`settings-light.png`。

## 4.4 文档

- `README.md`：新增“界面一览”（入口位置表）、开发者视图与连接授权/CSP 说明；导出入口更新为“会话操作（···）→ 导出会话”；
  “查看改动/浏览文件”更新为详情抽屉。
- `docs/development.md`：顶栏描述更新为“设置”菜单与“会话操作”。
- `rg "更多操作|版本恢复|导航与详情"`：`README.md`、`docs/`（除 `docs/validation/` 历史记录）已无残留；`extension-docs/customization-lifecycle.md`（随包发布）中的“更多操作 → 外观”已改为“设置 → 外观”；
  `src/web` 仅余 `/dev/ui` 开发演示页的 Menu 示例，以及 `shell.tsx`/`tokens.css` 中描述“导航与详情覆盖层”的代码注释（非用户可见入口）。
