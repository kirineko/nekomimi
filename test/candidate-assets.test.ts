import { expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Candidates } from '../src/customization/candidates.js';
import { buildTheme } from '../src/customization/theme-build.js';
import { contentHash } from '../src/customization/validation.js';
test('candidate binary bytes survive immutable preparation and rollback, old text digests remain stable', async () => {
 const root=await mkdtemp(join(tmpdir(),'candidate-assets-'));
 try {
  const store=new Candidates(root), draft=await store.scaffold('assets','theme');
  const text=await store.inspect(draft.id);
  const legacy = await store.prepare(draft.id,text.candidate.contentHash);
  await rm(join(legacy.resource.root,'.candidate-snapshot.json'));
  expect((await store.load({name:'assets',resourceId:legacy.resource.id,revision:legacy.resource.hash,grantedCapabilities:[]})).hash).toBe(text.candidate.contentHash);
  expect(text.resource.hash).toBe(contentHash(text.resource.files!));
  const font=Buffer.concat([Buffer.from('wOFF'),Buffer.from([0,255,128,192,0])]);
  const png=Buffer.from([137,80,78,71,13,10,26,10,255,0,128]);
  await writeFile(join(draft.path,'font.woff'),font); await writeFile(join(draft.path,'image.png'),png);
  const inspected=await store.inspect(draft.id); expect(inspected.candidate.report.passed).toBe(true);
  const {resource}=await store.prepare(draft.id,inspected.candidate.contentHash);
  expect(await readFile(join(resource.root,'font.woff'))).toEqual(font);
  const exported=await store.export(draft.id,resource.hash,'theme.tgz');
  const {x}=await import('tar'),{mkdir}=await import('node:fs/promises');
  const unpacked=join(root,'unpacked');await mkdir(unpacked);await x({file:exported.path,cwd:unpacked});
  expect(await readFile(join(unpacked,'font.woff'))).toEqual(font);
  const theme=await buildTheme(resource,{id:'assets',title:'素材',typography:{font:'font.woff'},assets:{background:'image.png'}});
  expect(theme.assetsData?.background).toContain(png.toString('base64'));
  await store.commit(resource,['themes'],0);
  await writeFile(join(draft.path,'image.png'),Buffer.concat([png,Buffer.from([1])]));
  const next=await store.inspect(draft.id); const prepared=await store.prepare(draft.id,next.candidate.contentHash);
  await store.commit(prepared.resource,['themes'],1);
  expect((await store.previous('assets')).hash).toBe(resource.hash);
  await chmod(join(resource.root,'image.png'),0o644); await writeFile(join(resource.root,'image.png'),'tampered');
  await expect(store.previous('assets')).rejects.toThrow(/integrity|MIME/);
  expect((await store.active())[0]?.revision).toBe(prepared.resource.hash);
 } finally { await rm(root,{recursive:true,force:true}); }
},30000);
