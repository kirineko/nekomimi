import { ConfigStore } from "../dist/config/store.js";
const userSettings = await new ConfigStore().snapshot();
import { png } from './image-fixture.mjs';
import {run,readSession} from '../dist/index.js';
import {mkdtemp,writeFile} from 'node:fs/promises';import {join} from 'node:path';
if(!userSettings.apiKey){console.log('SKIPPED: 请先运行 nekomimi config 或在 Web 保存 API key');process.exit(0);}
const workspace=await mkdtemp('/private/tmp/nekomimi-image-');
await writeFile(join(workspace,'pixel.png'),Buffer.from(png,'base64'));
const r=await run({workspace,session:join(workspace,'session'),...userSettings,apiKey:userSettings.apiKey,maxOutputTokens:2048,maxTurns:4,tools:['read'],images:[{type:'image',mimeType:'image/png',data:png}],prompt:'This is a synthetic test image. Also read pixel.png using read, then confirm you received both images. Do not modify files.'});
const s=await readSession(r.session);const tool=s.events.some(e=>e.type==='tool.result');console.log(JSON.stringify({workspace,status:r.status,toolResult:tool,attempts:s.events.filter(e=>e.type==='attempt.finished').map(e=>e.payload)}));if(r.status!=='completed'||!tool)process.exitCode=1;
