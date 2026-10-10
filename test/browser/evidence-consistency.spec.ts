import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";
import { openSessionMenu, setDeveloperView } from "./fixtures/workbench.js";

/**
 * 3.8 证据一致性：同一运行在开发者视图开/关两种状态下，从“会话操作”菜单与
 * 时间线“查看证据”打开检查器，看到的 attempt 数、请求、原始响应文本完全一致；
 * 打开检查器不产生写请求，也不触发新的模型调用。
 */
let app: Awaited<ReturnType<typeof startWeb>>;
let calls = 0;

test.beforeEach(async () => {
  calls = 0;
  app = await startWeb({
    workspace: await temporary(),
    home: await temporary(),
    naming: false,
    apiKey: key,
    staticDir: resolve("dist/web-dist"),
    runtime: { fetch: async () => { calls++; await delay(20); return response([textItem("证据一致性回复")]); } },
  });
});
test.afterEach(async () => { await app.close(); });

/** 读取检查器的“可比对指纹”：规整空白后的全文、attempt 数与全部 hash。 */
async function fingerprint(page: Page) {
  const dialog = page.getByRole("dialog", { name: "调用证据", exact: true });
  await expect(dialog).toBeVisible();
  const usage = dialog.getByRole("region", { name: "运行用量汇总" });
  await expect(usage).toContainText("次模型尝试");
  const attempts = (await usage.innerText()).match(/(\d+) 次模型尝试/)?.[1];
  // 选中调用并反复展开全部（含嵌套/懒加载）证据块，直到文本稳定
  await dialog.getByRole("button", { name: /· 完成$/ }).first().click();
  const selected = dialog.getByRole("region", { name: "所选调用证据" });
  await expect(selected).toContainText("全部事件");
  let body = "";
  for (let round = 0; round < 30; round++) {
    await dialog.evaluate((element) => element.querySelectorAll("details").forEach((node) => { node.open = true; }));
    const next = (await dialog.innerText()).replace(/\s+/g, " ").trim();
    if (next === body && !/读取中|正在读取|加载中/.test(next)) break;
    body = next;
    await page.waitForTimeout(100);
  }
  const hashes = [...body.matchAll(/[a-f0-9]{64}/g)].map((match) => match[0]).sort();
  return { attempts, body, hashes };
}

test("evidence is identical across entry points and developer-view states, with no side effects", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && !request.url().endsWith("/connect")) writes.push(`${request.method()} ${request.url()}`);
  });

  const session = await app.sessions.create("证据一致性");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await page.getByLabel("任务草稿", { exact: true }).fill("给出一个回复");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("证据一致性回复", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  await expect.poll(() => calls).toBe(1);

  writes.length = 0; // 只观察“打开检查器”阶段
  const results: Awaited<ReturnType<typeof fingerprint>>[] = [];
  for (const developer of [false, true]) {
    await setDeveloperView(page, developer);
    // 入口 1：会话操作菜单
    await openSessionMenu(page, "调用证据");
    results.push(await fingerprint(page));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "会话操作", exact: true })).toBeFocused();
    // 入口 2：时间线每轮“查看证据”
    await page.getByRole("button", { name: "查看证据", exact: true }).first().click();
    results.push(await fingerprint(page));
    await page.keyboard.press("Escape");
  }

  const [first, ...rest] = results;
  expect(first!.attempts).toBe("1");
  expect(first!.hashes.length).toBeGreaterThan(0);
  for (const other of rest) {
    expect(other.attempts).toBe(first!.attempts);
    expect(other.hashes).toEqual(first!.hashes);
    expect(other.body).toBe(first!.body);
  }
  expect(first!.body).toContain("证据一致性回复");
  expect(writes, `打开检查器产生了写请求：${writes.join(", ")}`).toEqual([]);
  expect(calls).toBe(1);
});
