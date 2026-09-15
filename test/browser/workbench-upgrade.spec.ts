import { test, expect } from "@playwright/test";
import { startWeb } from "../../src/server/app.js";
import {
  temporary,
  key,
  reasoning,
  callItem,
  response,
  textItem,
} from "../helpers.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
let app: Awaited<ReturnType<typeof startWeb>>;
let opened: string[];
let searchCalls = 0;
test.beforeEach(async () => {
  const workspace = await temporary();
  await mkdir(join(workspace, "src"));
  await writeFile(join(workspace, "src", "hello.txt"), "old\n");
  opened = [];
  let calls = 0;
  searchCalls = 0;
  app = await startWeb({
    workspace,
    home: await temporary(),
    apiKey: key,
    naming: false,
    staticDir: resolve("dist/web-dist"),
    openFile: async (path) => {
      opened.push(path);
    },
    runtime: {
      fetch: async (url) => {
        if (String(url).endsWith("/messages")) {
          searchCalls++;
          return Response.json({
            content: [
              { type: "server_tool_use", name: "web_search", id: "s" },
              {
                type: "web_search_tool_result",
                tool_use_id: "s",
                content: [
                  {
                    type: "web_search_result",
                    title: "Node.js documentation",
                    url: "https://nodejs.org/api/fs.html",
                    snippet: "Filesystem API documentation",
                  },
                ],
              },
            ],
            stop_reason: "end_turn",
          });
        }
        calls++;
        if (calls === 1)
          return response([
            reasoning,
            callItem("web_search", { query: "Node filesystem" }, "search"),
          ]);
        if (calls === 2)
          return response([
            callItem(
              "write",
              { path: "result.txt", content: "A new file\n" },
              "write",
            ),
          ]);
        return response([
          textItem("## 已完成\n\n已查询文档并新增 `result.txt`。"),
        ]);
      },
    },
  });
});
test.afterEach(async () => {
  await app?.close();
});
test("search, diff, locate, open and reload preserve evidence and draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.url);
  await page.getByRole("textbox", { name: "任务内容" }).fill("搜索并创建文件");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(page.locator(".conversation-heading")).toContainText("已完成");
  await expect(
    page.getByRole("link", { name: /Node.js documentation/ }),
  ).toBeVisible();
  await expect(page.locator(".diff-line.add")).toContainText("A new file");
  const draft = page.getByRole("textbox", { name: "任务内容" });
  await draft.fill("下一步草稿");
  await draft.focus();
  expect(await draft.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
    "none",
  );
  await page.getByRole("button", { name: "定位文件" }).click();
  const file = page.getByRole("treeitem", { name: /result.txt/ });
  await expect(file).toBeVisible();
  await file.click();
  expect(opened).toEqual([]);
  await file.dblclick();
  await expect(page.getByRole("status")).toContainText("已提交给本机默认程序");
  expect(opened).toHaveLength(1);
  await page.getByRole("tab", { name: "变更", exact: true }).click();
  await expect(page.locator(".changes-list .diff-line.add")).toContainText(
    "A new file",
  );
  await page.getByRole("tab", { name: "执行详情", exact: true }).click();
  await expect(draft).toHaveValue("下一步草稿");
  await page.getByRole("button", { name: "关闭工作区面板" }).click();
  await page.getByText("全部调用", { exact: false }).click();
  await page.getByRole("button", { name: /网页搜索调用/ }).click();
  await page.getByRole("button", { name: "请求", exact: true }).click();
  await expect(page.locator(".inspector")).toContainText("web_search_20250305");
  await page.getByRole("button", { name: "关闭工作区面板" }).click();
  await page.reload();
  await expect(page.locator(".diff-line.add")).toContainText("A new file");
  await page.getByRole("button", { name: "导出", exact: false }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 HTML" }).click();
  const download = await downloading;
  const html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("Node.js documentation");
  expect(html).toContain("A new file");
  expect(searchCalls).toBe(1);
  expect(opened).toHaveLength(1);
  expect(errors).toEqual([]);
});
test("workspace API authentication and side effect boundary", async ({
  request,
}) => {
  expect(
    (await request.get(app.origin + "/api/v1/workspace/files")).status(),
  ).toBe(401);
  const headers = { Authorization: `Bearer ${app.token}`, Origin: app.origin };
  expect(
    (
      await request.post(app.origin + "/api/v1/workspace/open", {
        headers: { ...headers, Origin: "https://example.com" },
        data: { path: "src/hello.txt" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(app.origin + "/api/v1/workspace/open", {
        headers,
        data: { path: "../escape" },
      })
    ).status(),
  ).toBe(403);
  expect(opened).toEqual([]);
});
test("files and settings remain usable at all viewports", async ({ page }) => {
  await page.goto(app.url);
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.screenshot({ path: `output/playwright/workbench/empty-${width}.png` });
    await page.getByRole("button", { name: "打开工作区面板" }).click();
    await page.getByRole("treeitem", { name: /src/ }).click();
    await expect(
      page.getByRole("treeitem", { name: /hello.txt/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `output/playwright/workbench/files-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "打开工作区面板" }),
    ).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("checkbox", { name: "启用网页搜索" }).uncheck();
  await expect(page.getByRole("status")).toHaveText("已完成");
  await page.screenshot({ path: "output/playwright/workbench/settings.png" });
  await page.keyboard.press("Escape");
  expect((await app.sessions.config.snapshot()).search.enabled).toBe(false);
});

test("changes keep expanded history while new journal events arrive", async ({ page }) => {
  await page.goto(app.url);
  await page.getByRole("button", { name: /新建会话/ }).click();
  await expect(page).toHaveURL(/session=/);
  const sessionId = new URL(page.url()).searchParams.get("session")!;
  let total = 120;
  await page.route("**/api/v1/sessions/*/changes?*", async route => {
    const url = new URL(route.request().url());
    const before = Number(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
    const after = Number(url.searchParams.get("after") ?? 0);
    const all = url.pathname.includes(sessionId) ? Array.from({ length: total }, (_, i) => ({
      id: `change-${i + 1}`, seq: i + 1, path: `file-${i + 1}.txt`, patch: { sha256: "a".repeat(64) },
    })).reverse().filter(c => c.seq < before && c.seq > after) : [];
    const changes = all.slice(0, 50);
    await route.fulfill({ json: { changes, nextBefore: all.length > 50 ? changes.at(-1)!.seq : undefined } });
  });
  await page.route("**/api/v1/sessions/*/diff/*", async route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const lines = Array.from({ length: Math.min(limit, 240 - offset) }, (_, i) => ({ kind: "add", text: `line ${offset + i}`, next: offset + i + 1 }));
    await route.fulfill({ json: { lines, total: 240, added: 240, removed: 0, offset, next: offset + limit < 240 ? offset + limit : undefined } });
  });
  await page.getByRole("button", { name: "打开工作区面板" }).click();
  await page.getByRole("tab", { name: "变更", exact: true }).click();
  await expect(page.locator(".changes-list > article")).toHaveCount(50);
  await page.getByRole("button", { name: "更早的修改" }).click();
  await expect(page.locator(".changes-list > article")).toHaveCount(100);
  const entry = page.locator(".changes-list > article").filter({ has: page.locator('[title="file-80.txt"]') });
  await entry.getByRole("button", { name: "查看文件 diff" }).click();
  await entry.getByRole("button", { name: "下一段" }).click();
  await expect(entry).toContainText("121–240 / 240 行");
  await entry.evaluate(el => el.setAttribute("data-preserved", "yes"));
  total = 180; // More than one page arrives while the user reads older history.
  await page.getByRole("textbox", { name: "任务内容" }).fill("继续执行");
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(page.locator(".conversation-heading")).toContainText("已完成");
  await expect(page.locator(".changes-list > article")).toHaveCount(160);
  await expect(entry).toHaveAttribute("data-preserved", "yes");
  await expect(entry).toContainText("121–240 / 240 行");
  await page.getByRole("button", { name: "更早的修改" }).click();
  await expect(page.locator(".changes-list > article")).toHaveCount(180);
  await expect(page.locator(".changes-list > article").last()).toContainText("记录 1 ·");
  await page.getByRole("button", { name: /新建会话/ }).click();
  await expect(page.locator(".changes-list > article")).toHaveCount(0);
});
