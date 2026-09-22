import { test, expect } from "@playwright/test";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startWeb } from "../../src/server/app.js";
import { temporary, key } from "../helpers.js";
import { Candidates } from "../../src/customization/candidates.js";
import { Packages } from "../../src/customization/packages.js";
test('previews an unactivated candidate panel and places its recorded contribution in the sidebar',async({page})=>{
 const workspace=await temporary(),home=await temporary(),store=new Candidates(workspace),draft=await store.scaffold('sidebar-panel');const {readFile}=await import('node:fs/promises');
 await writeFile(join(draft.path,'extension.json'),JSON.stringify({name:'sidebar-panel',sdkVersion:2,entry:'index.ts',requiredCapabilities:['panels','commands','ui']}));
 await writeFile(join(draft.path,'index.ts'),(await readFile(resolve('extension-docs/panel-extension.ts'),'utf8')).replace("slot:'result'","slot:'sidebar'"));await copyFile(resolve('extension-docs/review-panel.ts'),join(draft.path,'review-panel.ts'));
 const app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve('dist/web-dist')});
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('button',{name:`检查候选 ${draft.id}`,exact:true}).click();await page.getByLabel('候选面板数据 JSON').fill('{"items":["Unactivated candidate"]}');await page.getByRole('button',{name:'授权执行候选工厂并预览面板'}).click();await expect(page.frameLocator('iframe').getByText('Unactivated candidate',{exact:true})).toBeVisible();expect(await store.active()).toHaveLength(0);
  await page.getByRole('button',{name:'授权并启用此版本'}).click();await expect(page.getByRole('dialog')).toContainText('已生效');await page.getByRole('button',{name:'关闭定制能力'}).click();await page.getByLabel('任务内容').fill('/review-panel');await page.getByRole('button',{name:'发送任务'}).click();await expect(page.getByRole('complementary',{name:'扩展侧栏'})).toContainText('审查结果');await page.reload();await expect(page.getByRole('complementary',{name:'扩展侧栏'})).toContainText('审查结果');
 }finally{await app.close();}
});
test('reconciles an unknown workflow result in the browser without repeating its external effect',async({page})=>{
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/unknown');await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'unknown',sdkVersion:2,entry:'index.ts',requiredCapabilities:['workflows','tools']}));
 await writeFile(join(root,'index.ts'),`import type {ExtensionFactory2} from 'nekomimi/extensions';export default ((api)=>{api.registerWorkflow({id:'unknown-review',schemaVersion:1,inputSchema:{type:'object'},entry:'effect',steps:{effect:{transitions:[],async execute(_input,ctx){await ctx.callTool('write',{path:'external.txt',content:'one recorded effect'});throw Error('Injected failure after external effect');}}}})}) satisfies ExtensionFactory2;`);
 const options={workspace,home,naming:false,staticDir:resolve('dist/web-dist')};let app=await startWeb(options);
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('button',{name:'信任并启用 unknown'}).click();await expect(page.getByRole('dialog')).toContainText('已生效');
  const value=await page.getByLabel('工作流定义').locator('option').nth(1).getAttribute('value');await page.getByLabel('工作流定义').selectOption(value!);await page.getByRole('button',{name:'启动工作流',exact:true}).click();await expect(page.getByRole('region',{name:'核对未知结果'})).toBeVisible();
  await app.close();app=await startWeb(options);await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();await expect(page.getByRole('region',{name:'核对未知结果'})).toBeVisible();
  await page.getByLabel('核对记录').fill('外部文件已核验，只执行过一次');await page.getByLabel('核对后的结果 JSON').fill('{"kind":"complete","output":{"verified":true}}');await page.getByRole('button',{name:'提交已核对结果'}).click();await expect(page.getByRole('article',{name:'工作流 unknown-review'})).toContainText('已完成');
  await page.getByRole('button',{name:'查看工作流证据'}).click();await expect(page.getByRole('region',{name:'工作流证据'})).toContainText('workflow.unknown.resolved');
  const {readdir,readFile}=await import('node:fs/promises'),{readSession}=await import('../../src/journal.js');const [flow]=await readdir(join(workspace,'.nekomimi/workflows'));const journal=await readSession(join(workspace,'.nekomimi/workflows',flow!));expect(journal.events.filter(e=>e.type==='tool.intent'&&(e.payload as any).name==='write')).toHaveLength(1);expect(await readFile(join(workspace,'external.txt'),'utf8')).toBe('one recorded effect');
 }finally{await app.close();}
});
test("restores a durable workflow form after service restart and continues only after an explicit answer", async ({ page }) => {
  const workspace = await temporary(), home = await temporary(), root = join(workspace, ".nekomimi/extensions/durable");
  await mkdir(root, { recursive: true }); await writeFile(join(workspace, "review.txt"), "Review this fixture");
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "durable", sdkVersion: 2, entry: "index.ts", requiredCapabilities: ["workflows", "tools", "workspace-state"] }));
  await copyFile(resolve("extension-docs/durable-review.ts"), join(root, "index.ts"));
  const options = { workspace, home, naming: false, staticDir: resolve("dist/web-dist") };
  let app = await startWeb(options);
  try {
    await page.goto(app.url); await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await page.getByRole("button", { name: "信任并启用 durable" }).click();
    await expect(page.getByRole("dialog")).toContainText("已生效");
    const value = await page.getByLabel("工作流定义").locator("option").nth(1).getAttribute("value");
    await page.getByLabel("工作流定义").selectOption(value!);
    await page.getByLabel("工作流输入 JSON").fill('{"target":"review.txt"}');
    await page.getByRole("button", { name: "启动工作流", exact: true }).click();
    await expect(page.getByRole("form", { name: "审查确认" })).toBeVisible();
    await app.close(); app = await startWeb(options);
    await page.goto(app.url); await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await expect(page.getByRole("form", { name: "审查确认" })).toBeVisible();
    await page.getByLabel("审查决定").selectOption("通过");
    await page.getByRole("button", { name: "提交并继续工作流" }).click();
    await expect(page.getByRole("article", { name: "工作流 durable-review" })).toContainText("已完成");
    await expect(page.getByRole("form", { name: "审查确认" })).toHaveCount(0);
    await page.getByRole("button", { name: "查看工作流证据" }).click();
    await expect(page.getByRole("region", { name: "工作流证据" })).toContainText("workflow.step.started");
    await page.reload(); await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await expect(page.getByRole("article", { name: "工作流 durable-review" })).toContainText("已完成");
  } finally { await app.close(); }
});
test("configures a custom Provider without a default key, selects it and executes a recorded tool round", async ({ page }) => {
  const workspace = await temporary(), home = await temporary(), root = join(workspace, ".nekomimi/extensions/providers");
  await mkdir(root, { recursive: true }); await writeFile(join(workspace, "sample.txt"), "Browser provider input");
  await writeFile(join(root, "extension.json"), JSON.stringify({ name: "providers", sdkVersion: 2, entry: "index.ts", requiredCapabilities: ["providers"] }));
  await copyFile(resolve("extension-docs/http-providers.ts"), join(root, "index.ts"));
  let requests = 0;
  const app = await startWeb({ workspace, home, naming: false, staticDir: resolve("dist/web-dist"), runtime: { fetch: async (_url, init) => {
    const body = JSON.parse(String(init!.body)); expect(body.model).toBe("fixture-model");
    return Response.json({ choices: [{ message: ++requests === 1 ? { role: "assistant", content: null, tool_calls: [{ id: "browser-read", type: "function", function: { name: "read", arguments: '{"path":"sample.txt"}' } }] } : { role: "assistant", content: "Custom Provider completed" }, finish_reason: requests === 1 ? "tool_calls" : "stop" }] });
  } } });
  try {
    await page.goto(app.url); await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await page.getByRole("button", { name: "信任并启用 providers" }).click();
    await expect(page.getByRole("dialog")).toContainText("已生效");
    await page.getByLabel("模型配置名称").fill("browser-profile");
    await page.getByLabel("自定义 Provider", { exact: true }).selectOption("example-chat");
    await page.getByLabel("Provider 服务地址").fill("https://fixture.invalid/v1");
    await page.getByRole("button", { name: "授权并保存模型配置" }).click();
    await expect(page.getByRole("dialog")).toContainText("模型配置已保存");
    await page.getByLabel("主对话模型").selectOption("browser-profile");
    await expect(page.getByLabel("主对话模型")).toHaveValue("browser-profile");
    await page.getByRole("button", { name: "关闭定制能力" }).click();
    await page.getByRole("textbox", { name: "任务内容" }).fill("Read sample.txt using the custom Provider");
    await expect(page.getByRole("button", { name: "发送任务" })).toBeEnabled();
    await page.getByRole("button", { name: "发送任务" }).click();
    await expect(page.locator(".timeline")).toContainText("Custom Provider completed");
    await expect(page.locator(".conversation-heading")).toContainText("已完成"); expect(requests).toBe(2);
    await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await page.getByRole("button", { name: "创建跨 Provider 历史分支" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".timeline")).toContainText("显式历史分支");
    expect(requests).toBe(2);
  } finally { await app.close(); }
});
test("reviews a package, installs its command and uninstalls without erasing history", async ({ page }) => {
  const workspace = await temporary(), home = await temporary(), source = join(workspace, "bundle");
  await mkdir(source);
  await writeFile(join(source, "nekomimi.json"), JSON.stringify({ manifestVersion: 1, name: "browser-package", version: "1.0.0", sdkVersion: 2, requiredCapabilities: ["commands"], dependencies: {}, resources: [{ kind: "extension", name: "browser-package", entry: "index.ts" }] }));
  await writeFile(join(source, "index.ts"), `import type {ExtensionFactory} from 'nekomimi/extensions'; export default ((api)=>{api.registerCommand('package-browser',{description:'package',async handler(){return 'Browser package evidence'}})}) satisfies ExtensionFactory;`);
  const packages = new Packages(workspace, home);
  await packages.prepare({ kind: "local", path: source }, "project");
  const app = await startWeb({ workspace, home, apiKey: key, naming: false, staticDir: resolve("dist/web-dist") });
  try {
    await page.goto(app.url);
    await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await page.getByRole("button", { name: /^检查能力包 browser-package/ }).click();
    await expect(page.getByRole("dialog")).toContainText("能力包检查通过");
    await expect(page.getByRole("dialog")).toContainText("commands");
    await page.getByRole("button", { name: "授权并安装能力包" }).click();
    await expect(page.getByRole("region", { name: "已安装能力包" })).toContainText("browser-package");
    await page.getByRole("button", { name: "关闭定制能力" }).click();
    await page.getByRole("textbox", { name: "任务内容" }).fill("/package-browser");
    await page.getByRole("button", { name: "发送任务" }).click();
    await expect(page.locator(".timeline")).toContainText("Browser package evidence");
    await expect(page.locator(".conversation-heading")).toContainText("已完成");
    await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await page.getByRole("button", { name: "导出能力包到工作区" }).click();
    await page.getByRole("button", { name: "卸载能力包 browser-package" }).click();
    await expect.poll(async () => (await packages.list()).length).toBe(0);
    await page.getByRole("button", { name: "关闭定制能力" }).click();
    await page.reload();
    await expect(page.locator(".timeline")).toContainText("Browser package evidence");
  } finally { await app.close(); }
});
test("checks candidate diagnostics, activates an approved hash and rolls back without losing history", async ({ page }) => {
  const workspace = await temporary(), home = await temporary();
  const store = new Candidates(workspace);
  const candidate = await store.scaffold("candidate-review");
  const originalHash = (await store.inspect(candidate.id)).candidate.contentHash;
  const app = await startWeb({ workspace, home, apiKey: key, naming: false, staticDir: resolve("dist/web-dist") });
  try {
    await page.goto(app.url);
    const open = async () => page.getByRole("button", { name: "定制能力", exact: true }).click();
    const inspect = async () => page.getByRole("button", { name: `检查候选 ${candidate.id}`, exact: true }).click();
    await open(); await inspect();
    await expect(page.getByRole("dialog")).toContainText("完整类型检查通过");
    await expect(page.getByRole("dialog")).toContainText("新增授权：commands");
    await page.getByRole("button", { name: "授权并启用此版本" }).click();
    await expect(page.getByRole("dialog")).toContainText("已生效");
    const command = async () => {
      await page.getByRole("button", { name: "关闭定制能力" }).click();
      await page.getByRole("textbox", { name: "任务内容" }).fill("/candidate-review");
      await page.getByRole("button", { name: "发送任务" }).click();
      await expect(page.locator(".conversation-heading")).toContainText("已完成");
    };
    await command(); await expect(page.locator(".timeline")).toContainText("Ready");
    await writeFile(join(candidate.path, "index.ts"), "const wrong: number = 'string'; export default () => {}; ");
    await open(); await inspect();
    await expect(page.getByRole("dialog")).toContainText("类型检查未通过");
    await expect(page.getByRole("dialog")).toContainText("index.ts:1:");
    await expect(page.getByRole("button", { name: "授权并启用此版本" })).toBeDisabled();
    await writeFile(join(candidate.path, "index.ts"), `import type { ExtensionFactory } from 'nekomimi/extensions'; export default ((api)=>{api.registerCommand('candidate-review',{description:'review',async handler(){return 'Candidate second version'}})}) satisfies ExtensionFactory;`);
    await inspect(); await expect(page.getByRole("dialog")).toContainText("完整类型检查通过");
    await page.getByRole("button", { name: "授权并启用此版本" }).click();
    await expect(page.getByRole("button", { name: /^回退 candidate-review 到/ })).toBeVisible();
    await command(); await expect(page.locator(".timeline")).toContainText("Candidate second version");
    await open(); await page.getByRole("button", { name: /^回退 candidate-review 到/ }).click();
    await expect.poll(async () => (await store.active())[0]?.revision).toBe(originalHash);
    await command();
    await expect(page.locator(".timeline")).toContainText("Ready");
    await expect(page.locator(".timeline")).toContainText("Candidate second version");
  } finally { await app.close(); }
});
test("enable extension, use form, reload a changed command and retain history", async ({
  page,
}) => {
  const workspace = await temporary();
  const home = await temporary();
  const root = join(workspace, ".nekomimi/extensions/review");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "extension.json"),
    JSON.stringify({ name: "review", sdkVersion: 1, entry: "index.ts" }),
  );
  await writeFile(
    join(root, "index.ts"),
    `export default api=>{api.registerCommand('inspect',{description:'Inspect',async handler(args,ctx){const a=await ctx.ui({kind:'form',title:'审查选项',fields:[{name:'scope',label:'检查范围',required:true,options:['全部','当前文件']}]});await ctx.ui({kind:'card',title:'审查完成',text:'已检查 '+a.scope+' <script>window.extensionExecuted=true</script>'});return '审查完成';}});}`,
  );
  const app = await startWeb({
    workspace,
    home,
    apiKey: key,
    naming: false,
    staticDir: resolve("dist/web-dist"),
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(app.url);
    await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "定制能力" })).toContainText(
      "待授权",
    );
    await page.getByRole("button", { name: "信任并启用 review" }).click();
    await expect(page.getByRole("dialog")).toContainText("已生效");
    await page.getByRole("button", { name: "关闭定制能力" }).click();
    await page.getByRole("textbox", { name: "任务内容" }).fill("/inspect");
    await page.getByRole("button", { name: "发送任务" }).click();
    await page.getByLabel("检查范围").waitFor();
    await page.reload();
    await page.getByLabel("检查范围").selectOption("全部");
    await page.getByRole("button", { name: "提交回答" }).click();
    await expect(page.locator(".conversation-heading")).toContainText("已完成");
    await expect(page.locator(".timeline")).toContainText("已检查 全部");
    await writeFile(
      join(root, "index.ts"),
      `export default api=>{api.registerCommand('inspect',{description:'Inspect',async handler(){return '第二版审查';}});}`,
    );
    await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await page.getByRole("button", { name: "重新加载资源" }).click();
    await expect(page.getByRole("dialog")).toContainText("已生效");
    await page.getByRole("button", { name: "关闭定制能力" }).click();
    await page.getByRole("textbox", { name: "任务内容" }).fill("/inspect");
    await page.getByRole("button", { name: "发送任务" }).click();
    await expect(page.locator(".timeline")).toContainText("第二版审查");
    await page.reload();
    await expect(page.locator(".timeline")).toContainText("已检查 全部");
    await writeFile(join(root, "index.ts"), "export default !!!");
    await page.getByRole("button", { name: "定制能力", exact: true }).click();
    await page.getByRole("button", { name: "重新加载资源" }).click();
    await expect(page.getByRole("dialog")).toContainText("失败");
    await expect(page.getByRole("dialog")).toContainText("index.ts");
    await page.getByRole("button", { name: "停用并撤销授权 review" }).click();
    await expect(page.getByRole("dialog")).toContainText("已停用");
    expect(await page.evaluate(() => (window as any).extensionExecuted)).toBeUndefined();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('isolates custom panels, preserves host controls, and rejects conflicting workflow answers across windows', async ({page,context})=>{
  await context.addInitScript(()=>{
    if(window===top)return;
    parent.postMessage({kind:'ready',version:1,instanceId:location.pathname.split('/').at(-2),nonce:'forged-nonce'},'*');
    window.addEventListener('message',event=>{if(event.source===parent&&event.data?.kind==='connect'&&event.ports[0]){(window as any).fixturePort=event.ports[0];(window as any).fixtureInstance=event.data.instanceId;}});
  });
  const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/panels');await mkdir(root,{recursive:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({name:'panels',sdkVersion:2,entry:'index.ts',requiredCapabilities:['panels','commands','ui','workflows']}));
  const {readFile}=await import('node:fs/promises');
  const extension=(await readFile(resolve('extension-docs/panel-extension.ts'),'utf8')).replace('}) satisfies ExtensionFactory2;',`api.registerWorkflow({id:'panel-review',schemaVersion:1,inputSchema:{type:'object'},entry:'wait',steps:{wait:{transitions:['done'],async execute(input){return {kind:'wait',step:'done',input,form:{kind:'form',title:'Panel approval',fields:[{name:'decision',label:'Decision',required:true,options:['approve','reject']}]}};}},done:{transitions:[],async execute(input){return {kind:'complete',output:input};}}}});}) satisfies ExtensionFactory2;`);
  await writeFile(join(root,'index.ts'),extension);await copyFile(resolve('extension-docs/review-panel.ts'),join(root,'review-panel.ts'));
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist')});
  try{
    await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('button',{name:'信任并启用 panels'}).click();await expect(page.getByRole('dialog')).toContainText('已生效');
    const definition=await page.getByLabel('工作流定义').locator('option').nth(1).getAttribute('value');await page.getByLabel('工作流定义').selectOption(definition!);await page.getByRole('button',{name:'启动工作流',exact:true}).click();await expect(page.getByRole('form',{name:'Panel approval'})).toBeVisible();
    const other=await context.newPage();await other.goto(app.origin);await other.getByRole('button',{name:'定制能力',exact:true}).click();
    for(const tab of [page,other]){
      await expect(tab.getByLabel('面板定义').locator('option')).toHaveCount(2);
      const panel=await tab.getByLabel('面板定义').locator('option').nth(1).getAttribute('value');await tab.getByLabel('面板定义').selectOption(panel!);await tab.getByLabel('面板数据 JSON').fill('{"items":["Alpha","Beta"]}');
      const flow=await tab.getByLabel('关联工作流').locator('option').nth(1).getAttribute('value');await tab.getByLabel('关联工作流').selectOption(flow!);await tab.getByRole('button',{name:'打开面板',exact:true}).click();
      await expect(tab.frameLocator('iframe').getByText('Alpha',{exact:true})).toBeVisible();
    }
    await page.getByLabel('面板主题').selectOption('dark');
    await expect(page.frameLocator('iframe').getByText('Alpha',{exact:true})).toBeVisible();
    await expect.poll(async()=>page.frames().find(f=>f.parentFrame())?.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 17, 17)');
    const frame=page.frames().find(f=>f.parentFrame())!;
    expect(await frame.evaluate(()=>{try{return parent.document.body.innerHTML;}catch{return 'blocked';}})).toBe('blocked');
    expect(await frame.evaluate(()=>{try{return document.cookie;}catch{return 'blocked';}})).toBe('blocked');
    expect(await frame.evaluate(async()=>{try{await fetch('/api/v1/config');return 'allowed';}catch{return 'blocked';}})).toBe('blocked');
    await page.frameLocator('iframe').getByLabel('筛选审查项').fill('Beta');await expect(page.frameLocator('iframe').getByText('Alpha',{exact:true})).toHaveCount(0);
    await page.frameLocator('iframe').getByRole('button',{name:'确认审查'}).click();await expect(page.frameLocator('iframe').locator('p')).toContainText('ready');
    await other.frameLocator('iframe').getByLabel('审查决定').selectOption('reject');
    await other.frameLocator('iframe').getByRole('button',{name:'确认审查'}).click();await expect(other.frameLocator('iframe').locator('p')).toContainText('冲突');
    await other.frameLocator('iframe').getByLabel('审查决定').selectOption('approve');
    // Same answer from the stale second window is idempotent and does not advance the step.
    await other.frameLocator('iframe').getByRole('button',{name:'确认审查'}).click();await expect(other.frameLocator('iframe').locator('p')).toContainText('ready');
    await expect(page.getByRole('article',{name:'工作流 panel-review'})).toContainText('可继续');
    await frame.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{message:'fixture crash'})));
    await expect(page.getByRole('region',{name:'自定义面板 review-panel'})).toContainText('组件运行失败');await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'关闭定制能力'})).toBeVisible();await expect(page.getByRole('button',{name:'取消工作流'})).toBeVisible();
    await page.getByRole('button',{name:'预览面板',exact:true}).click();await expect(page.frameLocator('iframe').getByText('Alpha',{exact:true})).toBeVisible();
    const previewFrame=page.frames().find(f=>f.parentFrame())!;
    expect(await previewFrame.evaluate(()=>{try{top!.location.href='https://example.invalid/';return 'allowed';}catch{return 'blocked';}})).toBe('blocked');
    let configResponses=0;page.on('response',response=>{if(response.url().endsWith('/api/v1/config'))configResponses++;});
    await previewFrame.evaluate(url=>{location.href=url;},app.origin+'/api/v1/config');
    await expect(page.locator('iframe')).toHaveCount(0);expect(configResponses).toBe(0);expect(page.url()).toBe(app.origin+'/');
    await page.getByRole('button',{name:'取消工作流'}).click();await expect(page.getByRole('article',{name:'工作流 panel-review'})).toContainText('已取消');
    await other.frameLocator('iframe').getByRole('button',{name:'确认审查'}).evaluate(button=>(button as HTMLButtonElement).disabled=false);
    await other.frameLocator('iframe').getByRole('button',{name:'确认审查'}).click();await expect(other.getByRole('article',{name:'工作流 panel-review'})).toContainText('已取消');
    const stale=other.frames().find(f=>f.parentFrame())!;await stale.evaluate(()=>{(window as any).fixturePort.postMessage({kind:'request',version:1,instanceId:(window as any).fixtureInstance,id:999,action:'workflow.state',value:'x'.repeat(40000)});});
    await expect(other.getByRole('region',{name:'自定义面板 review-panel'})).toContainText('消息超限');await expect(other.locator('iframe')).toHaveCount(0);
    await other.close();
  }finally{await app.close();}
});

