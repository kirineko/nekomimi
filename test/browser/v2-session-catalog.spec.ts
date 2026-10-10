import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {realpath,writeFile,readFile} from 'node:fs/promises';
import {startWeb} from '../../src/server/app.js';
import {temporary} from '../helpers.js';
import { setDeveloperView } from './fixtures/workbench.js';
async function fixture(){return startWeb({workspace:await temporary(),home:await temporary(),naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{throw Error('Unexpected model call');}}});}

test('catalog pagination restarts on an actual revision conflict and preserves the selected draft',async({page})=>{
  const app=await fixture();
  try{
    const selected=await app.sessions.create('选中的工作',{mode:'work',commandId:'selected'});
    for(let i=0;i<34;i++)await app.sessions.create(`分页工作 ${i}`,{mode:'work',commandId:`work-${i}`});
    await page.goto(`${app.origin}/work/session/${selected.id}#token=${app.token}`);
    const catalog=page.getByRole('region',{name:'工作会话列表'});
    await expect(catalog.locator('[data-session-title]')).toHaveCount(30);
    await page.getByLabel('任务草稿',{exact:true}).fill('不能因分页丢失');
    await page.route('**/api/v1/sessions?*offset=30*',route=>route.fulfill({status:503,json:{error:{message:'下一页暂不可用'}}}));
    await catalog.getByRole('button',{name:'更多会话'}).click();await expect(catalog.getByRole('alert')).toContainText('下一页暂不可用');
    await expect(catalog.locator('[data-session-title]')).toHaveCount(30);
    await page.unroute('**/api/v1/sessions?*offset=30*');
    await page.route(url=>url.pathname==='/api/v1/sessions'&&url.searchParams.get('offset')==='30',async route=>{
      await app.sessions.create('分页冲突时的新工作',{mode:'work',commandId:'concurrent'});await route.continue();
    },{times:1});
    await catalog.getByRole('button',{name:'重试会话列表'}).click();
    await expect(catalog.getByText('会话顺序已更新，已重新读取第一页。')).toBeVisible();
    await expect(catalog.locator('[data-session-title]')).toHaveCount(30);
    await expect(catalog.locator('[data-session-title]').first()).toHaveText('分页冲突时的新工作');
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','不能因分页丢失');
    await catalog.getByRole('button',{name:'更多会话'}).click();await expect(catalog.locator('[data-session-title]')).toHaveCount(36);
    const ids=await catalog.locator('[data-session-title]').evaluateAll(links=>links.map(link=>link.getAttribute('href')));expect(new Set(ids).size).toBe(36);
    await expect(catalog.getByRole('link',{name:'选中的工作',exact:true})).toHaveAttribute('aria-current','page');
    await page.route(url=>url.pathname==='/api/v1/sessions',route=>route.fulfill({status:503,json:{error:{message:'列表暂不可用'}}}));
    await setDeveloperView(page,true);await catalog.getByRole('button',{name:'刷新会话列表'}).click();await expect(catalog.getByRole('alert')).toContainText('列表暂不可用');
    await expect(catalog.locator('[data-session-title]')).toHaveCount(36);await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','不能因分页丢失');
  }finally{await app.close();}
});

