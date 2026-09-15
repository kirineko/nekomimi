import { png } from './image-fixture.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run, readSession, exportSession } from '../dist/index.js';
if (!process.env.DEEPSEEK_API_KEY) { console.log('SKIPPED: DEEPSEEK_API_KEY unavailable'); process.exit(0); }
const workspace = await mkdtemp('/private/tmp/harness-live-');
await writeFile(join(workspace, 'source.txt'), 'synthetic violet 42\n');
const settings = { workspace, session: join(workspace, 'session'), apiKey: process.env.DEEPSEEK_API_KEY, maxOutputTokens: 2048, maxTurns: 5, timeoutMs: 90000, tools: ['read', 'write'] };
const first = await run({ ...settings, prompt: 'Read source.txt using read, then write its exact content to copied.txt using write, then say done. These are synthetic test files.' });
if (first.status !== 'completed' || await readFile(join(workspace, 'copied.txt'), 'utf8') !== 'synthetic violet 42\n') throw new Error(`Live tool flow failed: ${first.status} ${first.error ?? ''}`);
const second = await run({ ...settings, prompt: 'Without tools, what exact text did you copy in the previous turn?' });
if (second.status !== 'completed' || !second.text.includes('violet')) throw new Error('Live resume failed');
await exportSession(settings.session, { format: 'html', output: join(workspace, 'session.html') });
const snapshot = await readSession(settings.session);
console.log(JSON.stringify({ workspace, statuses: [first.status, second.status], attempts: snapshot.events.filter(e => e.type === 'attempt.finished').map(e => e.payload), durableSeq: snapshot.durableSeq }, null, 2));

await writeFile(join(workspace, 'pixel.png'), Buffer.from(png, 'base64'));
const imageRun = await run({ ...settings, session: join(workspace, 'image-session'), tools: ['read'], images: [{ type: 'image', mimeType: 'image/png', data: png }], prompt: 'This is a synthetic tiny test image. Also read pixel.png using read, then confirm you received both images. Do not modify files.' });
const imageSnapshot = await readSession(imageRun.session);
if (imageRun.status !== 'completed' || !imageSnapshot.events.some(e => e.type === 'tool.result')) throw new Error(`Live image flow failed: ${imageRun.status}`);
console.log(JSON.stringify({ imageStatus: imageRun.status, imageAttempts: imageSnapshot.events.filter(e => e.type === 'attempt.finished').length }));
