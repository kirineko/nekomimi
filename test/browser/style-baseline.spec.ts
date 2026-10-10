import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { delay, key, response, temporary, textItem } from "../helpers.js";

/**
 * 1.3 样式基线：preflight + @layer base 生效，链接无浏览器默认下划线/颜色，
 * 富文本列表与标题保留排版，分隔条为细线。
 */
let app: Awaited<ReturnType<typeof startWeb>>;

test.beforeEach(async () => {
  app = await startWeb({
    workspace: await temporary(),
    home: await temporary(),
    naming: false,
    apiKey: key,
    staticDir: resolve("dist/web-dist"),
    runtime: { fetch: async () => { await delay(30); return response([textItem("## 标题\n\n- 第一项\n- 第二项")]); } },
  });
});

test.afterEach(async () => {
  await app.close();
});

test("base layer resets links and keeps rich content typography", async ({ page }) => {
  const session = await app.sessions.create("样式基线");
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);

  // 导航链接：继承前景色、无下划线
  const link = page.getByRole("link", { name: "样式基线", exact: true });
  await expect(link).toBeVisible();
  const linkStyle = await link.evaluate((el) => {
    const style = getComputedStyle(el);
    return { decoration: style.textDecorationLine, color: style.color };
  });
  expect(linkStyle.decoration).not.toContain("underline");
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  expect(linkStyle.color).toBe(ink);

  // 富文本：标题有字号、列表有项目符号
  await page.getByLabel("任务草稿", { exact: true }).fill("渲染");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const rich = page.locator("[data-rich-content]");
  await expect(rich.locator("li").first()).toBeVisible();
  await expect(rich.locator("ul")).toHaveCSS("list-style-type", "disc");
  const h2Size = await rich.locator("h1,h2,h3").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const bodySize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  expect(h2Size).toBeGreaterThan(bodySize);
});
