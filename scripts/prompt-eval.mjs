// Offline by default. --live deliberately opts into real model calls in isolated workspaces.
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run,readSession} from '../dist/index.js';
import {Journal} from '../dist/journal.js';
import {nameSession} from '../dist/session/title.js';
const live=process.argv.includes('--live');
const repeats=Number(process.env.PROMPT_EVAL_REPEATS??1);
if(!Number.isSafeInteger(repeats)||repeats<1||repeats>10)throw new Error('PROMPT_EVAL_REPEATS must be 1..10');
const model=process.env.PROMPT_EVAL_MODEL??'deepseek-flash';
const scenarios=[
 {id:'copy',tools:['read','write'],prompt:'读取 source.txt 并将原始内容完整写入 copied.txt，然后简洁报告结果。'},
 {id:'edit',tools:['read','edit'],prompt:'读取 source.txt，把 violet 改为 purple，42 改为 43，使用同一次 edit 的两个独立 edits。'},
 {id:'restricted',tools:['read'],prompt:'读取 source.txt，并说明当前工具是否能修改文件；不要尝试调用未提供的工具。'},
 {id:'sdk',tools:['customization_sdk'],prompt:'读取当前安装版 SDK 的开发指南，说明项目级主题和用户级主题的开发、授权和实际应用证据区别，不执行修改。'},
 {id:'compact',tools:[],prompt:'/compact preserve UNKNOWN tool outcomes'},
 {id:'title',tools:[],prompt:'请给这个关于项目字体设计的会话起一个简短标题。'},
];
if(live&&!process.env.DEEPSEEK_API_KEY)throw new Error('--live requires DEEPSEEK_API_KEY');
const output=[];
for(let repetition=1;repetition<=repeats;repetition++)for(const scenario of scenarios){
 const workspace=await mkdtemp(join(tmpdir(),'nekomimi-prompt-eval-')),home=join(workspace,'home'),session=join(workspace,'session');
 await writeFile(join(workspace,'source.txt'),'synthetic violet 42\n');
 const options={workspace,home,session,apiKey:process.env.DEEPSEEK_API_KEY??'offline',model,maxOutputTokens:2048,maxTurns:12,timeoutMs:90000,tools:scenario.tools};
 if(!live){output.push({scenario:scenario.id,repetition,status:'not run',model,config:{maxOutputTokens:2048,maxTurns:12},prompt:scenario.prompt,expected:scenario.id==='copy'?'copied.txt equals source':scenario.id==='edit'?'source becomes synthetic purple 43':scenario.id==='compact'?'checkpoint preserves UNKNOWN':scenario.id==='title'?'valid title journal event':'manual quality review required'});continue;}
 if(scenario.id==='compact'){
  const j=await Journal.open(session);try{for(let i=0;i<5;i++)await j.append('context.add',{source:'fixture',item:{role:'user',content:'Historical constraint '+i+' UNKNOWN deployment outcome. '+ 'synthetic '.repeat(30000)}});}finally{await j.close();}
 }
 const start=performance.now();const result=await run({...options,prompt:scenario.prompt});
 if(scenario.id==='title')await nameSession(session,options,new AbortController().signal);
 const {events}=await readSession(session);
 let outcome='manual review required';
 if(scenario.id==='copy')outcome=await readFile(join(workspace,'copied.txt'),'utf8').then(s=>s==='synthetic violet 42\n'?'passed':'failed').catch(()=> 'failed');
 if(scenario.id==='edit')outcome=(await readFile(join(workspace,'source.txt'),'utf8'))==='synthetic purple 43\n'?'passed':'failed';
 if(scenario.id==='compact')outcome=events.some(e=>e.type==='compaction.completed'&&String(e.payload.summary).includes('UNKNOWN'))?'passed':'failed';
 if(scenario.id==='title')outcome=events.some(e=>e.type==='session.title')?'passed':'failed';
 const attempts=events.filter(e=>e.type==='attempt.finished');
 output.push({scenario:scenario.id,repetition,model,status:result.status,outcome,config:{maxOutputTokens:2048,maxTurns:12},attempts:attempts.length,invalidCalls:events.filter(e=>['tool.failed','tool.execution_error'].includes(e.type)).length,turns:events.filter(e=>e.type==='attempt.started'&&!e.payload.purpose).length,usage:attempts.map(e=>e.payload.usage),elapsedMs:Math.round(performance.now()-start),session});
}
console.log(JSON.stringify({mode:live?'live':'offline-plan',model,repeats,qualityClaim:live?'Inspect per-scenario outcomes; manual cases are not completion evidence':'Real model quality not measured',results:output},null,2));
