import { test, expect } from 'vitest';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/runtime.js';
import { readSession } from '../src/journal.js';
import { exportSession, importBundle } from '../src/export.js';
import { CoreTools } from '../src/tools.js';
import { Journal } from '../src/journal.js';
import { temporary, key, response, callItem, textItem } from './helpers.js';
import { formatReference } from '../src/shared/references.js';

test('references stay text while actual reads, changed files and replay use recorded evidence',async()=>{
  const workspace=await temporary(),session=join(workspace,'session');
  const path='中文 note.txt',prompt='查看 '+formatReference({path,kind:'file'});
  await writeFile(join(workspace,path),'old data');
  // Choosing a path has no content snapshot: modify before the tool consumes it.
  await writeFile(join(workspace,path),'actual read contents');
  const bodies:any[]=[];
  await run({workspace,session,prompt,apiKey:key,tools:['read'],fetch:async(_url,init)=>{
    bodies.push(JSON.parse(String(init?.body)));
    return response(bodies.length===1?[callItem('read',{path})]:[textItem('read complete')]);
  }});
  expect(JSON.stringify(bodies[0])).toContain('@\\"中文 note.txt\\"');
  expect(JSON.stringify(bodies[0])).not.toContain('actual read contents');
  expect(JSON.stringify(bodies[1])).toContain('actual read contents');expect(JSON.stringify(bodies[1])).not.toContain('old data');
  const before=await readSession(session);expect(before.events.some(e=>e.type==='tool.result')).toBe(true);
  await rm(join(workspace,path));
  const html=await exportSession(session,{format:'html',output:join(workspace,'view.html')});expect(await readFile(html,'utf8')).toContain('中文 note.txt');
  const bundle=await exportSession(session,{format:'bundle',output:join(workspace,'bundle')});
  const imported=await importBundle(bundle,join(workspace,'imported'));
  const after=await readSession(imported);expect(after.events).toEqual(before.events);expect(bodies).toHaveLength(2);
});
test('reference guidance only accompanies enabled tools; missing files and truncation remain explicit',async()=>{
  const workspace=await temporary(),journal=await Journal.open(join(workspace,'session'));
  try {
    const defs=(await CoreTools.create(workspace,journal,{}, {outputBytes:100})).definitions();
    const read=defs.find(d=>d.tool.name==='read')!;
    expect(read.guidance.join('\n')).toContain('not its contents');
    await expect(read.tool.execute('missing',{path:'deleted.txt'})).rejects.toThrow();
    await writeFile(join(workspace,'large.txt'),'x'.repeat(1000));
    const result=await read.tool.execute('read',{path:'large.txt'});
    expect(JSON.stringify(result)).toContain('truncated');
  }finally{await journal.close();}
});
