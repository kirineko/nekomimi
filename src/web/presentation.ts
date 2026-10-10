import { listStatus } from "./glossary.js";

export const statusText = (value?: string) =>
  listStatus[value ?? ""] ?? value ?? "";
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

export function failureText(text:string) {
  if(/Response incomplete/i.test(text))return '本次回复未完整生成。可以继续任务；具体原因可在调用证据中查看。';
  if(/Run turn limit exceeded/i.test(text))return '已达到本次任务的调用轮数上限，请分步骤继续任务。';
  if(/timed out/i.test(text))return '模型响应超时，请检查连接后继续任务。';
  return text||'本次任务未完成，可以检查调用证据后继续。';
}
