import { test, expect } from "@playwright/test";
import { startWeb } from "../../src/server/app.js";
import { temporary, response, textItem, key } from "../helpers.js";
import { resolve, join } from "node:path";
import { Journal } from "../../src/journal.js";
import { readFile, realpath } from "node:fs/promises";
test("configures, sends with Enter, names, exports offline and deletes across windows", async ({
  page,
  context,
}) => {
  const workspace = await realpath(await temporary()),
    home = await temporary();
  const journal = await Journal.open(
    join(workspace, ".harness", "sessions", "legacy"),
  );
  await journal.append("session.created", { workspace });
  await journal.append("web.session", { title: "旧会话" });
  await journal.close();
  let titleCalls = 0,
    taskCalls = 0;
  const app = await startWeb({
    workspace,
    home,
    legacyHome: await temporary(),
    staticDir: resolve("dist/web-dist"),
    runtime: {
      fetch: async (_u, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.instructions?.includes("Name this conversation")) {
          titleCalls++;
          return response([textItem("猫咪问候")]);
        }
        taskCalls++;
        return response([
          textItem(
            "## 完成\n\n| 结果 | 状态 |\n| --- | --- |\n| 问候 | 完成 |\n\n<script>window.hacked=true</script>",
          ),
        ]);
      },
    },
  });
  try {
    await page.goto(app.url);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("textbox", { name: "API key", exact: true }).fill(key);
    await page
      .getByRole("button", { name: "保存 API key", exact: true })
      .click();
    await expect(
      page.getByText("已配置", { exact: true }),
    ).toBeVisible();
    expect(await readFile(join(home, "auth.json"), "utf8")).toContain(key);
    await expect(page.getByRole("dialog")).not.toContainText("迁移");
    await page.getByRole("button", { name: "关闭设置" }).click();
    await page.getByRole("button", { name: "新建会话", exact: false }).click();
    const input = page.getByRole("textbox", { name: "任务内容" });
    await input.fill("你好");
    await input.dispatchEvent("compositionstart");
    await input.press("Enter");
    expect(taskCalls).toBe(0);
    await input.dispatchEvent("compositionend");
    await input.press("Enter");
    expect(taskCalls).toBe(0);
    await page.waitForTimeout(80);
    await input.fill("你好");
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("你好\n");
    await input.press("Enter");
    await expect(page.locator(".conversation-heading h1")).toHaveText(
      "猫咪问候",
    );
    expect(titleCalls).toBe(1);
    const second = await context.newPage();
    await second.goto(page.url());
    await expect(second.locator(".conversation-heading h1")).toHaveText(
      "猫咪问候",
    );
    await input.fill("继续");
    await input.press("Enter");
    await expect.poll(() => taskCalls).toBe(2);
    expect(titleCalls).toBe(1);
    await expect(page.locator(".conversation-heading")).toContainText("已完成");
    await page
      .getByRole("button", { name: "导出", exact: false })
      .first()
      .click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 HTML" }).click();
    const download = await downloadEvent;
    const html = await readFile((await download.path())!, "utf8");
    expect(html).toContain("Nekomimi");
    expect(html).not.toContain(key);
    const offline = await context.newPage();
    let external = 0;
    await offline.route("https://**", (route) => {
      external++;
      void route.abort();
    });
    await offline.setContent(html);
    await expect(offline.locator("main h1")).toHaveText("猫咪问候");
    await expect(offline.locator(".markdown table").first()).toBeVisible();
    expect(
      await offline.evaluate(() => (window as any).hacked),
    ).toBeUndefined();
    expect(external).toBe(0);
    await offline.setViewportSize({ width: 390, height: 844 });
    expect(
      await offline.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByLabel("会话操作 猫咪问候", { exact: true }).click();
    await page
      .getByRole("button", { name: "删除会话 猫咪问候", exact: true })
      .click();
    await page.getByRole("button", { name: "保留会话" }).click();
    await expect(page.locator(".conversation-heading h1")).toHaveText(
      "猫咪问候",
    );
    await page.getByLabel("会话操作 猫咪问候", { exact: true }).click();
    await page
      .getByRole("button", { name: "删除会话 猫咪问候", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(page.locator(".conversation-heading h1")).toHaveText(
      "今天想做什么？",
    );
    await expect(second.locator(".conversation-heading h1")).toHaveText(
      "今天想做什么？",
    );
    await page.reload();
    await expect(page.getByRole("navigation")).not.toContainText("猫咪问候");
  } finally {
    await app.close();
  }
});
