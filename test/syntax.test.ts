import {afterAll, expect, test} from 'vitest';
import {highlight} from '../src/presentation/syntax/core.js';
import {nodeSyntax} from '../src/presentation/syntax/node.js';
import {SyntaxPool, type PortFactory} from '../src/presentation/syntax/pool.js';
import {colorDiff} from '../src/presentation/syntax/diff.js';
import {tokenText, fileLanguage, languageName} from '../src/presentation/syntax/types.js';
import {markdownHtml} from '../src/presentation/syntax/markdown.js';
import {diffPage} from '../src/presentation/diff.js';
import {createPatch} from 'diff';
import {Journal} from '../src/journal.js';
import {temporary} from './helpers.js';
import {changeDiff} from '../src/server/changes.js';
import {writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {run} from '../src/runtime.js';
import {exportSession,importBundle} from '../src/export.js';
import {response,callItem,textItem,key} from './helpers.js';
afterAll(()=>nodeSyntax.dispose());
const plain=(lines:Awaited<ReturnType<typeof highlight>>)=>lines?.map(tokenText).join('\n');
test('fixed palette and supported languages preserve exact code including line endings',async()=>{
  execFileSync(process.execPath,['scripts/generate-syntax-styles.mjs','--check']);
  const samples={ts:'const x: string = "cat";',tsx:'const x = <div>{42}</div>;',js:'const x = 42;',py:'def f():\n  return "cat"',json:'{"a":42}',sh:'echo "$HOME"',diff:'@@ -1 +1 @@\n-old\n+new'};
  for(const [lang,text] of Object.entries(samples)) {
    const lines=await highlight(text,lang);expect(plain(lines)).toBe(text);
    expect(new Set(lines!.flat().map(t=>t.className)).size).toBeGreaterThan(1);
  }
  for(const text of ['\uFEFFconst x = "猫😺";\r\n','/* a\r\nb */\nconst x = `unfinished','const long = "'+'x'.repeat(5000)+'";','\n','']) expect(plain(await highlight(text,'ts'))).toBe(text);
  expect(await highlight('x','unknown')).toBeUndefined();
  expect(await highlight('x'.repeat(262145),'ts')).toBeUndefined();
  expect(await highlight('x\n'.repeat(5001),'ts')).toBeUndefined();
  expect(languageName('diff-ts')).toBe('diff-typescript');expect(fileLanguage('C:\\a\\x.ts')).toBe('typescript');
});
test('old/new grammar states survive hunks and 8/120 pagination, with exact truncated text',async()=>{
  const old='/*\n'+Array.from({length:140},(_,i)=>`line ${i}`).join('\n')+'\n*/\nconst x = 1;\n';
  const next=old.replace('line 3','changed 3').replace('line 125','changed 125').replace('const x = 1','const x = 2');
  const a=await highlight(old,'ts'),b=await highlight(next,'ts');
  const patch=createPatch('a.ts',old,next,undefined,undefined,{context:200});
  for(const limit of [8,120])for(let offset=0;offset<diffPage(patch,0,999).total;offset+=limit){
    const page=colorDiff(diffPage(patch,offset,limit),a,b);
    for(const line of page.lines.filter(l=>l.kind!=='header'))expect(tokenText(line.tokens!)).toBe(line.text);
  }
  expect(a![126]![0]!.className).not.toBe((await highlight('line 125','ts'))![0]![0]!.className);
  const left='/*\nconst value = 1;\n*/', right='//\nconst value = 2;\n//';
  const different=colorDiff(diffPage(createPatch('a.ts',left,right)),await highlight(left,'ts'),await highlight(right,'ts'));
  const removed=different.lines.find(l=>l.kind==='del' && l.text.startsWith('const'))!;
  const added=different.lines.find(l=>l.kind==='add' && l.text.startsWith('const'))!;
  expect(new Set(removed.tokens!.map(t=>t.className)).size).toBe(1);
  expect(new Set(added.tokens!.map(t=>t.className)).size).toBeGreaterThan(1);
  const text='\uFEFFconst x="猫😺'+ 'x'.repeat(5000)+'";\r\n';
  const page=colorDiff(diffPage(createPatch('a.ts','',text)),undefined,await highlight(text,'ts'));
  expect(page.lines[1]!.truncated).toBe(true);expect(tokenText(page.lines[1]!.tokens!)).toBe(page.lines[1]!.text);
});
test('extended diff keeps prefixes and distinct sides; malformed and unknown source fall back',async()=>{
  for(const text of ['@@ -1,2 +1,2 @@\n-const x = 1;\n+const x = "cat";\n // end\n','garbage\n+still readable','@@ -1 +1 @@\n-a\n+b\n@@ -8 +8 @@\n-x\n+y'])expect(plain(await highlight(text,'diff-ts'))).toBe(text);
  const result=await highlight('@@ -1 +1 @@\n-const a = 1;\n+const a = "x";','diff-ts');
  expect(result![1]!.every(t=>t.className.includes('syn-del'))).toBe(true);
  expect(result![2]!.some(t=>t.className.includes('syn-c'))).toBe(true);
  expect(plain(await highlight('+x','diff-unknown'))).toBe('+x');
});
test('Node worker SSR escapes HTML, preserves unknown language and uses no inline styles',async()=>{
  const html=await markdownHtml('```ts\nconst x = "<script>alert(1)</script>";\n```\n\n```unknown\nraw\n```','test');
  expect(html).toContain('syn-c');expect(html).not.toContain('<script>');expect(html).not.toContain('style=');expect(html).toContain('raw');
});
test('historical diff ignores disk changes and safely degrades a damaged or redacted side',async()=>{
  const journal=await Journal.open(await temporary());
  try{
    const before=await journal.artifact('/*\nold\n*/\n'),after=await journal.artifact('/*\nnew\n*/\n');
    const patch=await journal.artifact(createPatch('a.ts','/*\nold\n*/\n','/*\nnew\n*/\n'));
    await journal.append('tool.result',{source:'tool:edit',details:{path:'a.ts',before,after,patch}},{toolCallId:'t'});
    const entry={directory:journal.directory,reader:{events:journal.events}} as any;
    const first=await changeDiff(entry,patch.sha256,0,120);
    expect(first.lines.find(l=>l.kind==='add')!.tokens).toBeDefined();
    await writeFile(join(journal.directory,'a.ts'),'unrelated');
    expect(await changeDiff(entry,patch.sha256,0,120)).toEqual(first);
    await writeFile(join(journal.directory,'artifacts',before.sha256),'damaged');
    const damaged=await changeDiff(entry,patch.sha256,0,120);
    expect(damaged.lines.find(l=>l.kind==='del')!.tokens).toBeUndefined();
    expect(damaged.lines.find(l=>l.kind==='add')!.tokens).toBeDefined();
    (journal.events.at(-1)!.payload as any).details.after.redacted=true;
    expect((await changeDiff(entry,patch.sha256,0,120)).lines.find(l=>l.kind==='add')!.tokens).toBeUndefined();
  }finally{nodeSyntax.clearScope(journal.directory);await journal.close();}
});
test('worker timeouts terminate computation, recover, cancel and bound caches and queues',async()=>{
  let terminated=0,calls=0;
  const factory:PortFactory=(reply)=>({postMessage:({id,text})=>{
    calls++;reply({id,ready:true});
    if(text!=='hang')setTimeout(()=>reply({id,lines:[[{text,className:''}]]}),2);
  },terminate:()=>{terminated++;}});
  const pool=new SyntaxPool(factory,{computeMs:20,loadMs:30,maxEntries:2,maxBytes:200,maxQueue:1});
  try {
    expect(await pool.run('hang','ts')).toBeUndefined();expect(terminated).toBe(1);
    expect(await pool.run('ok','ts','a')).toBeDefined();const count=calls;
    await pool.run('ok','ts','a');expect(calls).toBe(count);
    await pool.run('ok','ts','b');expect(calls).toBe(count+1);
    await pool.run('another','ts','c');expect(pool.stats().entries).toBeLessThanOrEqual(2);expect(pool.stats().bytes).toBeLessThanOrEqual(200);
    pool.clearScope('c');expect(pool.stats().entries).toBeLessThanOrEqual(1);
    const abort=new AbortController();const p=pool.run('hang','ts','x',abort.signal);
    await new Promise(r=>setTimeout(r,5));abort.abort();expect(await p).toBeUndefined();
    const jobs=['hang','a','b','c'].map(t=>pool.run(t,'ts'));
    await new Promise(r=>setTimeout(r,5));expect(pool.stats().queued).toBeLessThanOrEqual(1);
    await Promise.all(jobs);
  }finally{pool.dispose();}
});

test('export highlights after redaction, preserves journal, and bundle import has no side effects',async()=>{
  const workspace=await temporary(),session=join(workspace,'session');let calls=0;
  await run({workspace,session,prompt:'write',apiKey:key,fetch:async()=>++calls===1?response([callItem('write',{path:'a.ts',content:'const secret = "private-word";\n'})]):response([textItem('```ts\nconst secret = "private-word";\n```')])});
  const journal=await readFile(join(session,'journal.jsonl'));
  const htmlPath=join(workspace,'view.html');await exportSession(session,{format:'html',output:htmlPath,redact:['private-word']});
  const html=await readFile(htmlPath,'utf8');expect(html).toContain('syn-c');expect(html).not.toContain('private-word');expect(html).toContain('[REDACTED]');
  await exportSession(session,{format:'bundle',output:join(workspace,'bundle')});
  await importBundle(join(workspace,'bundle'),join(workspace,'imported'));
  expect(calls).toBe(2);expect(await readFile(join(session,'journal.jsonl'))).toEqual(journal);
});
