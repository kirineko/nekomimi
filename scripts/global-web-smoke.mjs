import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
const [cli, root] = process.argv.slice(2);
const home = join(root, 'isolated-home');
const installedCli = await readFile(cli);
const installedRoot = dirname(dirname(await realpath(cli)));
const indexBefore = await readFile(join(installedRoot,'dist/web-dist/index.html'));
const a = join(root, '项目 project-a'), b = join(root, 'project-b');
await mkdir(a); await mkdir(b);
const item = (text) => ({ type:'message', id:'message', role:'assistant', status:'completed', content:[{type:'output_text', text, annotations:[]}] });
let calls = 0;
const model = createServer(async (req, res) => {
  let raw=''; for await (const chunk of req) raw += chunk;
  const body=JSON.parse(raw); calls++;
  const output = body.instructions.includes('Name this conversation') ? [item('项目任务')] : body.input.some(i=>i.type==='function_call_output') ? [item('done')] : [{type:'function_call', id:'tool',call_id:'write-one',name:'write',arguments:JSON.stringify({path:'hello.txt',content:'installed package\n'}),status:'completed'}, {type:'function_call',id:'shell',call_id:'shell-one',name:process.platform === 'win32' ? 'powershell' : 'bash',arguments:JSON.stringify({command:process.platform === 'win32' ? '[System.IO.File]::WriteAllText((Join-Path (Get-Location).Path \"cwd.txt\"), (Get-Location).Path)' : 'pwd > cwd.txt'}),status:'completed'}];
  const events=[{type:'response.created',response:{id:'r',status:'in_progress'}}];
  for (const [index,i] of output.entries()) { events.push({type:'response.output_item.added',output_index:index,item:i},{type:'response.output_item.done',output_index:index,item:i}); }
  events.push({type:'response.completed',response:{id:'r',status:'completed',output,usage:{input_tokens:1,output_tokens:1}}});
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
});
model.listen(0,'127.0.0.1'); await once(model,'listening');
async function start(cwd) {
  const child=spawn(process.execPath,[cli,'web','--home',home,'--port','0'],{cwd,stdio:['ignore','pipe','pipe']});
  let output='';
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Web startup timeout '+output));},15000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/Web: (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.stderr.on('data',chunk=>output+=chunk);
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Web exited '+code+' '+output));});
  });
  const endpoint=new URL(url), token=endpoint.hash.slice(7);
  return { async request(path,body) {
    const r=await fetch(endpoint.origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,origin:endpoint.origin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    if(!r.ok)throw new Error(await r.text()); return r.json();
  }, async stop(){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done;
    // Windows kill forcibly terminates Node without running SIGTERM cleanup.
    // Allow the service's 10-second writer lease to expire before reopening it.
    if(process.platform === 'win32')await new Promise(resolve=>setTimeout(resolve,11000));
  }, origin:endpoint.origin };
}
let app;
try {
  app=await start(a);
  const page=await fetch(app.origin); if(!page.ok)throw new Error('Homepage rejected');
  const html=await page.text(); const asset=html.match(/src="([^"]+\.js)"/)[1];
  const css=html.match(/href="([^"]+\.css)"/)[1];
  if(!(await fetch(app.origin+css)).ok)throw new Error('Missing CSS');
  if(!(await fetch(app.origin+asset)).ok)throw new Error('Missing installed web asset');
  await app.request('/settings',{kind:'auth',revision:0,apiKey:'synthetic-global-key'});
  await app.request('/settings',{kind:'settings',revision:0,model:'fixture',baseUrl:`http://127.0.0.1:${model.address().port}`});
  const s=await app.request('/sessions',{version:1,title:'new'});
  await app.request(`/sessions/${s.id}/submit`,{version:1,commandId:'global',prompt:'write hello.txt'});
  for(let i=0;i<200;i++) {const snap=await app.request(`/sessions/${s.id}/snapshot`);if(snap.session.status==='failed')throw new Error('Installed task failed');if(snap.session.status==='completed'&&!snap.session.naming)break;if(i===199)throw new Error('Task timeout');await new Promise(r=>setTimeout(r,100));}
  if(await readFile(join(a,'hello.txt'),'utf8')!=='installed package\n')throw new Error('Wrong write location');
  if((await readFile(join(a,'cwd.txt'),'utf8')).trim()!==await realpath(a))throw new Error('Wrong shell cwd');
  if(!(await readFile(cli)).equals(installedCli)||!(await readFile(join(installedRoot,'dist/web-dist/index.html'))).equals(indexBefore))throw new Error('Installation was modified');
  await app.stop();app=await start(b);
  if((await app.request('/sessions')).sessions.length)throw new Error('Workspace history leaked');
  await app.stop();const alias=join(root,'alias-a');await symlink(await realpath(a),alias,process.platform === 'win32' ? 'junction' : 'dir');app=await start(alias);
  if(!(await app.request('/sessions')).sessions.some(x=>x.id===s.id))throw new Error('History not restored');
  if(!(await app.request('/config')).configured)throw new Error('Credentials not persisted');
  console.log(JSON.stringify({globalCli:true,webAssets:true,fileConfiguration:true,workspaceIsolation:true,canonicalPath:true,calls}));
} finally { if(app)await app.stop();model.close(); }