test('authorizes MCP through a browser callback, refreshes after service restart and disconnects without exposing tokens',async({page,context})=>{
 const {oauthFixture}=await import('../fixtures/oauth-server.js'),fixture=await oauthFixture(),workspace=await temporary(),home=await temporary();
 await mkdir(join(workspace,'.nekomimi'),{recursive:true});
 await writeFile(join(workspace,'.nekomimi/mcp.json'),JSON.stringify({version:1,servers:{oauth:{...fixture.resource.config,oauth:{issuer:fixture.resource.config!.oauth!.issuer,dynamicRegistration:true}}}}));
 const options={workspace,home,naming:false,staticDir:resolve('dist/web-dist')};let app=await startWeb(options);
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('button',{name:'授权 MCP oauth',exact:true}).click();
  const popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'打开 MCP 授权页面'}).click();const popup=await popupPromise;await expect(popup.locator('body')).toContainText('授权完成');await popup.close();
  await expect(page.getByRole('region',{name:'MCP 授权'})).toContainText('authorized');expect(fixture.counts().registrations).toBe(1);
  await app.close();app=await startWeb(options);await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();
  await expect(page.getByRole('region',{name:'MCP 授权'})).toContainText('authorized');await page.getByRole('button',{name:'信任并启用 oauth'}).click();await expect(page.getByRole('dialog')).toContainText('已生效');expect(fixture.counts().refreshes).toBe(1);
  const management=await page.evaluate(async()=>JSON.stringify(await(await fetch('/api/v1/customization')).json()));expect(management).not.toContain('initial-secret');expect(management).not.toContain('refreshed-secret');expect(management).not.toContain('refresh-secret');
  await page.getByRole('button',{name:'断开 MCP 授权'}).click();await expect(page.getByRole('region',{name:'MCP 授权'})).toContainText('disconnected');
 }finally{await app.close();await fixture.close();}
});
