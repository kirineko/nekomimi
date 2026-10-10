/**
 * 管理页注册表（纯数据）：设置总览、设置菜单和路由共享的唯一来源。
 * 不依赖 React/TSX，便于单元与浏览器测试直接读取。
 */
import type { SessionMode as Mode } from "../../shared/protocol.js";

export interface ManagementPageInfo {
  id: string;
  path: string;
  title: string;
  hint: string;
  modes: readonly Mode[];
  group: string;
  /** 会话级页面：存在 sessionId 时优先链接到会话深链接。 */
  session?: boolean;
}

export const managementPages: readonly ManagementPageInfo[] = [
  { id: "settings", path: "settings", title: "基础设置", hint: "默认模型、凭证与搜索", modes: ["work", "create"], group: "常用" },
  { id: "models", path: "models", title: "模型用途与配置", hint: "按用途选择模型", modes: ["work", "create"], group: "常用", session: true },
  { id: "themes", path: "themes", title: "主题与外观", hint: "颜色、字体与扩展显示", modes: ["work", "create"], group: "常用", session: true },
  { id: "resources", path: "resources", title: "能力与权限", hint: "启用、授权与诊断", modes: ["create"], group: "能力", session: true },
  { id: "mcp", path: "mcp", title: "MCP 连接与授权", hint: "外部工具服务", modes: ["create"], group: "能力", session: true },
  { id: "packages", path: "packages", title: "能力包", hint: "安装、回退与导出", modes: ["create"], group: "能力", session: true },
  { id: "panels", path: "panels", title: "面板", hint: "扩展界面", modes: ["work", "create"], group: "高级", session: true },
  { id: "workflows", path: "workflows", title: "持久工作流", hint: "长任务与恢复", modes: ["work", "create"], group: "高级", session: true },
];

export function pageHref(mode: Mode, page: ManagementPageInfo, sessionId?: string) {
  return page.session && sessionId ? `/${mode}/session/${sessionId}/${page.path}` : `/${mode}/${page.path}`;
}

