/**
 * 用户术语表：L0/L1 区域的中文用户文案唯一来源。
 * 原始状态码与内部术语只出现在开发者视图或证据详情中（developer-view 规格）。
 * `null` 表示头部不显示状态标签（就绪/常态不需要提醒）。
 */
export const sessionStatus: Record<string, string | null> = {
  idle: null, // 就绪：头部不显示标签；列表显示“就绪”（弱化，见 statusText）
  accepted: "排队中",
  running: "运行中",
  cancelling: "正在停止",
  completed: "已完成",
  cancelled: "已停止",
  failed: "失败",
  incomplete: "未完成",
  interrupted: "已中断",
  unknown: "结果未知",
};

/** 会话头部状态标签；未知名称原样显示（进入开发者视图核对）。 */
export const sessionStatusLabel = (value: string): string | null =>
  value in sessionStatus ? (sessionStatus[value] ?? null) : value;

/** 列表/时间线的弱化状态文案（含“就绪”）。 */
export const listStatus: Record<string, string> = Object.fromEntries(
  Object.entries(sessionStatus).map(([key, value]) => [key, value ?? "就绪"]),
) as Record<string, string>;
