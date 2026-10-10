import { expect, it } from 'vitest';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Sessions } from '../src/server/sessions.js';
import { sessionBinding } from '../src/session/identity.js';
import { readSession } from '../src/journal.js';
import { temporary } from './helpers.js';
import { CoreCandidates } from '../src/core/candidates.js';
import { hostIdentity } from '../src/customization/sdk.js';
it.each(['work','extension','core'] as const)('branches %s preserving exact mode and target identity and deduplicates after restart', async kind => {
  const workspace = await temporary(), home = await temporary(), development = await temporary();
  let service = await Sessions.open({workspace,home,naming:false});
  try {
    let target = development;
    if (kind === 'core') {
      const version = (await hostIdentity()).version;
      await mkdir(join(development,'src'));
      await writeFile(join(development,'package.json'),JSON.stringify({name:'nekomimi',version,scripts:{build:'node build.cjs'}}));
      await writeFile(join(development,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{name:'nekomimi',version}}}));
      await writeFile(join(development,'src/cli.ts'),'// fixture');await writeFile(join(development,'tsconfig.build.json'),'{}');
      const candidates = new CoreCandidates(workspace,home), preview = await candidates.preview(development);
      target = join(await temporary(),'candidate');
      await candidates.prepare({source:development,destination:target,sourceRevision:preview.source.revision,targetHostBuild:preview.targetHost.build});
    }
    const source = await service.create('原会话',{commandId:'source',mode:kind==='work'?'work':'create',...(kind==='work'?{}:{target:{kind,root:target,scope:'project' as const}})});
    const sourcePath = join(service.root,source.id), before = await readFile(join(sourcePath,'journal.jsonl'));
    const input = {action:'history-branch',sessionId:source.id,omitReasoning:false,commandId:'branch-once'};
    const first = await service.customizationAction(input);
    expect(first).toEqual({sessionId:'branch-once',mode:source.binding!.mode});
    const result = await readSession(join(service.root,'branch-once')), binding = sessionBinding(result.events)!;
    expect(binding.target).toEqual(source.binding!.target);expect(binding.ownerWorkspace).toBe(source.binding!.ownerWorkspace);expect(binding.mode).toBe(source.binding!.mode);
    expect(result.events.filter(event=>event.type==='branch.created')).toHaveLength(1);
    expect(result.events.some(event=>['tool.intent','request.started','model.call.started'].includes(event.type))).toBe(false);
    await service.close(); service = await Sessions.open({workspace,home,naming:false});
    expect(await service.customizationAction(input)).toEqual(first);
    await expect(service.customizationAction({...input,omitReasoning:true})).rejects.toThrow('conflict');
    expect(await readdir(service.root)).toHaveLength(2);
    expect(await readFile(join(sourcePath,'journal.jsonl'))).toEqual(before);
    if (kind === 'work') {
      await service.remove('branch-once');
      await expect(service.customizationAction(input)).rejects.toMatchObject({code:'session_deleted'});
    }
    if (kind === 'extension') {
      await rm(development,{recursive:true});
      await expect(service.customizationAction({...input,commandId:'new-branch'})).rejects.toThrow();
      expect(await readdir(service.root)).toHaveLength(2);
    }
  } finally { await service.close(); }
});
