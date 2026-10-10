# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-loading-focus.spec.ts >> optional features load on demand, cancel delayed load, retry network failure and keep draft
- Location: test/browser/chat-loading-focus.spec.ts:13:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('status')
Expected substring: "正在加载主题管理"
Error: strict mode violation: getByRole('status') resolved to 2 elements:
    1) <p role="status">正在加载对话框…</p> aka getByText('正在加载对话框…')
    2) <span role="status" class="text-xs text-muted"></span> aka getByTestId('main').getByRole('status')

Call log:
  - Expect "toContainText" getByRole('status') with timeout 5000ms
  - waiting for getByRole('status')

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
                    - /url: /work/session/80db1a28d7c31ad8bbfc0a301abdc1477e54152d6cca94afca3767800825ccf1/panels
                    - text: 面板管理
                  - link:
                    - /url: /work/workflows
                    - text: 持久工作流管理
                  - link:
                    - /url: /work/session/80db1a28d7c31ad8bbfc0a301abdc1477e54152d6cca94afca3767800825ccf1/models
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
                              - /url: /work/session/80db1a28d7c31ad8bbfc0a301abdc1477e54152d6cca94afca3767800825ccf1
                              - text: 交互检查
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
                    - heading [level=1]: 交互检查
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
      - button "关闭外观" [active] [ref=e5] [cursor=pointer]
    - paragraph [ref=e6]: 预览只在此窗口中生效，关闭即取消未保存预览。
    - generic [ref=e7]:
      - generic [ref=e8]:
        - button "深色" [ref=e9] [cursor=pointer]
        - switch "显示扩展内容" [checked] [ref=e10] [cursor=pointer]:
          - text: 显示扩展内容
          - generic [aria-hidden] [ref=e12]: 已开启
        - button "恢复默认界面" [ref=e13] [cursor=pointer]
      - region "主题管理加载" [ref=e14]:
        - alert [ref=e15]: 主题管理加载失败，请重试。
        - generic [ref=e16]:
          - button "重试加载" [ref=e17] [cursor=pointer]
          - button "关闭加载" [ref=e18] [cursor=pointer]
