import { test, expect } from "@playwright/test";
import { startWeb } from "../../src/server/app.js";
import {
  temporary,
  key,
  response,
  textItem,
  callItem,
  reasoning,
  delay,
} from "../helpers.js";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
let app: Awaited<ReturnType<typeof startWeb>>;
let calls = 0;
test.beforeEach(async () => {
  calls = 0;
  app = await startWeb({
    workspace: await temporary(),
    home: await temporary(), naming: false,
    apiKey: key,
    staticDir: resolve("dist/web-dist"),
    runtime: {
      fetch: async (_u, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        const prompt =
          body.input.filter((i: any) => i.role === "user").at(-1)?.content[0]
            ?.text ?? "";
        if (prompt.includes("wait"))
          return await new Promise<Response>((_r, reject) =>
            init!.signal!.addEventListener(
              "abort",
              () => reject(new Error("cancel")),
              { once: true },
            ),
          );
        await delay(100);
        return calls === 1
          ? response([
              reasoning,
              callItem("write", {
                path: "hello.txt",
                content: "hello browser\n",
              }),
            ])
          : response([
              textItem(
                "## 任务已完成\n\n- **写入**文件\n- 验证结果\n\n| 文件 | 状态 |\n| --- | --- |\n| hello.txt | 完成 |\n\n```ts\nconst ready = true;\n```\n\n<script>window.hacked=true</script>\n\n[危险](javascript:alert(1))\n\n![远程图片](https://example.com/track.png)",
              ),
            ]);
      },
    },
  });
});
test.afterEach(async () => {
  await app.close();
});
test("submits, observes tool diff, inspects request, reloads, continues and exports", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.url);
  await expect(page.getByText("已连接", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "新建会话", exact: false }).click();
  await page
    .getByRole("textbox", { name: "任务内容" })
    .fill("write a greeting");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(
    page.locator(".conversation-heading").getByText("已完成", { exact: true }),
  ).toBeVisible();
  expect(
    await readFile(join(app.sessions.workspace, "hello.txt"), "utf8"),
  ).toBe("hello browser\n");
  expect(calls).toBe(2);
  await expect(page.locator(".markdown h2").first()).toHaveText("任务已完成");
  await expect(page.locator(".markdown table").first()).toBeVisible();
  await expect(page.locator(".markdown pre code").first()).toContainText(
    "const ready = true;",
  );
  await expect(page.locator(".markdown img")).toHaveCount(0);
  await expect(page.locator('.markdown a[href^="javascript:"]')).toHaveCount(0);
  await expect(page).toHaveTitle("Nekomimi");
  await page
    .getByRole("button", { name: "查看文件 diff", exact: false })
    .click();
  await expect(page.locator(".artifact")).toContainText("+hello browser");
  await page
    .getByRole("button", { name: "检查调用", exact: false })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "总览", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".trace-flow")).toContainText("write a greeting");
  await expect(page.locator(".trace-flow")).toContainText("hello.txt");
  await expect(page.locator(".trace-flow")).toContainText("返回结果");
  await expect(page.locator(".trace-flow .trace-assistant")).toContainText(
    "任务已完成",
  );
  await expect(page.locator(".trace-entry.selected")).toHaveCount(1);
  await page.screenshot({ path: "test-results/trace.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".trace-flow")).toBeVisible();
  await page.screenshot({
    path: "test-results/trace-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "请求", exact: true }).click();
  await page.getByText("原始请求", { exact: true }).click();
  await expect(page.locator(".inspector .artifact")).toContainText(
    "tool_choice",
  );
  await page.getByRole("button", { name: "输入", exact: true }).click();
  await expect(page.locator(".sources")).toContainText("write a greeting");
  await expect(page.locator(".sources button").first()).toBeVisible();
  await page.locator(".sources button").first().click();
  await expect(
    page.getByRole("button", { name: "返回调用", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭检查面板" }).click();
  await page.reload();
  await expect(
    page.locator(".conversation-heading").getByText("已完成", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(2);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second
      .locator(".conversation-heading")
      .getByText("已完成", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(2);
  await page.getByRole("textbox", { name: "任务内容" }).fill("continue");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect.poll(() => calls).toBe(3);
  await expect(
    page.locator(".conversation-heading").getByText("已完成", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).hacked)).toBeUndefined();
  await page
    .getByRole("button", { name: "导出", exact: false })
    .first()
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 HTML" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("session.html");
  await page
    .getByRole("button", { name: "导出", exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "检查调用", exact: false })
    .last()
    .click();
  await page.getByRole("button", { name: "总览", exact: true }).click();
  await page.screenshot({ path: "test-results/workbench.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("cancels and remains usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app.url);
  await expect(page.getByText("已连接", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "任务内容" }).fill("wait");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(
    page.getByRole("button", { name: "停止任务", exact: false }),
  ).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  await page.context().setOffline(true);
  await expect(page.getByText("连接已断开", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.context().setOffline(false);
  await expect(page.getByText("● 已连接", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "停止任务", exact: false }),
  ).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "停止任务", exact: false }).click();
  await expect(
    page.locator(".conversation-heading").getByText("已停止", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await expect(
    page.getByRole("button", { name: "新建会话", exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("windows long history and pages context sources beyond a raw artifact page", async ({
  page,
}) => {
  const { Journal, hash } = await import("../../src/journal.js");
  const session = await app.sessions.create("长历史验收");
  const entry = await app.sessions.entry(session.id);
  const j = await Journal.open(entry.directory);
  try {
    for (let i = 0; i < 250; i++)
      await j.append(
        "context.add",
        {
          source: "user",
          item: {
            role: "user",
            content: [{ type: "input_text", text: `历史 ${i}` }],
          },
        },
        {},
        false,
      );
    const nodes = j.events
      .filter((e) => e.type === "context.add")
      .map((e) => ({
        seq: e.seq,
        eventId: e.eventId,
        itemIndex: 0,
        source: "user",
        hash: hash(JSON.stringify(e.payload)),
        item: (e.payload as any).item,
      }));
    await j.append(
      "context.view",
      {
        revision: "large",
        artifact: await j.artifact(
          JSON.stringify({
            revision: "large",
            nodes,
            prompt: {
              fragments: [{ source: "fixture", text: "大上下文".repeat(6000) }],
            },
          }),
        ),
      },
      { modelCallId: "large" },
    );
    await j.append(
      "attempt.started",
      { attempt: 1, model: "fixture" },
      { modelCallId: "large", attemptId: "large-a" },
    );
    await j.append(
      "attempt.finished",
      { status: "incomplete" },
      { modelCallId: "large", attemptId: "large-a" },
    );
  } finally {
    await j.close();
  }
  await page.goto(`${app.origin}/?session=${session.id}#token=${app.token}`);
  await expect(page.locator(".row")).toHaveCount(60);
  for (const count of [120, 180, 180]) {
    await page.getByRole("button", { name: "加载更早记录" }).click();
    await expect(page.locator(".row")).toHaveCount(count);
  }
  await page.locator('.conversation').evaluate(el=>{el.scrollTop=50;el.dispatchEvent(new Event('scroll'));});
  const live = await Journal.open(entry.directory);
  const updates = (async()=>{
    try {
      for(let i=0;i<8;i++) {
        await live.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:`持续输出 ${i}`}]}]},{runId:'stream-fixture',attemptId:'stream-fixture'});
        await delay(60);
      }
    } finally { await live.close(); }
  })();
  const inputStart = Date.now();
  await page.getByRole('textbox', {name:'任务内容'}).fill('长历史下的输入响应测试');
  await expect(page.getByRole('textbox', {name:'任务内容'})).toHaveValue('长历史下的输入响应测试');
  console.log(`180-row input fill and assertion: ${Date.now()-inputStart}ms`);
  await updates;
  await expect(page.locator('.row-assistant')).toContainText('持续输出 7');
  const distanceFromBottom=await page.locator('.conversation').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight);
  expect(distanceFromBottom).toBeGreaterThan(100);
  await expect(page.getByRole('textbox',{name:'任务内容'})).toHaveValue('长历史下的输入响应测试');
  await page.getByRole("button", { name: "回到最新记录" }).click();
  await expect(page.locator(".row")).toHaveCount(60);
  await page.getByRole("button", { name: "检查调用", exact: false }).click();
  await page.getByRole("button", { name: "输入", exact: true }).click();
  await expect(page.locator(".sources button")).toHaveCount(40);
  await page
    .getByRole("button", { name: "后续输入来源", exact: false })
    .click();
  await expect(page.locator(".sources button")).toHaveCount(40);
  await page.locator(".sources button").first().click();
  await expect(
    page.getByRole("button", { name: "返回调用", exact: false }),
  ).toBeVisible();
});

test('compact layout preserves controls and inspector focus at all target sizes', async ({ page }) => {
  await page.goto(app.url);
  await page.getByRole('textbox', {name:'任务内容'}).fill('整理项目结构');
  await page.getByRole('button', {name:'发送任务'}).click();
  await expect(page.locator('.conversation-heading')).toContainText('已完成');
  for (const [width,height] of [[1440,900],[1920,1080],[1280,720],[390,844]]) {
    await page.setViewportSize({width:width!,height:height!});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('textbox',{name:'任务内容'})).toBeInViewport();
    const trigger=page.getByRole('button',{name:'检查调用',exact:true}).first();
    await trigger.click();
    await expect(page.getByRole('button',{name:'关闭检查面板'})).toBeFocused();
    await expect(page.locator('.inspector')).toBeInViewport();
    if (process.env.NEKOMIMI_VISUAL_DIR) await page.screenshot({path:join(process.env.NEKOMIMI_VISUAL_DIR,`inspector-${width}.png`)});
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    if (process.env.NEKOMIMI_VISUAL_DIR) await page.screenshot({path:join(process.env.NEKOMIMI_VISUAL_DIR,`conversation-${width}.png`)});
  }
});

test("shows and downloads diagnostics even when durable cursor and status do not change", async ({page}) => {
  const session = await app.sessions.create("诊断测试");
  await page.goto(app.url);
  await page.getByRole("button", { name: /诊断测试/ }).click();
  await expect(page.getByText("已连接", { exact:false })).toBeVisible();
  await page.waitForTimeout(400);
  const entry = await app.sessions.entry(session.id);
  const before = entry.reader.cursor.seq;
  entry.diagnostics.push({version:1,id:"diagnostic-test",timestamp:new Date().toISOString(),sessionId:session.id,operation:"watermark.rename",code:"EPERM",category:"storage",platform:"win32",nodeVersion:"v22.19.0",seq:before+1,durableSeq:before});
  const notice=page.locator("details.error");
  await expect(notice.locator("summary")).toContainText("watermark.rename");
  await notice.locator("summary").click();
  const downloaded=page.waitForEvent("download");
  await notice.getByRole("button",{name:"下载诊断"}).click();
  const file=await downloaded;
  const data=JSON.parse(await readFile((await file.path())!,"utf8"));
  expect(data.authoritative).toBe(false);
  expect(data.diagnostics[0].code).toBe("EPERM");
  expect(entry.reader.cursor.seq).toBe(before);
});
