import { test, expect } from "@playwright/test";
import { startWeb } from "../../src/server/app.js";
import { temporary, key, reasoning, callItem, response, textItem } from "../helpers.js";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let app: Awaited<ReturnType<typeof startWeb>>;
let fetches: number;
let searches: number;
let inputs: string[];
let challenge: boolean;
test.beforeEach(async () => {
  fetches = 0; searches = 0; inputs = []; challenge = false;
  let turns = 0;
  app = await startWeb({
    workspace: await temporary(), home: await temporary(), apiKey: key, naming: false,
    staticDir: resolve("dist/web-dist"),
    runtime: {
      toolOptions: { webFetch: { network: {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        request: async () => {
          fetches++;
          if (challenge) return { response: new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }), close: async () => {} };
          return { response: new Response('<html><head><title>抓取示例</title><meta name="description" content="这里是网页提供的题目摘要。"></head><body>Loading<script>window.fetchAttack=true</script></body></html>', { headers: { "content-type": "text/html" } }), close: async () => {} };
        },
      } } },
      fetch: async (url, init) => {
        if (String(url).endsWith("/messages")) {
          searches++;
          return Response.json({ content: [{ type: "server_tool_use", name: "web_search", id: "s" }, { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", title: "示例网页", url: "https://example.com/page" }] }], stop_reason: "end_turn" });
        }
        inputs.push(String(init?.body));
        if (++turns === 1) return response([reasoning, callItem("web_search", { query: "示例" }, "search")]);
        if (turns === 2) return response([callItem("web_fetch", { url: "https://example.com/page" }, "fetch")]);
        return response([textItem("读取完成。这是[网页](https://example.com/page)提供的摘要。")]);
      },
    },
  });
});
test.afterEach(async () => { await app?.close(); });
test("favicon shares the brand resource and search→fetch evidence survives reload", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(app.url);
  const favicon = page.locator('link[rel="icon"]');
  const href = await favicon.getAttribute("href"); expect(href).toMatch(/^\/assets\/nekomimi-.*\.svg$/);
  const icon = await page.request.get(new URL(href!, app.url).href);
  expect(icon.status()).toBe(200); expect(icon.headers()["content-type"]).toBe("image/svg+xml");
  expect(await icon.text()).toContain('fill="#7952ce"');
  await expect(page.locator("img.cat-mark").first()).toHaveAttribute("src", href!);
  expect(await page.locator("img.cat-mark").first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Decode at a real favicon size, rather than merely checking the resource exists.
  expect(await page.evaluate(async (url) => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0, 16, 16);
    return [...ctx.getImageData(0, 0, 16, 16).data].filter((_, i) => i % 4 === 3).some(alpha => alpha > 0);
  }, href!)).toBe(true);
  await page.getByRole("textbox", { name: "任务内容" }).fill("搜索后读取网页");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(page.locator(".conversation-heading")).toContainText("已完成");
  const summary = page.getByRole("region", { name: "网页读取结果" });
  await expect(summary).toContainText("抓取示例"); await expect(summary).toContainText("页面摘要");
  await expect(summary).toContainText("HTTP 200");
  expect(fetches).toBe(1); expect(searches).toBe(1);
  expect(inputs.at(-1)).toContain("这里是网页提供的题目摘要");
  expect(inputs.at(-1)).toContain("untrusted data");
  expect(await page.evaluate(() => (window as any).fetchAttack)).toBeUndefined();
  const card = page.locator(".row-tool").filter({ has: summary });
  await card.locator(".tool-details > summary").click();
  await card.getByRole("button", { name: "完整结果 ↗" }).last().click();
  await expect(card.locator(".artifact")).toContainText("这里是网页提供的题目摘要");
  await page.reload();
  await expect(summary).toContainText("页面摘要"); expect(fetches).toBe(1); expect(searches).toBe(1);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/web-fetch-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "output/playwright/web-fetch-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("browser challenge remains a failed fetch after reload", async ({ page }) => {
  challenge = true;
  await page.goto(app.url);
  await page.getByRole("textbox", { name: "任务内容" }).fill("读取网页");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(page.locator(".conversation-heading")).toContainText("已完成");
  const summary = page.getByRole("region", { name: "网页读取结果" });
  await expect(summary).toContainText("读取失败");
  await expect(summary).toContainText("HTTP 403");
  const card = page.locator(".row-tool").filter({ has: summary });
  await expect(card).toContainText("网站要求浏览器验证");
  expect(inputs.at(-1)).toContain("网站要求浏览器验证");
  expect(inputs.at(-1)).not.toContain("Just a moment");
  await page.reload();
  await expect(card).toContainText("网站要求浏览器验证");
  expect(fetches).toBe(1);
});
