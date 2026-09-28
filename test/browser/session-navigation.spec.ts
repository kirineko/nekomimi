import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { temporary, key } from "../helpers.js";

async function fixture() {
  const workspace=await temporary(),home=await temporary();
  return startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve("dist/web-dist"),runtime:{fetch:async()=>{throw new Error("unexpected model call");}}});
}
async function openDelete(page: Page, title: string) {
  await page.getByLabel(`会话操作 ${title}`, {exact:true}).click();
  await page.getByRole("button", {name:`删除会话 ${title}`,exact:true}).click();
}
const command=(name:string)=>({id:name,name:`/${name}`,insertText:`/${name}`,kind:"extension",source:"猫咪扩展",description:`${name} 猫咪问候`});

test("discovers a real /moe extension before execution and completes navigation/delete loop",async({page})=>{
  const app=await fixture();
  try{
    const root=join(app.sessions.workspace,".nekomimi/extensions/cat");
    await mkdir(root,{recursive:true});
    await writeFile(join(root,"extension.json"),JSON.stringify({name:"cat",sdkVersion:1,entry:"index.ts"}));
    await writeFile(join(root,"index.ts"),`export default api=>api.registerCommand('moe',{description:'猫咪问候',async handler(){return '喵，命令已执行';}});`);
    const management=await app.sessions.customization.describe();
    const resource=management.resources.find(r=>r.name==="cat")!;
    await app.sessions.customizationAction({action:"set",id:resource.id,enabled:true,trusted:true,revision:management.settingsRevision});
    await expect.poll(()=>app.sessions.customization.commands().commands.some(c=>c.name==="/moe")).toBe(true);
    const older=await app.sessions.create("旧会话"),other=await app.sessions.create("其他会话");
    await page.goto(app.url.replace("#",`?session=${older.id}#`));
    const input=page.getByRole("textbox",{name:"任务内容"});
    await input.fill("/mo");
    await expect(page.getByRole("option",{name:/\/moe/})).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveValue("/moe ");
    expect(app.sessions.active).toBeUndefined();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await input.press("Enter");
    await expect(page.locator(".timeline")).toContainText("喵，命令已执行");
    await expect(page.locator(".session-title").first()).toHaveText("/moe");
    await page.reload(); await expect(page.locator(".session-title").first()).toHaveText("/moe");
    await input.fill("保留这段草稿");
    await openDelete(page,"其他会话");
    await expect(page.getByRole("button",{name:"保留会话"})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog",{name:"删除会话"})).toHaveCount(0);
    await expect(page.getByLabel("会话操作 其他会话",{exact:true})).toBeFocused();
    await openDelete(page,"其他会话");
    await page.getByRole("button",{name:"确认删除"}).click();
    await expect(page.locator(".session-title")).toHaveCount(1);
    await expect(input).toHaveValue("保留这段草稿");
    await expect(page).toHaveURL(new RegExp(older.id));
    await openDelete(page,"/moe"); await page.getByRole("button",{name:"确认删除"}).click();
    await expect(page.locator(".conversation-heading h1")).toHaveText("今天想做什么？");
    expect((await app.sessions.list(0,30)).sessions.find(s=>s.id===other.id)).toBeUndefined();
  }finally{await app.close();}
});

test("compact sidebar menus, confirmation dismissal, busy/failure and paginated refresh preserve draft",async({page})=>{
  const app=await fixture();
  try{
    for(let i=0;i<33;i++) await app.sessions.create(`会话 ${String(i).padStart(2,"0")}`);
    await page.goto(app.url);
    await expect(page.locator(".session-title")).toHaveCount(30);
    await page.getByRole("textbox",{name:"任务内容"}).fill("未发送草稿");
    await app.sessions.create("分页期间新建");
    await page.getByRole("button",{name:"更多会话"}).click();
    await expect(page.locator(".session-title")).toHaveCount(34);
    await expect(page.locator(".session-title").first()).toHaveText("分页期间新建");
    await expect(page.getByRole("textbox",{name:"任务内容"})).toHaveValue("未发送草稿");
    await page.getByLabel("会话操作 分页期间新建",{exact:true}).click();
    await page.getByLabel("会话操作 会话 32",{exact:true}).click();
    await expect(page.locator(".session-menu")).toHaveCount(1);
    await page.getByRole("textbox",{name:"任务内容"}).click();
    await expect(page.locator(".session-menu")).toHaveCount(0);
    await page.getByLabel("会话操作 分页期间新建",{exact:true}).click(); await page.keyboard.press("Escape");
    await expect(page.locator(".session-menu")).toHaveCount(0);
    await openDelete(page,"分页期间新建");
    await page.getByRole("dialog").getByText("删除会话记录与附件，保留工作区文件。").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator(".delete-backdrop").click({position:{x:3,y:3}});
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openDelete(page,"分页期间新建");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button",{name:"关闭删除确认"})).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button",{name:"确认删除"})).toBeFocused();
    let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);let calls=0;
    await page.route("**/delete",async route=>{calls++;await gate;await route.fulfill({status:409,json:{error:{code:"busy",message:"会话正在运行"}}});});
    await page.getByRole("button",{name:"确认删除"}).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-busy","true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    finish();await expect(page.getByRole("alert")).toContainText("会话正在运行");
    expect(calls).toBe(1);
    await page.getByRole("button",{name:"关闭删除确认"}).click();
    const time=page.getByRole("button",{name:/活动时间 分页期间新建/});await time.click();
    await expect(page.locator(".session-time-full.is-visible")).toBeVisible();
    await mkdir("output/playwright/session-navigation",{recursive:true});
    await page.screenshot({path:"output/playwright/session-navigation/sidebar-desktop.png"});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:"打开会话列表"}).click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.screenshot({path:"output/playwright/session-navigation/sidebar-mobile.png"});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await app.close();}
});

