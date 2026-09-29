import { expect, test } from 'vitest';
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { temporary } from './helpers.js';
import { formatReference, parseReference, replaceSegments, serialize, referenceWord, decodeClipboard, type Segment } from '../src/shared/references.js';
import { ReferenceHistory } from '../src/web/reference-model.js';
import { WorkspaceReferences } from '../src/server/references.js';

test('reference grammar preserves literal path names and rejects escape/control paths', () => {
  for (const path of ['src/main.ts','中文/空 格.md','a"b.txt','a\\b.txt','a@b.txt','目录']) for(const kind of ['file','directory'] as const) expect(parseReference(formatReference({path,kind}))).toEqual({path,kind});
  for(const path of ['../a','/tmp/a','a/../b','a\n.txt','C:/secret']) expect(()=>formatReference({path,kind:'file'})).toThrow();
});
test('atomic edits and undo keep text, whole references, ordering and selection', () => {
  const segments: Segment[] = [{type:'text',text:'看 '},{type:'reference',path:'my docs',kind:'directory'},{type:'text',text:' 后面'}];
  const history=new ReferenceHistory();history.reset(segments);history.select(3,3);
  const edit=replaceSegments(segments,3,3,[]);history.commit({segments:edit.segments,start:edit.caret,end:edit.caret});
  expect(serialize(history.state.segments)).toBe('看  后面');history.move(false);expect(history.state.segments).toEqual(segments);expect(history.state.start).toBe(3);
  history.move(true);expect(serialize(history.state.segments)).toBe('看  后面');
  const paste=decodeClipboard(JSON.stringify({version:1,segments}));expect(paste).toEqual(segments);
  expect(()=>decodeClipboard(JSON.stringify({version:1,segments:[{type:'reference',path:'../secret',kind:'file'}]}))).toThrow();
  expect(()=>replaceSegments([],0,0,[{type:'text',text:'x'.repeat(32001)}])).toThrow();
});
test('completion follows caret, excludes mail/code/chips/selections and preserves suffix', () => {
  const token=(text:string,caret=text.length,end=caret)=>referenceWord([{type:'text',text}],caret,end);
  expect(token('请看 @src/')).toMatchObject({start:3,query:'src/'});
  expect(token('@"my docs/')).toMatchObject({query:'my docs/'});
  for(const text of ['a@example.com','`@foo','```ts\n@foo','~~~\n@foo']) expect(token(text)).toBeUndefined();
  expect(token('`code` @foo')).toBeDefined();expect(token('```\nx\n```\n@foo')).toBeDefined();
  expect(token('@foo',4,2)).toBeUndefined();
  expect(referenceWord([{type:'reference',path:'a',kind:'file'}],2)).toBeUndefined();
  const text='前 @src 后';const word=token(text,6)!;
  expect(serialize(replaceSegments([{type:'text',text}],word.start,word.end,[{type:'reference',path:'src/a.ts',kind:'file'}]).segments)).toBe('前 @src/a.ts 后');
});
test('search ranks, bounds, pages live directories, refreshes and validates alias boundaries', async()=>{
  const root=await temporary(),outside=await temporary();
  await mkdir(join(root,'src'));await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','private.ts'),'not indexed');
  for(let i=0;i<27;i++)await writeFile(join(root,'src',`item-${String(i).padStart(2,'0')}.ts`),'not read');
  await writeFile(join(root,'.hidden'),'hidden');await symlink(outside,join(root,'outside'));await symlink(root,join(root,'cycle'));await symlink(join(root,'src'),join(root,'alias'));
  const refs=new WorkspaceReferences(root);
  expect((await refs.list('item')).entries).toHaveLength(20);expect((await refs.list('private')).entries).toHaveLength(0);
  const page=await refs.list('src/');expect(page.entries).toHaveLength(20);expect((await refs.list('src/',page.next)).entries).toHaveLength(7);
  expect((await refs.list('.hid')).entries[0]?.path).toBe('.hidden');
  expect((await refs.list('node_modules/')).entries[0]?.path).toBe('node_modules/private.ts');
  expect((await refs.resolve('alias')).kind).toBe('directory');
  await expect(refs.resolve('outside')).rejects.toThrow();await expect(refs.resolve('cycle')).rejects.toThrow();await expect(refs.list('cycle/')).rejects.toThrow();
  await expect(refs.resolve('../secret')).rejects.toThrow();
  await writeFile(join(root,'src','extra.ts'),'x');await expect(refs.list('src/',page.next)).rejects.toThrow('目录已变化');
  await rm(join(root,'src','item-00.ts'));expect((await refs.list('item-00')).entries).toHaveLength(0);
  expect((await refs.list('extra',undefined,true)).entries[0]?.name).toBe('extra.ts');refs.close();
});
test('bounded indexes expose limits, share scans, and cancel without poisoning future queries',async()=>{
  const root=await temporary();for(let i=0;i<150;i++)await writeFile(join(root,`file-${i}.txt`),'x');
  const limited=new WorkspaceReferences(root,10);expect((await limited.list('file')).limited).toBe(true);limited.close();
  const refs=new WorkspaceReferences(root),abort=new AbortController();
  const first=refs.list('file',undefined,false,abort.signal);const second=refs.list('file');abort.abort();
  await expect(first).rejects.toThrow();expect((await second).entries).toHaveLength(20);
  const cancelled=new AbortController();cancelled.abort();await expect(refs.list('file',undefined,false,cancelled.signal)).rejects.toThrow();
  expect((await refs.list('file',undefined,true)).entries).toHaveLength(20);refs.close();
});

test('serialized reference-only prompts use the existing submit limit and wire schema',async()=>{
  const {parseSubmit}=await import('../src/shared/protocol.js');
  const prompt=formatReference({path:'my docs',kind:'directory'});
  expect(parseSubmit({version:1,commandId:'reference',prompt})).toEqual({version:1,commandId:'reference',prompt});
  expect(()=>parseSubmit({version:1,commandId:'reference',prompt:'x'.repeat(32001)})).toThrow();
});
