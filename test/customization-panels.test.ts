import {it,expect} from 'vitest';
import {mkdir,writeFile,copyFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {temporary} from './helpers.js';
import {CustomizationHost} from '../src/customization/host.js';
import {buildPanel,validatePanel} from '../src/customization/panel-build.js';
import {readSession,hash} from '../src/journal.js';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {create as archive} from 'tar';
import {Packages} from '../src/customization/packages.js';
import {run} from '../src/runtime.js';
import {exportSession,importBundle} from '../src/export.js';
import {SessionProjection} from '../src/projection/session.js';
async function fixture() {
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/panels');await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'panels',sdkVersion:2,entry:'index.ts',requiredCapabilities:['panels','commands','ui']}));
 await copyFile(resolve('extension-docs/panel-extension.ts'),join(root,'index.ts'));await copyFile(resolve('extension-docs/review-panel.ts'),join(root,'review-panel.ts'));
 const host=new CustomizationHost(workspace,home),resource=(await host.catalog.discover()).find(r=>r.kind==='extension')!;
 await host.catalog.decide(resource.id,true,true,0);return {workspace,root,host,resource};
}
it('installs a TSX panel with exact isolated React dependencies and builds without host module resolution',async()=>{
 const workspace=await temporary(),home=await temporary(),source=await temporary(),archives=new Map<string,{bytes:Buffer;version:string}>(),require=createRequire(import.meta.url);
 for(const name of ['react','react-dom','scheduler','@types/react','csstype']){
  const root=dirname(require.resolve(name+'/package.json')),metadata=JSON.parse(await readFile(join(root,'package.json'),'utf8')),target=join(await temporary(),'package.tgz');
  await archive({cwd:root,file:target,gzip:true,portable:true,prefix:'package/'},(await readdir(root)).filter(n=>n!=='node_modules'));archives.set(name,{bytes:await readFile(target),version:metadata.version});
 }
 await writeFile(join(source,'nekomimi.json'),JSON.stringify({manifestVersion:1,name:'react-panel',version:'1.0.0',sdkVersion:2,requiredCapabilities:['panels'],dependencies:Object.fromEntries(['react','react-dom','@types/react'].map(name=>[name,archives.get(name)!.version])),files:['panel.tsx'],resources:[{kind:'panel',name:'react-panel',entry:'index.ts'}]}));
 await writeFile(join(source,'package.json'),JSON.stringify({name:'react-panel',version:'1.0.0'}));
 await writeFile(join(source,'index.ts'),`import type {ExtensionFactory2} from 'nekomimi/extensions';export default ((api)=>{api.registerPanel({id:'react-panel',uiVersion:1,entry:'panel.tsx',slot:'result',propsSchema:{type:'object'},actions:[],fallback:'React fallback'});}) satisfies ExtensionFactory2;`);
 await writeFile(join(source,'panel.tsx'),`import {createRoot} from 'react-dom/client';import type {PanelModule} from 'nekomimi/extensions';export default {mount(root){const react=createRoot(root);react.render(<button>Installed React panel</button>);return ()=>react.unmount();}} satisfies PanelModule;`);
 // react-dom/client declarations are a separate, explicit package dependency.
 const typesRoot=dirname(require.resolve('@types/react-dom/package.json')),types=JSON.parse(await readFile(join(typesRoot,'package.json'),'utf8')),typesTar=join(await temporary(),'types.tgz');await archive({cwd:typesRoot,file:typesTar,gzip:true,portable:true,prefix:'package/'},await readdir(typesRoot));archives.set('@types/react-dom',{bytes:await readFile(typesTar),version:types.version});
 const manifest=JSON.parse(await readFile(join(source,'nekomimi.json'),'utf8'));manifest.dependencies['@types/react-dom']=types.version;await writeFile(join(source,'nekomimi.json'),JSON.stringify(manifest));
 const tar=join(await temporary(),'kit.tgz');await archive({cwd:source,file:tar,gzip:true,portable:true,prefix:'package/'},await readdir(source));archives.set('react-panel',{bytes:await readFile(tar),version:'1.0.0'});
 let origin='';const server=createServer((req,res)=>{const path=decodeURIComponent(req.url!.slice(1)),isTar=path.endsWith('.tgz'),name=isTar?path.slice(0,-4):path,item=archives.get(name);if(!item){res.writeHead(404);res.end();return;}if(isTar){res.end(item.bytes);return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({versions:{[item.version]:{name,version:item.version,dist:{tarball:origin+'/'+encodeURIComponent(name)+'.tgz',integrity:'sha512-'+createHash('sha512').update(item.bytes).digest('base64')}}}}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const host=new CustomizationHost(workspace,home);
 try{const packages=new Packages(workspace,home),candidate=await packages.prepare({kind:'npm',name:'react-panel',version:'1.0.0',registry:origin},'project');expect((await packages.preview('project',candidate.id)).passed).toBe(true);expect(candidate.dependencies['node_modules/react']?.version).toBe(archives.get('react')!.version);const receipt=await host.requestPackage(candidate.id,'project',true);await host.reload(receipt);expect(receipt.status,receipt.error).toBe('activated');const panel=host.active!.extensions[0]!.panels[0]!;expect(panel.bundle).toContain('Installed React panel');expect(panel.bundleHash).toBe(hash(panel.bundle+'\n'+panel.css));}finally{await host.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
},30000);
it('builds bounded immutable panel inputs without evaluating user config and binds mounted props/revision',async()=>{
 const f=await fixture();
 try{
  await writeFile(join(f.root,'esbuild.config.js'),`throw new Error('config must not execute');`);
  const activation=await f.host.acquire(),panel=activation.extensions[0]!.panels[0]!;await f.host.release();
  expect(panel.bundleHash).toBe(hash(panel.bundle+'\n'+panel.css));
  const mounted=await f.host.panels.mount(panel.resource.id,panel.id,panel.resource.hash,{items:['safe']});
  expect((await f.host.panels.document(mounted.instanceId)).html).toContain("connect-src 'none'");expect((await f.host.panels.document(mounted.instanceId)).html).not.toContain('allow-same-origin');
  await expect(f.host.panels.action(mounted.instanceId,1,'workflow.answer',{decision:'approve'})).rejects.toThrow('unbound');
  await expect(f.host.panels.mount(panel.resource.id,panel.id,panel.resource.hash,{items:[1]})).rejects.toThrow('schema');
  await writeFile(join(f.root,'review-panel.ts'),'export default null;');
  await expect(buildPanel(panel.resource,panel)).rejects.toThrow('integrity');
  const events=(await readSession(join(f.workspace,'.nekomimi/panel-history'))).events;expect(events.some(e=>e.type==='panel.mounted')).toBe(true);
 }finally{await f.host.close();}
});
it('rejects global CSS theme tokens and network or unpinned imports before activation',async()=>{
 const f=await fixture();
 try{
  const activation=await f.host.acquire(),panel=activation.extensions[0]!.panels[0]!;await f.host.release();
  expect(()=>validatePanel({...panel,theme:{background:'url(https://invalid.test)'}})).toThrow('theme');
  const content=`import 'https://invalid.test/code.js'; export default {mount(){}};`;
  await writeFile(join(f.root,'review-panel.ts'),content);
  await expect(buildPanel({...panel.resource,files:{...panel.resource.files,'review-panel.ts':content}},panel)).rejects.toThrow('external imports');
  await f.host.catalog.decide(f.resource.id,false,false,(await f.host.catalog.decisions()).revision);
  await expect(f.host.panels.mount(panel.resource.id,panel.id,panel.resource.hash,{items:[]})).rejects.toThrow('revoked');
 }finally{await f.host.close();}
});
it('previews an explicitly authorized candidate factory without replacing registrations or persistent grants',async()=>{
 const f=await fixture();
 try{
  await f.host.acquire();await f.host.release();const revision=f.host.active!.revision,decisions=await f.host.catalog.decisions();
  const {Candidates}=await import('../src/customization/candidates.js'),store=new Candidates(f.workspace),draft=await store.scaffold('preview-panel');
  await writeFile(join(draft.path,'extension.json'),JSON.stringify({name:'preview-panel',sdkVersion:2,entry:'index.ts',requiredCapabilities:['panels','commands','ui']}));await copyFile(resolve('extension-docs/panel-extension.ts'),join(draft.path,'index.ts'));await copyFile(resolve('extension-docs/review-panel.ts'),join(draft.path,'review-panel.ts'));
  const {candidate}=await store.inspect(draft.id);expect(candidate.report.passed).toBe(true);
  await expect(f.host.panels.previewCandidate(draft.id,candidate.contentHash,undefined,{items:[]},false)).rejects.toThrow('explicit');
  const preview=await f.host.panels.previewCandidate(draft.id,candidate.contentHash,undefined,{items:['candidate']},true);
  expect((await f.host.panels.document(preview.frame.instanceId)).html).toContain('candidate');expect(f.host.active!.revision).toBe(revision);expect(await f.host.catalog.decisions()).toEqual(decisions);
  await expect(f.host.panels.action(preview.frame.instanceId,1,'workflow.answer',{decision:'approve'})).rejects.toThrow('not authorized');
 }finally{await f.host.close();}
});
it('retains panel fallback and structured evidence after resource deletion and exports no executable component',async()=>{
 const f=await fixture(),session=join(f.workspace,'session');
 try{
  const result=await run({workspace:f.workspace,home:f.host.catalog.home,customization:f.host,session,apiKey:'unused',prompt:'/review-panel'});expect(result.status,result.error).toBe('completed');
  const snapshot=await readSession(session),ui=snapshot.events.find(e=>e.type==='extension.ui')!.payload as any;expect(ui.propsArtifact).toBeDefined();
  await f.host.close();await rm(f.root,{recursive:true,force:true});
  const bundle=await exportSession(session,{format:'bundle',output:join(f.workspace,'bundle')}),imported=await importBundle(bundle,join(f.workspace,'imported')),projection=new SessionProjection(imported);await projection.update((await readSession(imported)).events);expect(JSON.stringify([...projection.rows.values()])).toContain('检查测试');expect(JSON.stringify([...projection.rows.values()])).toContain('审查结果');
  const htmlPath=await exportSession(imported,{format:'html',output:join(f.workspace,'offline.html')}),html=await readFile(htmlPath,'utf8');expect(html).toContain('检查测试');expect(html).toContain('面板不可用');expect(html).not.toMatch(/<script\b|<iframe\b|<link[^>]+https?:/i);
  await rm(join(imported,'artifacts',ui.propsArtifact.sha256));await expect(exportSession(imported,{format:'html',output:join(f.workspace,'missing.html')})).rejects.toThrow();
 }finally{await f.host.close();}
});