```

# Test source

```ts
  1   | import {test,expect,type Page} from '@playwright/test';
  2   | import {readFile} from 'node:fs/promises';
  3   | import {resolve} from 'node:path';
  4   | import {startWeb} from '../../src/server/app.js';
  5   | import {temporary,key,response,textItem} from '../helpers.js';
  6   | 
  7   | async function server(){return startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem('任务完成')])}});}
  8   | async function openSession(page:Page,app:Awaited<ReturnType<typeof server>>) {
  9   |  const session=await app.sessions.create('交互检查');
  10  |  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);return session;
  11  | }
  12  | async function appearance(page:Page) {await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();}
  13  | test('optional features load on demand, cancel delayed load, retry network failure and keep draft',async({page})=>{
  14  |  const app=await server(),scripts:string[]=[];
  15  |  const manifest=JSON.parse(await readFile('dist/web-dist/assets/asset-manifest.json','utf8'));
  16  |  const entries=['v2/routes/themes.tsx','components/FileBrowser.tsx','components/Changes.tsx','v2/routes/inspection.tsx','v2/routes/session-export.tsx'];
  17  |  const files=entries.map(entry=>manifest[entry].file as string);
  18  |  page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('.js'))scripts.push(r.url());});
  19  |  let release=()=>{};
  20  |  try{
  21  |   await openSession(page,app);const input=page.getByLabel('任务草稿',{exact:true});await input.fill('保留草稿');
  22  |   for(const file of files)expect(scripts.some(url=>url.includes(file))).toBe(false);
  23  |   const gate=new Promise<void>(resolve=>{release=resolve;});await page.route(`**/${files[0]}*`,async route=>{await gate;await route.continue();},{times:1});
> 24  |   await appearance(page);await expect(page.getByRole('status')).toContainText('正在加载主题管理');await page.getByRole('button',{name:'关闭外观',exact:true}).click();
      |                                                                 ^ Error: expect(locator).toContainText(expected) failed
  25  |   const finished=page.waitForResponse(response=>response.url().includes(files[0]!));release();await finished;
  26  |   await expect(page.getByRole('button',{name:'更多操作'})).toBeFocused();await expect(page.getByRole('dialog')).toHaveCount(0);
  27  |   await appearance(page);await expect(page.getByRole('heading',{name:'主题与外观'})).toBeVisible();await page.keyboard.press('Escape');await expect(input).toHaveJSProperty('textContent','保留草稿');
  28  |   await page.route(`**/${files[1]}*`,route=>route.abort(),{times:1});await page.getByRole('tab',{name:'文件',exact:true}).click();await expect(page.getByRole('alert')).toContainText('文件加载失败');
  29  |   await page.getByRole('button',{name:'重试加载'}).click();await expect(page.getByRole('tree',{name:'项目文件'})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  30  |   await page.getByRole('tab',{name:'变更',exact:true}).click();await expect(page.getByRole('tabpanel')).toContainText('暂无已确认的文件修改');
  31  |   await page.getByRole('tab',{name:'证据',exact:true}).click();await input.fill('测试调用');await page.getByRole('button',{name:'发送',exact:true}).click();
  32  |   await expect(page.getByText('任务完成',{exact:true})).toBeVisible();await page.getByRole('button',{name:'调用证据',exact:true}).click();await expect(page.getByRole('dialog',{name:'调用证据',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  33  |   await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'导出会话'}).click();await expect(page.getByRole('button',{name:'下载 HTML'})).toBeVisible();await page.keyboard.press('Escape');
  34  |   for(const file of files)expect(scripts.some(url=>url.includes(file)),file).toBe(true);
  35  |  }finally{release();await app.close();}
  36  | });
  37  | 
  38  | test('submit restores focus for mouse and keyboard and failure retains draft',async({page})=>{
  39  |  const app=await server();try{
  40  |   const session=await openSession(page,app);const input=page.getByLabel('任务草稿',{exact:true});
  41  |   await input.fill('鼠标提交');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(input).toBeFocused();await expect(input).toHaveJSProperty('textContent', '');
  42  |   await expect(page.getByText('任务完成',{exact:true})).toHaveCount(1);await app.sessions.activeFor(session.id)?.done;
  43  |   await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();await input.fill('键盘提交');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();await input.press('Enter');await expect(input).toBeFocused();await expect(input).toHaveJSProperty('textContent', '');
  44  |   await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();
  45  |   await expect(page.getByText('任务完成',{exact:true})).toHaveCount(2);await app.sessions.activeFor(session.id)?.done;
  46  |   await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();
  47  |   await page.route('**/submit',r=>r.fulfill({status:503,json:{error:{message:'稍后重试'}}}),{times:1});
  48  |   await input.fill('失败草稿');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();await page.getByRole('button',{name:'发送',exact:true}).click();await expect(input).toBeEnabled();await expect(input).toBeFocused();await expect(input).toHaveJSProperty('textContent', '失败草稿');
  49  |   await input.press('Shift+Enter');await expect(input).toHaveJSProperty('textContent', '失败草稿\n');
  50  |  }finally{await app.close();}
  51  | });
  52  | 
  53  | test('late submit never steals focus or clears a new context draft',async({page})=>{
  54  |  const app=await server();let release=()=>{};
  55  |  try{
  56  |   const original=await openSession(page,app),other=await app.sessions.create('另一个会话');
  57  |   const input=page.getByLabel('任务草稿',{exact:true}),send=page.getByRole('button',{name:'发送',exact:true});
  58  |   for(const target of ['modal','tab','session','blur']){
  59  |    const gate=new Promise<void>(resolve=>{release=resolve;});
  60  |    await page.route('**/submit',async route=>{await gate;await route.fulfill({status:503,json:{error:{message:'延迟失败'}}});},{times:1});
  61  |    await input.fill('等待 '+target);await expect(send).toBeEnabled();await send.click();await expect(send).toBeDisabled();
  62  |    await input.fill('较新的草稿 '+target);
  63  |    if(target==='modal'){await appearance(page);await expect(page.getByRole('dialog',{name:'外观',exact:true})).toBeVisible();}
  64  |    if(target==='tab'){await page.getByRole('button',{name:'更多操作'}).focus();await page.keyboard.press('Tab');}
  65  |    if(target==='session'){await page.getByRole('link',{name:'另一个会话',exact:true}).click();await expect(page).toHaveURL(new RegExp(other.id));await input.fill('其他会话的新草稿');await page.getByRole('button',{name:'更多操作'}).focus();}
  66  |    if(target==='blur')await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.dispatchEvent(new Event('blur'));});
  67  |    const settled=page.waitForResponse(response=>response.url().endsWith('/submit'));release();await settled;
  68  |    if(target!=='session')await expect(page.getByText(/提交失败：延迟失败/)).toBeVisible();
  69  |    await expect(input).not.toBeFocused();await expect(input).toHaveJSProperty('textContent',target==='session'?'其他会话的新草稿':'较新的草稿 '+target);
  70  |    if(target==='modal')await page.keyboard.press('Escape');
  71  |    if(target==='session'){await page.getByRole('link',{name:'交互检查',exact:true}).click();await expect(page).toHaveURL(new RegExp(original.id));await expect(input).toHaveJSProperty('textContent','较新的草稿 session');}
  72  |   }
  73  |  }finally{release();await app.close();}
  74  | });
  75  | 
  76  | test('latest follows new messages and delayed layout, while deliberate history reading stays anchored',async({page})=>{
  77  |  const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem(Array.from({length:100},(_,i)=>`内容 ${i}\n\n`).join(''))])}});
  78  |  try{
  79  |   const session=await openSession(page,app);await page.getByLabel('任务草稿',{exact:true}).fill('长回复');await page.getByRole('button',{name:'发送',exact:true}).click();
  80  |   const conversation=page.getByTestId('timeline');
  81  |   const distance=()=>conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
  82  |   await expect(page.getByText('内容 99',{exact:true})).toBeVisible();await expect.poll(distance).toBeLessThan(3);
  83  |   await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  84  |   await page.getByTestId('timeline').locator('[data-row-id]').filter({hasText:'内容 99'}).last().evaluate(el=>(el as HTMLElement).style.paddingBottom='480px');
  85  |   await expect.poll(distance).toBeLessThan(3);
  86  |   await conversation.hover();await page.mouse.wheel(0,-900);await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(1);
  87  |   const top=await conversation.evaluate(el=>el.scrollTop);
  88  |   const sessionId=session.id;
  89  |   const entry=await app.sessions.entry(sessionId);
  90  |   const {Journal}=await import('../../src/journal.js');
  91  |   await app.sessions.activeFor(session.id)?.done;
  92  |   let journal=await Journal.open(entry.directory);await journal.append('web.session',{title:'长回复'});await journal.close();
  93  |   await page.waitForTimeout(400);await expect(page.getByRole('button',{name:'返回最新',exact:true})).not.toContainText('有新消息');
  94  |   journal=await Journal.open(entry.directory);await journal.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'新增消息一'}]}]},{runId:'follow-one',attemptId:'follow-one'});await journal.close();
  95  |   await expect(page.getByText('新增消息一',{exact:true})).toBeAttached();await expect(page.getByText('有新消息',{exact:false})).toHaveCount(0);expect(Math.abs(await conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThan(3);
  96  |   await conversation.focus();await page.keyboard.press('End');await expect(page.getByText('新增消息一',{exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  97  |   journal=await Journal.open(entry.directory);await journal.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'新增消息二'}]}]},{runId:'follow-two',attemptId:'follow-two'});await journal.close();
  98  |   await expect(page.getByText('新增消息二',{exact:true})).toBeInViewport();await expect.poll(distance).toBeLessThan(3);await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  99  |  }finally{await app.close();}
  100 | });
  101 | 
  102 | test('running task allows next draft without submitting it or clearing it at completion',async({page})=>{
  103 |  let release!:()=>void,calls=0;const gate=new Promise<void>(r=>release=r);
  104 |  const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{calls++;await gate;return response([textItem('完成后保留草稿')]);}}});
  105 |  try{
  106 |   const session=await openSession(page,app);const input=page.getByLabel('任务草稿',{exact:true});await input.fill('第一条');await input.press('Enter');
  107 |   await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();await expect(input).toBeFocused();await input.fill('下一条草稿');await input.press('Enter');await expect.poll(()=>calls).toBe(1);
  108 |   await appearance(page);await expect(page.getByRole('dialog',{name:'外观',exact:true})).toBeVisible();release();
  109 |   await expect(page.getByRole('button',{name:'发送',exact:true,includeHidden:true})).toBeAttached();await expect(input).toHaveJSProperty('textContent', '下一条草稿');await expect(input).not.toBeFocused();
  110 |   await page.keyboard.press('Escape');await expect(page.getByText('完成后保留草稿',{exact:true})).toBeVisible();expect(calls).toBe(1);
  111 |  }finally{release();await app.close();}
  112 | });
  113 | 
```