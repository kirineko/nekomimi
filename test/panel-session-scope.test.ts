import { expect, it } from 'vitest';
import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../src/server/app.js';
import { temporary } from './helpers.js';

it('rejects foreign and missing session scope before reading, dispatching or closing a shared-host panel', async () => {
  const workspace=await temporary(), home=await temporary(), root=join(workspace,'.nekomimi/extensions/sakura');
  await mkdir(root,{recursive:true});
  await cp(resolve('extension-docs/examples/sakura'),root,{recursive:true});
  const app=await startWeb({workspace,home,naming:false});
  const headers={authorization:`Bearer ${app.token}`,origin:app.origin,'content-type':'application/json'};
  const action=(body:Record<string,unknown>)=>fetch(app.origin+'/api/v1/customization',{method:'POST',headers,body:JSON.stringify(body)});
  try {
    const a=await app.sessions.create('Owner',{commandId:'panel-owner',mode:'work'});
    const b=await app.sessions.create('Other',{commandId:'panel-other',mode:'work'});
    const host=app.sessions.customization, resource=(await host.catalog.discover()).find(r=>r.name==='sakura-studio')!;
    await host.catalog.decide(resource.id,true,true,0); const reload=host.requestReload(); await host.reload(reload); expect(reload.status,reload.error).toBe('activated');
    expect(host.panels.catalog().map(p=>p.id)).toContain('moe');
    const mounted=await action({action:'panel-mount',sessionId:a.id,resourceId:resource.id,panelId:'moe',revision:resource.hash,props:{name:'Scope'}});
    expect(mounted.status).toBe(200);
    const frame=await mounted.json() as {instanceId:string};
    for(const sessionId of [undefined,b.id]) {
      const doc=await fetch(app.origin+`/api/v1/panels/${frame.instanceId}/frame`+(sessionId?`?session=${sessionId}`:''),{headers});
      expect(doc.status).toBe(403);
      for(const method of ['draft.set','state.read','command.run','workflow.cancel']) {
        const result=await action({action:'panel-action',sessionId,instanceId:frame.instanceId,sequence:1,method,value:{text:'foreign'}});
        expect(result.status).toBe(403); expect(await result.json()).toMatchObject({error:{code:'panel_scope'}});
      }
      const closed=await action({action:'panel-unmount',sessionId,instanceId:frame.instanceId});
      expect(closed.status).toBe(403);
    }
    expect((await fetch(app.origin+`/api/v1/panels/${frame.instanceId}/frame?session=${a.id}`,{headers})).status).toBe(200);
    // Rejected requests neither consume the owner's sequence nor destroy its instance.
    const own=await action({action:'panel-action',sessionId:a.id,instanceId:frame.instanceId,sequence:1,method:'draft.set',value:{text:'owner'}});
    expect(own.status).toBe(200); expect(await own.json()).toMatchObject({uiAction:'draft.set',sessionId:a.id,value:{text:'owner'}});
    expect((await action({action:'panel-unmount',sessionId:a.id,instanceId:frame.instanceId})).status).toBe(200);
    await expect(app.sessions.panelDocument(frame.instanceId,a.id)).rejects.toThrow('expired');
  } finally { await app.close(); }
},30000);
