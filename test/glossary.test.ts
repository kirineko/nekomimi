import { it, expect } from "vitest";
import {
  sessionStatus,
  sessionStatusLabel,
  listStatus,
} from "../src/web/glossary.js";
import { statusText } from "../src/web/presentation.js";

it("covers every session status with user-language labels", () => {
  for (const code of [
    "idle",
    "accepted",
    "running",
    "cancelling",
    "completed",
    "cancelled",
    "failed",
    "incomplete",
    "interrupted",
    "unknown",
  ]) {
    expect(code in sessionStatus, `缺少状态 ${code} 的映射`).toBe(true);
    expect(listStatus[code], `列表缺少 ${code}`).toBeTruthy();
  }
  // 就绪/常态不在头部显示
  expect(sessionStatusLabel("idle")).toBeNull();
  expect(sessionStatusLabel("running")).toBe("运行中");
  expect(sessionStatusLabel("cancelling")).toBe("正在停止");
  expect(sessionStatusLabel("failed")).toBe("失败");
  expect(sessionStatusLabel("interrupted")).toBe("已中断");
  expect(sessionStatusLabel("unknown")).toBe("结果未知");
  // 列表保留“就绪”
  expect(listStatus["idle"]).toBe("就绪");
  // presentation.ts 的 statusText 由术语表提供
  expect(statusText("running")).toBe("运行中");
  expect(statusText("unknown")).toBe("结果未知");
  expect(statusText("idle")).toBe("就绪");
  // 未知状态码原样透出（供开发者视图核对），不伪造文案
  expect(statusText("brand-new-status")).toBe("brand-new-status");
});
