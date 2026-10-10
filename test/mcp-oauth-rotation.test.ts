import {expect,it} from 'vitest';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {McpOAuth} from '../src/customization/mcp-oauth.js';
import {McpConnection} from '../src/customization/mcp.js';
import {temporary} from './helpers.js';
import {rotatingOAuthFixture,expireOAuth} from './fixtures/oauth-rotation.js';

it('isolates accounts on the same URL and refuses a mismatched callback issuer',async()=>{
 const f=await rotatingOAuthFixture(),home=await temporary(),oauth=new McpOAuth(home),a=f.resource('one'),b=f.resource('two');
 try{
  const callback=await f.authorize(oauth,a),wrong=new URL(callback);wrong.searchParams.set('iss','https://wrong.invalid');expect((await fetch(wrong)).status).toBe(400);
  expect((await fetch(callback)).status).toBe(200);expect((await fetch(await f.authorize(oauth,b))).status).toBe(200);
  expect(await oauth.token(a)).toBe('access-1-0');expect(await oauth.token(b)).toBe('access-2-0');
  await oauth.disconnect(a);await expect(oauth.token(a)).rejects.toThrow('authorization required');expect(await oauth.token(b)).toBe('access-2-0');
  expect(JSON.stringify([await oauth.describe(a),await oauth.describe(b)])).not.toMatch(/access-|refresh-/);
 }finally{oauth.close();await f.close();}
});
it('persists a rotated token after business cancellation and never dispatches the cancelled tool',async()=>{
 const f=await rotatingOAuthFixture(),home=await temporary(),oauth=new McpOAuth(home),r=f.resource('one'),abort=new AbortController();
 let connection:McpConnection|undefined,restarted:McpOAuth|undefined;
 try{
  expect((await fetch(await f.authorize(oauth,r))).status).toBe(200);connection=new McpConnection(r,await temporary(),oauth);await connection.connect();
  await expireOAuth(home,'access-1-0');const started=f.hold();const pending=connection.call('job',{},abort.signal);const rejected=expect(pending).rejects.toThrow('UNKNOWN');
  await started;abort.abort(new Error('business cancelled'));f.release();await rejected;
  // Taking the same credential lock also waits for rotation persistence to finish.
  expect(await oauth.token(r)).toBe('access-1-1');expect(f.counts()).toEqual({refreshes:1,calls:0});oauth.close();
  restarted=new McpOAuth(home);expect(await restarted.token(r)).toBe('access-1-1');
  const files=await readdir(join(home,'mcp-auth')),contents=await Promise.all(files.filter(n=>n.endsWith('.json')).map(n=>readFile(join(home,'mcp-auth',n),'utf8')));
  expect(contents.join('')).toContain('refresh-1-1');expect(contents.join('')).not.toContain('refresh-1-0');expect(JSON.stringify(await restarted.describe(r))).not.toContain('access-1-1');
 }finally{f.release();await connection?.close();oauth.close();restarted?.close();await f.close();}
});
it('does not return a refreshed credential after explicit disconnect wins its generation',async()=>{
 const f=await rotatingOAuthFixture(),home=await temporary(),oauth=new McpOAuth(home),r=f.resource('one');
 try{
  await fetch(await f.authorize(oauth,r));await expireOAuth(home,'access-1-0');const started=f.hold(),pending=oauth.token(r);const rejected=expect(pending).rejects.toThrow('revoked');
  await started;const disconnect=oauth.disconnect(r);f.release();await rejected;await disconnect;
  expect((await oauth.describe(r)).status).toBe('disconnected');await expect(oauth.token(r)).rejects.toThrow('authorization required');expect(f.counts().refreshes).toBe(1);
 }finally{f.release();oauth.close();await f.close();}
});
it('keeps account credentials out of Journal artifacts and browser management responses',async()=>{
 const f=await rotatingOAuthFixture(),home=await temporary(),workspace=await temporary();
 const {mkdir,writeFile}=await import('node:fs/promises'),{CustomizationHost}=await import('../src/customization/host.js'),{run}=await import('../src/runtime.js'),{startWeb}=await import('../src/server/app.js'),{mcpToolName}=await import('../src/customization/mcp-discovery.js'),{key,response,callItem,textItem}=await import('./helpers.js'),{readSession}=await import('../src/journal.js');
 await mkdir(join(workspace,'.nekomimi'));await writeFile(join(workspace,'.nekomimi/mcp.json'),JSON.stringify({version:1,servers:{private:f.resource('one').config}}));
 const host=new CustomizationHost(workspace,home);let app:Awaited<ReturnType<typeof startWeb>>|undefined,models=0;
 try{
  const resource=(await host.catalog.discover()).find(r=>r.kind==='mcp')!;await host.catalog.decide(resource.id,true,true,0);await fetch(await f.authorize(host.oauth,resource));
  const tool=mcpToolName(resource,'job');
  const result=await run({workspace,home,customization:host,session:join(workspace,'session'),apiKey:key,prompt:'run tool',tools:[tool],fetch:async()=>response(++models===1?[callItem(tool,{})]:[textItem()])});
  expect(result.status,result.error).toBe('completed');expect(f.counts().calls).toBe(1);
  const snapshot=await readSession(result.session);expect(JSON.stringify(snapshot.events)).not.toMatch(/access-1-0|refresh-1-0/);
  for(const name of await readdir(join(result.session,'artifacts')))expect(await readFile(join(result.session,'artifacts',name),'utf8')).not.toMatch(/access-1-0|refresh-1-0/);
  await host.close();app=await startWeb({workspace,home,apiKey:key,naming:false});
  const res=await fetch(app.origin+'/api/v1/customization',{headers:{authorization:`Bearer ${app.token}`,origin:app.origin}});expect(res.status).toBe(200);
  const text=await res.text();expect(text).toContain('authorized');expect(text).not.toMatch(/access-1-0|refresh-1-0/);
 }finally{await app?.close();await host.close();await f.close();}
});
