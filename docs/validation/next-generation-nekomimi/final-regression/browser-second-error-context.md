# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: theme-management.spec.ts >> 10.9 appearance previews cancel on Escape or outside and nested confirmation closes first
- Location: test/browser/theme-management.spec.ts:81:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('dialog')
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByRole('dialog') with timeout 5000ms
  - waiting for getByRole('dialog')
    14 × locator resolved to 1 element
       - unexpected value "1"

```

# Page snapshot

```yaml
- generic:
  - generic [aria-hidden]:
    - generic:
      - banner:
        - generic:
          - strong: Nekomimi
          - generic: 用户项目
        - navigation:
          - link:
            - /url: /work
            - text: 工作
          - link:
            - /url: /create
            - text: 创造
        - generic:
          - group:
            - generic: 运行版本 0.2.1 · 1bd549ee
          - button: 版本恢复
          - generic:
            - button: 更多操作
      - generic:
        - generic:
          - generic:
            - generic:
              - generic:
                - navigation:
                  - paragraph: WORKSPACE
                  - heading [level=2]: 我的项目
                  - link:
                    - /url: /work/themes
                    - text: 主题与外观
                  - link:
                    - /url: /work/settings
                    - text: 基础设置
                  - link:
                    - /url: /work/session/554baa89eb7d480f68221a738c172ab1ddc1003ea9c42d55dd630b07d943858b/panels
                    - text: 面板管理
                  - link:
                    - /url: /work/workflows
                    - text: 持久工作流管理
                  - link:
                    - /url: /work/session/554baa89eb7d480f68221a738c172ab1ddc1003ea9c42d55dd630b07d943858b/models
                    - text: 模型用途与配置
                  - generic:
                    - textbox:
                      - /placeholder: 新任务…
                    - button: 新建
                  - region:
                    - list:
                      - listitem:
                        - heading [level=3]: 今天
                        - generic:
                          - generic:
                            - link:
                              - /url: /work/session/554baa89eb7d480f68221a738c172ab1ddc1003ea9c42d55dd630b07d943858b
                              - text: Appearance preview
                            - generic:
                              - button: ···
                          - generic:
                            - generic: 就绪
                            - button:
                              - time: 刚刚
                    - button: 刷新会话列表
          - separator
          - generic:
            - generic:
              - main:
                - generic:
                  - generic:
                    - paragraph: WORK MODE
                    - heading [level=1]: Appearance preview
                  - generic:
                    - generic: 已断线，重连中
                    - button: 调用证据
                    - button: 上下文
                    - generic: idle
                    - button: 删除
                - navigation
                - generic:
                  - generic:
                    - generic:
                      - region:
                        - button: 交接到创造会话
                      - region:
                        - generic:
                          - heading [level=2]: 交接与交付
                          - button: 刷新交接记录
                        - paragraph: 尚无交接或交付记录。
                        - region:
                          - generic:
                            - heading [level=3]: 交接确认状态
                            - button: 重新读取确认状态
                          - paragraph: 尚未观察到已接受的交接；若刚刚断线，请先重新读取确认状态。
                      - generic:
                        - heading [level=2]: 从一个清晰的任务开始
                        - generic: 描述目标，Nekomimi 会记录每一步证据。
                - generic:
                  - region:
                    - alert: "TypeError: Failed to fetch"
                  - generic: 任务草稿
                  - combobox:
                    - textbox
                  - generic:
                    - generic: Enter 发送 · Shift+Enter 换行 · / 命令 · @ 引用
                    - button: 发送
          - separator
          - generic:
            - generic:
              - generic:
                - complementary:
                  - paragraph: INSPECTOR
                  - tablist:
                    - tab [selected]: 证据
                    - tab: 变更
                    - tab: 文件
                  - tabpanel:
                    - generic:
                      - heading [level=3]: 上下文预算
                      - paragraph: 选择会话后显示当前投影的上下文统计。
                    - generic:
                      - heading [level=3]: 调用证据
                      - paragraph: 没有进行中的运行。
  - dialog [ref=e2]:
    - generic [ref=e3]:
      - heading "外观" [level=2] [ref=e4]
      - button "关闭外观" [ref=e5] [cursor=pointer]
    - paragraph [ref=e6]: 预览只在此窗口中生效，关闭即取消未保存预览。
    - generic [ref=e7]:
      - generic [ref=e8]:
        - button "深色" [ref=e9] [cursor=pointer]
        - switch "显示扩展内容" [checked] [ref=e10] [cursor=pointer]:
          - text: 显示扩展内容
          - generic [aria-hidden] [ref=e12]: 已开启
        - button "恢复默认界面" [ref=e13] [cursor=pointer]
      - main [ref=e14]:
        - generic [ref=e15]:
          - heading "主题与外观" [level=1] [ref=e16]
          - button "刷新主题目录" [ref=e17] [cursor=pointer]
        - paragraph [ref=e18]: 当前为此会话绑定的目标。当前已选：宿主默认风格。预览不会保存，离开本页即取消。明暗切换为未声明颜色提供宿主默认值。
        - region "主题预览" [ref=e19]:
          - button "预览默认风格" [ref=e20] [cursor=pointer]
          - button "预览 主题样本" [pressed] [ref=e21] [cursor=pointer]
        - button "取消主题预览" [ref=e22] [cursor=pointer]
        - group [ref=e23]:
          - generic "高级作用域" [ref=e24] [cursor=pointer]
          - option "当前绑定目标或服务项目" [selected]
          - option "用户默认"
        - generic [ref=e25]:
          - button "应用已审阅风格" [active] [ref=e27] [cursor=pointer]
          - button "跟随用户默认" [ref=e29] [cursor=pointer]
        - group [ref=e30]:
          - generic "偏好与资源版本" [ref=e31] [cursor=pointer]