test("command keyboard, IME, parameters, errors, reload and responsive presentation",async({page})=>{
  const app=await fixture();
  let fail=false, ready=true, names=["moe","more"], rev=1;
  try{
    await page.route("**/api/v1/commands",route=>route.fulfill(fail?{status:503,json:{error:{message:"unavailable"}}}:{json:{revision:String(rev),ready,commands:ready?names.map(command):[]}}));
    await page.goto(app.url);
    const input=page.getByRole("textbox",{name:"任务内容"});
    await input.fill("/mo");await expect(page.getByRole("option")).toHaveCount(2);
    await input.press("ArrowDown");await input.press("Tab");await expect(input).toHaveValue("/more ");
    await input.fill('/mo {"x":1}');await input.press("Home");await input.press("ArrowRight");await input.press("ArrowRight");await input.press("ArrowRight");
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.getByRole("option",{name:/\/moe/}).click();await expect(input).toHaveValue('/moe {"x":1}');
    await input.fill("/mo");await input.press("Escape");await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.waitForTimeout(150);await expect(page.getByRole("listbox")).toHaveCount(0);
    await input.fill("/mo");await input.dispatchEvent("compositionstart");await input.dispatchEvent("keydown",{key:"Enter",code:"Enter",isComposing:true});await expect(input).toHaveValue("/mo");
    await input.dispatchEvent("compositionend");await input.dispatchEvent("keydown",{key:"Enter",keyCode:229,isComposing:true});await expect(input).toHaveValue("/mo");
    await page.waitForTimeout(70);await input.press("Shift+Enter");await expect(input).toHaveValue("/mo\n");
    await input.fill("正文 /mo");await expect(page.getByRole("listbox")).toHaveCount(0);
    await input.fill("/tmp/file");await expect(page.getByRole("listbox")).toHaveCount(0);
    await input.fill("/nothing");await expect(page.getByText("没有匹配的命令，可继续手动输入")).toBeVisible();
    fail=true;await input.press("Escape");await input.fill("/");await expect(page.getByText("命令加载失败")).toBeVisible();
    fail=false;ready=false;await page.getByRole("button",{name:"重试命令"}).click();await expect(page.getByText("命令尚未就绪")).toBeVisible();
    ready=true;names=["fresh"];rev++;await page.getByRole("button",{name:"重试命令"}).click();await expect(page.getByRole("option")).toContainText("/fresh");
    await expect(input).toHaveValue("/");
    names=Array.from({length:12},(_,i)=>`command-${i}`);rev++;
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("option")).toHaveCount(12);
    await mkdir("output/playwright/session-navigation",{recursive:true});
    for(const [label,width,height] of [["desktop",1440,1000],["mobile",390,844],["zoom-200",720,450],["keyboard",390,430]] as const){
      await page.setViewportSize({width,height});
      await input.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await input.press("ArrowUp");
      await expect(page.getByRole("option",{selected:true})).toBeInViewport();
      const box=await page.locator(".command-popup").boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({path:`output/playwright/session-navigation/commands-${label}.png`});
    }
  }finally{await app.close();}
});


