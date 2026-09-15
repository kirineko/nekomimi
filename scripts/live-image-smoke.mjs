import { png } from './image-fixture.mjs';
import {run,readSession} from '../dist/index.js';
import {mkdtemp,writeFile} from 'node:fs/promises';import {join} from 'node:path';
if(!process.env.DEEPSEEK_API_KEY){console.log('SKIPPED: DEEPSEEK_API_KEY unavailable');process.exit(0);}
const workspace=await mkdtemp('/private/tmp/harness-image-');
await writeFile(join(workspace,'pixel.png'),Buffer.from(png,'base64'));
const r=await run({workspace,session:join(workspace,'session'),apiKey:process.env.DEEPSEEK_API_KEY,maxOutputTokens:2048,maxTurns:4,tools:['read'],images:[{type:'image',mimeType:'image/png',data:png}],prompt:'This is a synthetic test image. Also read pixel.png using read, then confirm you received both images. Do not modify files.'});
const s=await readSession(r.session);const tool=s.events.some(e=>e.type==='tool.result');console.log(JSON.stringify({workspace,status:r.status,toolResult:tool,attempts:s.events.filter(e=>e.type==='attempt.finished').map(e=>e.payload)}));if(r.status!=='completed'||!tool)process.exitCode=1;