test('a create deep link beyond the first 100 sessions resolves its own target without loading all pages',async({page})=>{
  test.setTimeout(90000);const app=await fixture(),root=await temporary();
  try{
    const oldest=await app.sessions.create('最早的创造目标',{mode:'create',commandId:'oldest',target:{kind:'extension',root}});
    for(let i=0;i<100;i++)await app.sessions.create(`其他创造 ${i}`,{mode:'create',commandId:`create-${i}`,target:{kind:'extension',root}});
    await page.goto(`${app.origin}/create/session/${oldest.id}#token=${app.token}`);
    await expect(page.getByRole('heading',{name:'最早的创造目标',exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'当前开发目标'})).toContainText(await realpath(root));
    await page.getByLabel('任务草稿',{exact:true}).fill('旧创造会话仍可编辑');
    const catalog=page.getByRole('region',{name:'创造会话列表'});await expect(catalog.locator('[data-session-title]')).toHaveCount(30);
    for(const count of [60,90,101]){await catalog.getByRole('button',{name:'更多会话'}).click();await expect(catalog.locator('[data-session-title]')).toHaveCount(count);}
    await expect(catalog.getByRole('link',{name:'最早的创造目标',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','旧创造会话仍可编辑');
    await page.reload();await expect(page.getByRole('heading',{name:'最早的创造目标',exact:true})).toBeVisible();await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','旧创造会话仍可编辑');
  }finally{await app.close();}
});

test('local date groups update across midnight and full times are keyboard accessible',async({page})=>{
  const app=await fixture();
  try{
    await page.clock.install({time:new Date(2026,8,28,23,59,50)});
    const session=await app.sessions.create('很长的会话标题'.repeat(15),{mode:'work',commandId:'dated'});
    const rows=[{...session,activityAt:new Date(2026,8,28,20).toISOString()},{...session,id:'previous-day',title:'昨天的工作',activityAt:new Date(2026,8,27,20).toISOString()},{...session,id:'unknown-date',title:'缺少时间',activityAt:null}];
    await page.route(url=>url.pathname==='/api/v1/sessions',route=>route.fulfill({json:{sessions:rows,listRevision:'dated'}}));
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    const catalog=page.getByRole('region',{name:'工作会话列表'});
    await expect(catalog.getByRole('heading',{name:'今天',exact:true})).toBeVisible();await expect(catalog.getByRole('heading',{name:'昨天',exact:true})).toBeVisible();await expect(catalog.getByRole('heading',{name:'时间未知',exact:true})).toBeVisible();
    const time=catalog.getByRole('button',{name:/活动时间 很长/});await time.focus();await page.keyboard.press('Enter');await expect(time).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('#'+(await time.getAttribute('aria-controls'))!.replaceAll(':','\\:'))).toContainText('2026');
    await page.keyboard.press('Escape');await expect(time).toHaveAttribute('aria-expanded','false');await expect(time).toBeFocused();
    await page.clock.runFor(31000);await expect(catalog.getByRole('heading',{name:'今天',exact:true})).toHaveCount(0);await expect(catalog.getByRole('heading',{name:'近 7 天',exact:true})).toBeVisible();
    expect(await catalog.locator('[data-session-title]').first().evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  }finally{await app.close();}
});

test('session menus and deletion preserve focus, refuse duplicate pending requests and retain other drafts',async({page})=>{
  const app=await fixture();let release=()=>{};
  try{
    await writeFile(resolve(app.sessions.workspace,'keep.txt'),'工作区文件必须保留');
    const selected=await app.sessions.create('当前会话',{mode:'work',commandId:'current'}),other=await app.sessions.create('其他会话',{mode:'work',commandId:'other'});
    await page.goto(`${app.origin}/work/session/${selected.id}#token=${app.token}`);
    const input=page.getByLabel('任务草稿',{exact:true});await input.fill('删除其他会话时保留');
    const currentMenu=page.getByRole('button',{name:'会话操作 当前会话',exact:true}),otherMenu=page.getByRole('button',{name:'会话操作 其他会话',exact:true});
    await currentMenu.click();await otherMenu.focus();await page.keyboard.press('Enter');await expect(page.getByRole('menu')).toHaveCount(1);
    await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);await expect(otherMenu).toBeFocused();
    const open=async()=>{await otherMenu.click();await page.getByRole('menuitem',{name:'删除会话 其他会话',exact:true}).click();};
    await open();await expect(page.getByRole('button',{name:'取消',exact:true})).toBeFocused();await expect(page.getByRole('dialog')).toContainText('保留工作区文件');
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(otherMenu).toBeFocused();
    await open();await page.getByRole('dialog').getByText(/保留工作区文件/).click();await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.click(2,2);await expect(page.getByRole('dialog')).toHaveCount(0);
    const gate=new Promise<void>(resolve=>{release=resolve;});let calls=0;
    await page.route('**/delete',async route=>{calls++;await gate;await route.fulfill({status:409,json:{error:{message:'会话正在运行'}}});},{times:1});
    await open();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy','true');
    await page.keyboard.press('Escape');await page.mouse.click(2,2);await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
    release();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('会话正在运行');expect(calls).toBe(1);
    await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(selected.id));await expect(input).toHaveJSProperty('textContent','删除其他会话时保留');
    expect((await app.sessions.list(0,30)).sessions.some(item=>item.id===other.id)).toBe(false);
    await currentMenu.click();await page.getByRole('menuitem',{name:'删除会话 当前会话',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
    await expect(page).toHaveURL(/\/work$/);await expect(page.getByRole('heading',{name:'开始一个任务',exact:true})).toBeVisible();
    expect(await readFile(resolve(app.sessions.workspace,'keep.txt'),'utf8')).toBe('工作区文件必须保留');
  }finally{release();await app.close();}
});
