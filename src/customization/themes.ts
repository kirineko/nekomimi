import {join} from 'node:path';
import lockfile from 'proper-lockfile';
import {directory} from '../storage/paths.js';
import {atomicFile} from '../journal.js';
import {boundedRead,exists,safePath} from './resources.js';
import type {CustomizationHost} from './host.js';
import type {ThemeSelection,ThemePreference} from './ui-contract.js';
export class Themes {
  constructor(readonly host:CustomizationHost) {}
  private root(scope:'user'|'project') {return scope==='user'?this.host.catalog.home:join(this.host.catalog.workspace,'.nekomimi');}
  async preference(scope:'user'|'project'):Promise<ThemePreference> {
    const root=await directory(this.root(scope)),file=await safePath(root,'ui-theme.json');
    const value=await exists(file)?JSON.parse(await boundedRead(file)):{version:1,revision:0};
    if(value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('Invalid theme preference');
    return value;
  }
  async catalog() {
    const items=[];
    for(const extension of this.host.active?.extensions??[]) {
      const grant=await this.host.catalog.grant(extension.resource);
      if(!grant?.enabled||!grant.trusted||!grant.capabilities?.includes('themes'))continue;
      for(const theme of extension.themes??[])items.push({...theme,resourceId:extension.resource.id,revision:extension.resource.hash});
    }
    return items;
  }
  async describe() {
    const [themes,user,project]=await Promise.all([this.catalog(),this.preference('user'),this.preference('project')]);
    const selection=project.selection!==undefined?project.selection:user.selection;
    const active=selection?themes.find(t=>t.id===selection.id&&t.resourceId===selection.resourceId&&t.revision===selection.revision):undefined;
    return {themes,user,project,active,unavailable:!!selection&&!active};
  }
  async select(scope:'user'|'project', selection:ThemeSelection|null|undefined, expected:number) {
    if(!['user','project'].includes(scope))throw new Error('Invalid theme scope');
    if(selection&&!(await this.catalog()).some(t=>t.id===selection.id&&t.resourceId===selection.resourceId&&t.revision===selection.revision))throw new Error('Theme not authorized or revision unavailable');
    const root=await directory(this.root(scope)),release=await lockfile.lock(root,{retries:{retries:10,minTimeout:20,maxTimeout:100}});
    try {const old=await this.preference(scope);if(old.revision!==expected)throw new Error('Theme revision conflict');const value={version:1,revision:old.revision+1,selection};await atomicFile(await safePath(root,'ui-theme.json'),JSON.stringify(value));return value;}
    finally {await release();}
  }
}