test("late command responses cannot replace a new catalog and failed submission retains draft",async({page})=>{
  const app=await fixture();
  let oldRelease!:()=>void;
  const oldGate=new Promise<void>(r=>oldRelease=r);
  let hold=false,held=false;
  try{
    await page.route("**/api/v1/commands",async route=>{
      if(hold&&!held){held=true;await oldGate;await route.fulfill({json:{revision:"old",ready:true,commands:[command("old")]}});}
      else await route.fulfill({json:{revision:"new",ready:true,commands:[command("new")]}});
    });
    await page.goto(app.url);
    const input=page.getByRole("textbox",{name:"任务内容"});
    await input.fill("/");await expect(page.getByRole("option")).toContainText("/new");
    hold=true;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect.poll(()=>held).toBe(true);
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("option")).toContainText("/new");
    oldRelease();await page.waitForTimeout(100);
    await expect(page.getByRole("option")).toContainText("/new");
    await page.route("**/submit",route=>route.fulfill({status:409,json:{error:{code:"busy",message:"测试任务繁忙"}}}));
    await input.press("Tab");await input.press("Enter");
    await expect(page.getByRole("alert")).toContainText("测试任务繁忙");
    await expect(input).toHaveValue("/new ");
  }finally{oldRelease();await app.close();}
});

test("date groups and long titles stay compact across midnight and list revision conflicts",async({page})=>{
  const app=await fixture();
  let calls=0, conflict=false;
  const base=new Date(2026,8,28,23,59,45);
  try{
    const a=await app.sessions.create("很长的会话标题".repeat(10)), b=await app.sessions.create("昨天的会话");
    const rows=[{...a,activityAt:new Date(2026,8,28,20).toISOString()},{...b,activityAt:new Date(2026,8,27,20).toISOString()}];
    await page.clock.install({time:base});
    await page.route("**/api/v1/sessions?*",async route=>{
      calls++;const url=new URL(route.request().url());
      if(url.searchParams.has("offset")){conflict=true;await route.fulfill({status:409,json:{error:{code:"list_changed",message:"changed"}}});}
      else await route.fulfill({json:{sessions:conflict?rows:[...rows,...Array.from({length:28},(_,i)=>({...b,id:`mock-${i}`,title:`旧会话 ${i}`,activityAt:rows[1]!.activityAt}))],next:conflict?undefined:30,listRevision:conflict?"new":"old"}});
    });
    await page.goto(app.url);
    await expect(page.getByRole("heading",{name:"今天",exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:"昨天",exact:true})).toBeVisible();
    const input=page.getByRole("textbox",{name:"任务内容"});await input.fill("持续编辑");
    await page.getByRole("button",{name:"更多会话"}).click();
    await expect.poll(()=>conflict).toBe(true);
    await expect(page.locator(".session-title")).toHaveCount(2);await expect(input).toHaveValue("持续编辑");
    await page.clock.runFor(31000);
    await expect(page.getByRole("heading",{name:"今天",exact:true})).toHaveCount(0);
    await expect(page.getByRole("heading",{name:"近 7 天",exact:true})).toBeVisible();
    const before=calls;await page.evaluate(()=>window.dispatchEvent(new Event("online")));await expect.poll(()=>calls).toBeGreaterThan(before);
    await expect(input).toHaveValue("持续编辑");
    const title=page.locator(".session-title").first();expect(await title.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    await mkdir("output/playwright/session-navigation",{recursive:true});
    await page.screenshot({path:"output/playwright/session-navigation/groups-long-title.png"});
  }finally{await app.close();}
});
