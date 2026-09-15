import { test, expect } from "@playwright/test";
import { startWeb } from "../../src/server/app.js";
import { temporary, key, reasoning, callItem, response, textItem } from "../helpers.js";
import { resolve } from "node:path";
let app: Awaited<ReturnType<typeof startWeb>>;
let searches: number;
let inputs: string[];
test.beforeEach(async () => {
  searches = 0; inputs = [];
  let turns = 0;
  app = await startWeb({
    workspace: await temporary(), home: await temporary(), apiKey: key, naming: false,
    staticDir: resolve("dist/web-dist"),
    runtime: {
      fetch: async (url, init) => {
        if (String(url).endsWith("/messages")) {
          searches++;
          return Response.json({ content: [{ type: "server_tool_use", name: "web_search", id: "s" }, { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", title: "示例网页", url: "https://example.com/page" }] }], stop_reason: "end_turn" });
        }
        inputs.push(String(init?.body));
        if (++turns === 1) return response([reasoning, callItem("web_search", { query: "示例" }, "search")]);
        return response([textItem("搜索完成，参考[网页](https://example.com/page)。")]);
      },
    },
  });
});
test.afterEach(async () => { await app?.close(); });
test("favicon shares the brand resource and search evidence survives reload", async ({ page }) => {
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
  await page.getByRole("textbox", { name: "任务内容" }).fill("搜索示例");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(page.locator(".conversation-heading")).toContainText("已完成");
  const sources = page.getByRole("region", { name: "搜索来源" });
  await expect(sources).toContainText("示例网页");
  expect(searches).toBe(1);
  for (const input of inputs) {
    const body = JSON.parse(input);
    expect(body.tools.some((tool: { name: string }) => tool.name === "web_fetch")).toBe(false);
    expect(body.instructions).not.toContain("web_fetch");
  }
  await page.reload();
  await expect(sources).toContainText("示例网页"); expect(searches).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sources).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
