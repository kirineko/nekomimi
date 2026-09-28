import type { ComponentType } from 'react';
export interface Feature<P> { load: () => Promise<ComponentType<P>>; name:string; attempts:number; component?: ComponentType<P>; pending?: Promise<ComponentType<P>> }
function feature<P>(name:string, load: () => Promise<ComponentType<P>>): Feature<P> { return {name,load,attempts:0}; }
export const features = {
 customization: feature('Customization', () => import('./components/Customization').then(m => m.Customization)),
 files: feature('FileBrowser', () => import('./components/FileBrowser').then(m => m.FileBrowser)),
 changes: feature('Changes', () => import('./components/Changes').then(m => m.Changes)),
 inspector: feature('Inspector', () => import('./components/Inspector').then(m => m.Inspector)),
 export: feature('ExportDialog', () => import('./components/ExportDialog').then(m => m.ExportDialog)),
};
// Failed native imports may be cached by the browser. Resolve the same built
// entry from Vite's public manifest and give an explicit retry a fresh URL.
async function retryFeature<P>(feature:Feature<P>):Promise<ComponentType<P>> {
 if(import.meta.env.DEV){const url=`/components/${feature.name}.tsx?retry=${feature.attempts}`;return (await import(/* @vite-ignore */ url))[feature.name];}
 const response=await fetch('/assets/asset-manifest.json',{cache:'no-store'});
 if(!response.ok)throw new Error('资源目录不可用');
 const manifest=await response.json() as Record<string,{file:string}>;
 const entry=manifest[`components/${feature.name}.tsx`];
 if(!entry || !/^assets\/[a-zA-Z0-9_.-]+\.js$/.test(entry.file))throw new Error('资源入口不可用');
 const url=new URL(entry.file,location.origin);url.searchParams.set('retry',String(feature.attempts));
 const module=await import(/* @vite-ignore */ url.href);
 if(typeof module[feature.name]!=='function')throw new Error('界面不可用');
 return module[feature.name];
}
export function loadFeature<P>(feature: Feature<P>) {
 if(feature.component)return Promise.resolve(feature.component);
 if(feature.pending)return feature.pending;
 const retry=feature.attempts++>0;
 return feature.pending=(retry?retryFeature(feature):feature.load()).then(component=>{feature.component=component;return component;}).catch(error=>{feature.pending=undefined;throw error;});
}