```

# Test source

```ts
  1   | import {test,expect} from '@playwright/test';
  2   | import {mkdir,writeFile,copyFile} from 'node:fs/promises';
  3   | import {join,resolve} from 'node:path';
  4   | import {startWeb} from '../../src/server/app.js';
  5   | import {temporary} from '../helpers.js';
  6   | async function fixture(scoped=false){
  7   |   const workspace=await temporary(),home=await temporary(),development=scoped?await temporary():workspace,root=join(development,'.nekomimi/extensions/theme');
  8   |   await mkdir(root,{recursive:true});await copyFile(resolve('extension-docs/examples/sakura/demo.woff'),join(root,'demo.woff'));await copyFile(resolve('extension-docs/examples/sakura/sakura.png'),join(root,'sakura.png'));
  9   |   await writeFile(join(root,'extension.json'),JSON.stringify({name:'theme',sdkVersion:3,entry:'index.ts',requiredCapabilities:['themes']}));
  10  |   await writeFile(join(root,'index.ts'),`import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{api.registerTheme({id:'fixture',title:'主题样本',colors:{background:'#f4fff8',surface:'#e0f0e6',foreground:'#172b20',accent:'#286c43',border:'#608070'},typography:{font:'demo.woff',size:16,fallback:'sans-serif'},assets:{background:'sakura.png'},radii:{control:12},spacing:{controlPadding:8},motion:{preset:'float',duration:2000,intensity:3}});}) satisfies ExtensionFactory3;`);
  11  |   const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist')});await app.sessions.waitInitialization();
  12  |   let sessionId:string|undefined;
  13  |   if(scoped){const session=await app.sessions.create('主题开发',{commandId:'theme-create',mode:'create',target:{kind:'extension',root:development,scope:'project'}});sessionId=session.id;const data=await app.sessions.describeCustomization(session.id),resource=data.resources.find(item=>item.name==='theme')!;await app.sessions.customizationAction({action:'authorize-version',sessionId:session.id,id:resource.id,contentHash:resource.hash,revision:data.settingsRevision});await expect.poll(async()=>(await app.sessions.runtimeUi(session.id)).runtimeUi.themes.length).toBe(1);}
  14  |   else{const resource=(await app.sessions.customization.catalog.discover()).find(item=>item.name==='theme')!;await app.sessions.customization.catalog.decide(resource.id,true,true,0);await app.sessions.customization.initialize();}
  15  |   return {app,sessionId,root};
  16  | }
  17  | test('10.4 theme preview cancels without writes; apply persists and recovery remains accessible',async({page})=>{
  18  |   const f=await fixture(),actions:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization'))actions.push(request.postDataJSON().action);});
  19  |   try{
  20  |     await page.goto(f.app.origin+'/work/themes#token='+f.app.token);await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();
  21  |     await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');expect(actions).toEqual([]);
  22  |     await expect(page.getByRole('button',{name:'刷新主题目录',exact:true})).toHaveCSS('border-radius','12px');
  23  |     expect(await page.locator('html').evaluate(async()=>{await document.fonts.load('16px NekomimiWorkbenchTheme');return Array.from(document.fonts).some(font=>font.family==='NekomimiWorkbenchTheme'&&font.status==='loaded');})).toBe(true);
  24  |     await page.getByRole('button',{name:'取消主题预览',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');expect(actions).toEqual([]);
  25  |     await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();
  26  |     await expect.poll(()=>actions.filter(action=>action==='theme-verify').length).toBe(1);expect(actions.filter(action=>action==='theme-select')).toHaveLength(1);
  27  |     await page.reload();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');expect(actions.filter(action=>action==='theme-verify')).toHaveLength(1);
  28  |     await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('[data-theme-decoration]')).toHaveCSS('animation-name','none');
  29  |     await page.setViewportSize({width:360,height:760});await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
  30  |     await expect.poll(async()=>(await f.app.sessions.customization.themes.preference('project')).selection).toBe(null);
  31  |     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  32  |   }finally{await f.app.close();}
  33  | });
  34  | test('10.4 theme revision conflict does not retry; revocation removes active stylesheet',async({page})=>{
  35  |   const f=await fixture();
  36  |   try{
  37  |     await page.goto(f.app.origin+'/work/themes#token='+f.app.token);await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();
  38  |     await f.app.sessions.customization.themes.select('project',null,0);
  39  |     await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('主题偏好已变化');await expect(page.getByRole('button',{name:'确认应用已审阅风格',exact:true})).toBeDisabled();
  40  |     await page.getByRole('button',{name:'取消操作',exact:true}).click();await page.getByRole('button',{name:'刷新主题目录',exact:true}).click();
  41  |     await expect(page.getByText('偏好与资源版本',{exact:true})).toBeVisible();
  42  |     await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('偏好修订：1');await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();
  43  |     await expect.poll(async()=>(await f.app.sessions.customization.themes.describe()).active?.id).toBe('fixture');
  44  |     const resource=(await f.app.sessions.customization.catalog.discover()).find(item=>item.name==='theme')!;await f.app.sessions.customization.catalog.decide(resource.id,false,false,(await f.app.sessions.customization.catalog.decisions()).revision);
  45  |     await page.getByRole('button',{name:'刷新主题目录',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
  46  |     await expect(page.getByRole('alert')).toContainText('撤权');
  47  |   }finally{await f.app.close();}
  48  | });
  49  | test('10.4 create theme stays scoped; failed recovery uses persistent window fallback without false saved claim',async({page})=>{
  50  |   const f=await fixture(true);
  51  |   try{
  52  |     await page.goto(f.app.origin+`/create/session/${f.sessionId}/themes#token=`+f.app.token);await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();
  53  |     await expect.poll(async()=>(await f.app.sessions.runtimeUi(f.sessionId)).runtimeUi.active?.id).toBe('fixture');expect((await f.app.sessions.customization.themes.preference('project')).selection).toBeUndefined();
  54  |     await page.route('**/api/v1/customization',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='theme-select'){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'fixture',message:'fixture conflict'}})});return;}await route.continue();});
  55  |     await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');await expect(page.getByRole('alert')).toContainText('保存偏好失败');
  56  |     expect((await f.app.sessions.runtimeUi(f.sessionId)).runtimeUi.active?.id).toBe('fixture');await page.reload();await expect(page.getByRole('heading',{name:'主题与外观',exact:true})).toBeVisible();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
  57  |   }finally{await f.app.close();}
  58  | });
  59  | 
  60  | test('10.4 project can explicitly follow user default; preview navigation cancels and bad font falls back',async({page})=>{
  61  |   const f=await fixture();const actions:string[]=[];
  62  |   page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization'))actions.push(request.postDataJSON().action);});
  63  |   try{
  64  |     const theme=(await f.app.sessions.customization.themes.catalog())[0]!;
  65  |     await f.app.sessions.customization.themes.select('user',{id:theme.id,resourceId:theme.resourceId,revision:theme.revision},0);
  66  |     await f.app.sessions.customization.themes.select('project',null,0);
  67  |     await page.goto(f.app.origin+'/work/themes#token='+f.app.token);
  68  |     await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
  69  |     await page.getByRole('link',{name:'基础设置',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');expect(actions).toEqual([]);
  70  |     await page.getByRole('link',{name:'主题与外观',exact:true}).click();await page.getByRole('button',{name:'跟随用户默认',exact:true}).click();await page.getByRole('button',{name:'确认跟随用户默认',exact:true}).click();
  71  |     await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');await expect.poll(()=>actions.filter(action=>action==='theme-verify').length).toBe(1);
  72  |     expect((await f.app.sessions.customization.themes.preference('project')).selection).toBeUndefined();
  73  |     await page.route('**/api/v1/runtime-ui',async route=>{const response=await route.fetch(),data=await response.json();for(const item of [...data.runtimeUi.themes,data.runtimeUi.active].filter(Boolean))item.assetsData.font='data:font/woff;base64,d09GRgAAAAAA';await route.fulfill({response,json:data});});
  74  |     await page.reload();await expect(page.getByRole('heading',{name:'主题与外观',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
  75  |     expect(await page.locator('html').evaluate(async()=>{try{await document.fonts.load('16px NekomimiWorkbenchTheme');return 'loaded';}catch{return 'fallback';}})).toBe('fallback');
  76  |     await expect(page.locator('html')).toHaveCSS('font-family','NekomimiWorkbenchTheme, sans-serif');
  77  |     await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
  78  |   }finally{await f.app.close();}
  79  | });
  80  | 
  81  | test('10.9 appearance previews cancel on Escape or outside and nested confirmation closes first',async({page})=>{
  82  |   const f=await fixture(),actions:string[]=[];
  83  |   page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization'))actions.push(request.postDataJSON().action);});
  84  |   try {
  85  |     const session=await f.app.sessions.create('Appearance preview');
  86  |     await page.goto(`${f.app.origin}/work/session/${session.id}#token=${f.app.token}`);
  87  |     const more=page.getByRole('button',{name:'更多操作'});
  88  |     await page.getByLabel('任务草稿',{exact:true}).fill('Keep appearance draft');
  89  |     for(const dismissal of ['escape','outside']) {
  90  |       await more.click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();
  91  |       await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
  92  |       await expect(page.getByLabel('主题应用范围',{exact:true})).not.toBeVisible();
  93  |       await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await expect(page.getByRole('dialog',{name:'应用已审阅风格',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'取消操作',exact:true})).toBeFocused();await page.keyboard.press('Escape');
  94  |       await expect(page.getByRole('dialog',{name:'应用已审阅风格',exact:true})).toHaveCount(0);
  95  |       await expect(page.getByRole('dialog',{name:'外观',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
  96  |       if(dismissal==='escape')await page.keyboard.press('Escape');else await page.mouse.click(2,2);
> 97  |       await expect(page.getByRole('dialog')).toHaveCount(0);await expect(more).toBeFocused();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
      |                                              ^ Error: expect(locator).toHaveCount(expected) failed
  98  |     }
  99  |     await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Keep appearance draft');expect(actions).toEqual([]);
  100 |   } finally {await f.app.close();}
  101 | });
  102 | 
```