import {expect,it} from 'vitest';
import {validateTheme, validateView, assetPath} from '../src/customization/ui-contract.js';
import {checkManifest} from '../src/customization/types.js';
import {buildTheme} from '../src/customization/theme-build.js';
import {temporary} from './helpers.js';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hash} from '../src/journal.js';
import type {Resource} from '../src/customization/resources.js';
it('validates complete style values and rejects executable or unbounded input',()=>{
 expect(()=>validateTheme({id:'sakura',title:'樱花',typography:{family:'猫咪 Sans',fallback:'sans-serif',size:16,weight:500,lineHeight:1.6,font:'font.woff2'},colors:{accent:'#a45adc'},spacing:{scale:.8},radii:{bubble:24},shadows:{preset:'soft'},bubbles:{style:'tail'},assets:{background:'sakura.png'},motion:{preset:'float',duration:1500,intensity:3},density:'compact'})).not.toThrow();
 for(const patch of [{colors:{accent:'url(https://bad)'}},{typography:{family:'x;display:none'}},{spacing:{scale:0}},{motion:{duration:Infinity}},{radii:{control:-1}},{assets:{background:'../x.png'}},{css:'body{}'},{colors:null}]) expect(()=>validateTheme({id:'sakura',title:'樱花',...patch} as any)).toThrow();
 expect(()=>validateTheme({id:'simple',title:'默认'})).not.toThrow();
 for(const path of ['../secret','/secret','https://host/x','a\\b','a//b']) expect(()=>assetPath(path)).toThrow();
 expect(()=>validateView({title:'工具栏',order:3,match:{role:'assistant'}})).not.toThrow();
 expect(()=>validateView({title:'',order:Infinity})).toThrow();
 expect(()=>checkManifest({name:'theme',sdkVersion:2,entry:'index.ts',requiredCapabilities:['themes','views','ui-draft']})).not.toThrow();
 expect(()=>checkManifest({name:'theme',sdkVersion:2,entry:'index.ts',requiredCapabilities:['arbitrary-css']})).toThrow();
});
it('loads only hashed bounded local assets with matching signatures',async()=>{
 const root=await temporary(),data=Buffer.from([137,80,78,71,13,10,26,10]);await writeFile(join(root,'image.png'),data);
 const resource={root,fileHashes:{'image.png':hash(data)}} as unknown as Resource;
 const theme={id:'asset',title:'本地素材',assets:{background:'image.png'}};
 expect((await buildTheme(resource,theme)).assetsData?.background).toMatch(/^data:image\/png;base64,/);
 await writeFile(join(root,'image.png'),'changed');await expect(buildTheme(resource,theme)).rejects.toThrow('integrity');
 const bad={...resource,fileHashes:{'image.png':hash('changed')}};await expect(buildTheme(bad,theme)).rejects.toThrow('MIME');
});
it('registers themes and views with explicit capabilities and rejects duplicate or undeclared registration',async()=>{
 const {mkdir}=await import('node:fs/promises');const {CustomizationHost}=await import('../src/customization/host.js');
 for(const mode of ['valid','duplicate','undeclared','legacy']) {
  const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/ui');await mkdir(root,{recursive:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({name:'ui',sdkVersion:mode==='legacy'?1:2,entry:'index.ts',requiredCapabilities:mode==='undeclared'?['views']:['themes','views']}));
  await writeFile(join(root,'panel.ts'),'export default {mount(root:HTMLElement){root.textContent="View"}};');
  await writeFile(join(root,'index.ts'),`import type {ExtensionFactory2} from 'nekomimi/extensions';export default ((api)=>{api.registerTheme({id:'sakura',title:'樱花'});${mode==='duplicate'?"api.registerTheme({id:'sakura',title:'重复'});":''}api.registerView({id:'widget',title:'挂件',uiVersion:1,entry:'panel.ts',slot:'sidebar-widget',propsSchema:{type:'object'},actions:[],fallback:'挂件内容'});}) satisfies ExtensionFactory2;`);
  const host=new CustomizationHost(workspace,home);
  try {const resource=(await host.catalog.discover()).find(r=>r.kind==='extension')!;await host.catalog.decide(resource.id,true,true,0);
   if(mode==='valid'){await host.acquire();await host.release();expect((await host.themes.catalog())[0]?.title).toBe('樱花');expect(host.panels.catalog()[0]?.slot).toBe('sidebar-widget');
    const theme=(await host.themes.catalog())[0]!;await host.themes.select('user',{id:theme.id,resourceId:theme.resourceId,revision:theme.revision},0);expect((await host.themes.describe()).active?.id).toBe('sakura');await host.themes.select('project',{id:theme.id,resourceId:theme.resourceId,revision:theme.revision},0);expect((await host.themes.describe()).active?.id).toBe('sakura');await expect(host.themes.select('project',null,0)).rejects.toThrow('conflict');
    await host.catalog.decide(resource.id,false,false,(await host.catalog.decisions()).revision);expect((await host.themes.describe()).unavailable).toBe(true);
   }else{await expect(host.acquire()).rejects.toThrow();expect(host.active).toBeUndefined();}
  }finally{await host.close();}
 }
},30000);
it('exposes one public SDK and preserves readable bounded results without technical envelopes',async()=>{
 const {SDK_VERSION,CONTRACT_VERSIONS}=await import('../src/extensions.js');const {sdkCatalog}=await import('../src/customization/sdk.js');const {readablePanel}=await import('../src/shared/ui-content.js');
 expect(SDK_VERSION).toBe(CONTRACT_VERSIONS.sdk);const sdk=await sdkCatalog('public');expect('sections' in sdk&&sdk.sections?.some(s=>s.text.includes('registerTheme'))).toBe(true);
 expect(readablePanel({props:{name:'小猫咪',mood:'开心',lines:['一','二']}})).toBe('小猫咪\n开心\n一\n二');
 expect(readablePanel({summary:'直接结果',props:{secret:'hidden'}})).toBe('直接结果');
 expect(readablePanel({props:{name:'<script>bad</script>',bundleHash:'hidden'}})).not.toContain('hidden');
 expect(readablePanel({props:Array(100).fill('x'.repeat(10000))}).length).toBeLessThanOrEqual(8000);
});
it('validates the distributed complete theme example and keeps denied actions inert',async()=>{
 const {cp,mkdir}=await import('node:fs/promises');const {resolve}=await import('node:path');const {CustomizationHost,validateExtension}=await import('../src/customization/host.js');
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/sakura');await mkdir(root,{recursive:true});await cp(resolve('extension-docs/examples/sakura'),root,{recursive:true});
 const host=new CustomizationHost(workspace,home);
 try{const resource=(await host.catalog.discover()).find(r=>r.kind==='extension')!;expect(await validateExtension(resource)).toEqual([]);await host.catalog.decide(resource.id,true,true,0);await host.acquire();await host.release();
 const panel=host.panels.catalog().find(p=>p.id==='moe')!;const instance=await host.panels.mount(resource.id,panel.id,resource.hash,{name:'test'},undefined,false,undefined,'session-a');
 expect(await host.panels.uiAction(instance.instanceId,1,'draft.set',{text:'hello'})).toMatchObject({sessionId:'session-a'});
 await expect(host.panels.uiAction(instance.instanceId,1,'draft.set',{text:'hello'})).rejects.toThrow('identity');
 await expect(host.panels.uiAction(instance.instanceId,2,'command.run',{})).rejects.toThrow('authorized');
 await host.catalog.decide(resource.id,false,false,(await host.catalog.decisions()).revision);await expect(host.panels.uiAction(instance.instanceId,3,'draft.set',{text:'hello'})).rejects.toThrow('revoked');
 host.panels.unmount(instance.instanceId);await expect(host.panels.document(instance.instanceId)).rejects.toThrow('expired');
 }finally{await host.close();}
},30000);
it('creates typechecked theme and UI candidates without activating them',async()=>{
 const {Candidates}=await import('../src/customization/candidates.js');const store=new Candidates(await temporary());
 for(const template of ['command','theme','panel','view']){const candidate=await store.scaffold('sample-'+template,template);const result=await store.preview(candidate.id);expect(result.report.passed).toBe(true);}
});
it('exports old panel events as escaped readable content while retaining folded evidence',async()=>{
 const {Journal}=await import('../src/journal.js'),{exportSession}=await import('../src/export.js'),{readFile}=await import('node:fs/promises');
 const root=await temporary(),session=join(root,'session'),journal=await Journal.open(session);
 await journal.append('extension.ui',{kind:'panel',title:'今日元气',panelId:'internal-panel',resourceId:'extension:internal',bundleHash:'technical-hash',props:{name:'小猫咪',mood:'<script>unsafe</script>',lines:['继续加油']},fallback:'查看数据'});await journal.close();
 const path=await exportSession(session,{format:'html',output:join(root,'offline.html')}),html=await readFile(path,'utf8');
 const article=html.match(/<article[\s\S]*?<\/article>/)?.[0]??'';
 expect(article).toContain('小猫咪');expect(article).toContain('继续加油');expect(article).not.toContain('technical-hash');expect(html).toContain('technical-hash');expect(html).not.toContain('<script>unsafe');expect(html).not.toMatch(/<script\b|<iframe\b/);
});
