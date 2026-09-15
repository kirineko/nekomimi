export const statusText = (value?: string) =>
  ({
    running: "进行中",
    cancelling: "正在停止",
    completed: "已完成",
    cancelled: "已停止",
    failed: "失败",
    incomplete: "未完成",
    interrupted: "已中断",
    idle: "就绪",
  })[value ?? ""] ??
  value ??
  "";
export const toolTitle = (name: string) =>
  ({
    web_search: "搜索网页",
    web_fetch: "读取网页",
    read: "读取文件",
    write: "写入文件",
    edit: "修改文件",
    bash: "运行命令",
    powershell: "运行命令",
  })[name] ?? name;
export function sourceTitle(source: string) {
  if (source === "user") return "你的消息";
  if (source.startsWith("response:")) return "Nekomimi 的回复";
  if (source.startsWith("tool-guidance:")) return "工具使用规则";
  if (source.startsWith("tool:"))
    return toolTitle(source.split(":")[1] ?? "工具");
  if (source.startsWith("harness:")) return "基础指令";
  if (source.startsWith("recovery:")) return "恢复记录";
  return source.split(/[\\/]/).at(-1) ?? source;
}
export const eventTitle = (type: string) =>
  ({
    "context.view": "输入来源",
    "context.add": "消息记录",
    "request.dispatched": "发送请求",
    "response.headers": "连接结果",
    "response.chunk": "响应片段",
    "attempt.finished": "执行结果",
    "attempt.retry": "再次尝试",
    "tool.result": "工具结果",
    "tool.failed": "工具错误",
  })[type] ?? type;
export const duration = (ms?: number) =>
  ms === undefined
    ? "—"
    : ms < 1000
      ? `${ms} ms`
      : `${(ms / 1000).toFixed(1)} s`;
