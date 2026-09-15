import { tmpdir } from "node:os";
import { ConfigStore } from "../dist/config/store.js";
const userSettings = await new ConfigStore().snapshot();
import { chromium } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startWeb, readSession } from "../dist/index.js";
if (!userSettings.apiKey) {
  if (!snapshot.events.some((e) => e.type === "session.title" && e.payload.source === "model"))
    throw new Error("Real model session naming did not complete");
  console.log("SKIPPED: 请先运行 nekomimi config 或在 Web 保存 API key");
  process.exit(0);
}
const workspace = await mkdtemp(join(tmpdir(), "nekomimi-web-live-"));
const testHome = join(workspace,"test-home");
const testConfig = new ConfigStore(testHome);
await testConfig.save("settings",{revision:0,model:userSettings.model,baseUrl:userSettings.baseUrl});
await testConfig.save("auth",{revision:0,apiKey:userSettings.apiKey});
const app = await startWeb({
  home:testHome,
  workspace,

  runtime: {
    tools: ["write"],
    maxOutputTokens: 2048,
    maxTurns: 4,
    timeoutMs: 90000,
  },
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(app.url);
  const input = page.getByRole("textbox", { name: "任务内容" });
  await input.fill(
    "Use write to create greeting.txt containing exactly synthetic web hello followed by a newline. Then briefly confirm. This is a synthetic integration test.",
  );
  await page.getByRole("button", { name: "发送任务" }).click();
  await page
    .locator(".conversation-heading .completed")
    .waitFor({ timeout: 120000 });
  if (
    (await readFile(join(workspace, "greeting.txt"), "utf8")) !==
    "synthetic web hello\n"
  )
    throw new Error("Written content differs");
  await page
    .getByRole("button", { name: "检查调用", exact: false })
    .last()
    .click();
  await page.getByRole("button", { name: "请求", exact: true }).click();
  await page.getByText("原始请求", { exact: true }).click();
  await page
    .locator(".inspector .artifact")
    .getByText("tool_choice", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "输入", exact: true }).click();
  await page.locator(".sources button").first().waitFor();
  await page.screenshot({ path: join(workspace, "web.png"), fullPage: true });
  const sessionId = new URL(page.url()).searchParams.get("session");
  await app.sessions.naming?.done;
  const snapshot = await readSession(
    join(app.sessions.root, sessionId),
  );
  if (!snapshot.events.some((e) => e.type === "session.title" && e.payload.source === "model"))
    throw new Error("Real model session naming did not complete");
  console.log(
    JSON.stringify(
      {
        workspace,
        sessionId,
        screenshot: join(workspace, "web.png"),
        status: "completed",
        attempts: snapshot.events
          .filter((e) => e.type === "attempt.finished")
          .map((e) => ({
            status: e.payload.status,
            httpStatus: e.payload.httpStatus,
            elapsedMs: e.payload.elapsedMs,
          })),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await app.close();
}
