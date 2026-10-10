import { expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CoreInstallation } from '../src/core/installation.js';
import { coreLaunchInfo, launchManagedCore } from '../src/core/managed.js';
import { coreTreeManifest } from '../src/core/manifest.js';
import { portClosed } from '../src/core/validation.js';
import type { CoreValidations } from '../src/core/validations.js';
import type { CoreBuilds } from '../src/core/builds.js';
import { temporary } from './helpers.js';

async function fixture() {
  const root = await temporary(), workspace = join(root,'workspace'), home = join(root,'data'), registry = join(root,'registry');
  await mkdir(workspace); await mkdir(home);
  const installation = await CoreInstallation.locate({entry:resolve('dist/cli.js'),registry});
  const artifact = {directory:resolve('.'),revision:'a'.repeat(64)};
  const builds = {candidates:{ownerWorkspace:workspace,home},inspect:vi.fn(async()=>({validForCurrent:true,result:{buildId:'build-one',candidateId:'candidate-one',artifact}}))} as unknown as CoreBuilds;
  const validations = {builds,inspect:vi.fn(async()=>({validForCurrent:true,result:{artifactRevision:artifact.revision,buildId:'build-one',candidateId:'candidate-one'}}))} as unknown as CoreValidations;
  return {root,registry,home,workspace,installation,builds,validations,input:{validationId:'validation-one',artifactRevision:artifact.revision,authorize:true}};
}
it('canonicalizes installation aliases and serializes all writers independently of workspace or data homes', async () => {
  const f=await fixture(), alias=join(f.root,'alias.js'); await symlink(resolve('dist/cli.js'),alias);
  const second=await CoreInstallation.locate({entry:alias,registry:f.registry});
  expect(second.identity).toEqual(f.installation.identity);
  expect(await f.installation.read()).toMatchObject({events:[]}); expect(await readdir(f.root)).not.toContain('registry');
  const writer=await f.installation.acquire();
  try { await expect(second.acquire()).rejects.toThrow('busy'); expect((await second.read()).events).toHaveLength(1); }
  finally { await writer.close(); }
  const next=await second.acquire(); await next.close();
});
it('returns explicit candidate argv for an unmanaged source entry without touching registry, PATH or installation files', async () => {
  const f=await fixture(), source=join(f.root,'cli.ts'); await writeFile(source,'// source');
  const installation=await CoreInstallation.locate({entry:source,registry:f.registry}), before=await coreTreeManifest(f.root), path=process.env.PATH;
  const info=await coreLaunchInfo(f.builds,'build-one',installation);
  expect(info).toMatchObject({currentMode:'unmanaged',switchSupported:false,managedLaunchSupported:false,applied:false,manual:{executable:process.execPath,args:[resolve('dist/cli.js'),'web','--workspace',expect.any(String),'--home',f.home,'--no-open']}});
  await expect(launchManagedCore(f.validations,f.input,{installation})).rejects.toThrow('cannot supervise');
  expect((await coreTreeManifest(f.root)).revision).toBe(before.revision); expect(process.env.PATH).toBe(path);
});
it('starts a real compiled Web child under the installation lease, reports actual identity and leaves no browser token in its Journal', async () => {
  const f=await fixture();
  const managed=await launchManagedCore(f.validations,f.input,{installation:f.installation});
  try {
    expect(managed.identity.build).toBe(JSON.parse(await readFile(resolve('dist/build-identity.json'),'utf8')).sha256);
    const response=await fetch(managed.origin); expect(response.status).toBe(200);
    await expect(launchManagedCore(f.validations,f.input,{installation:f.installation})).rejects.toThrow('busy');
    const events=(await f.installation.read()).events;
    expect(events.some(event=>event.type==='core.launch.selected')).toBe(true);
    const token=new URL(managed.url).hash.slice('#token='.length);
    expect(JSON.stringify(events)).not.toContain(token);
    expect(JSON.stringify(events)).not.toContain('#token=');
  } finally { expect(await managed.stop()).toMatchObject({cleanup:'confirmed',status:'cancelled'}); }
  expect(await portClosed(Number(new URL(managed.origin).port))).toBe(true);
  const next=await f.installation.acquire(); await next.close();
  expect((await f.installation.read()).events.at(-1)).toMatchObject({type:'core.launch.finished',payload:{cleanup:'confirmed'}});
},30000);
it('rejects missing authorization or stale validation before acquiring the installation writer',async()=>{
  const f=await fixture();
  await expect(launchManagedCore(f.validations,{...f.input,authorize:false},{installation:f.installation})).rejects.toThrow('authorization');
  await expect(launchManagedCore(f.validations,{...f.input,artifactRevision:'b'.repeat(64)},{installation:f.installation})).rejects.toThrow('confirmed');
  expect(await readdir(f.root)).not.toContain('registry');
});
it('does not start the service after losing its parent IPC during module loading',async()=>{
  const {spawn}=await import('node:child_process');
  const {pathToFileURL}=await import('node:url');
  const root=await temporary(), directory=join(root,'candidate'), marker=join(root,'unexpected-start');
  await mkdir(join(directory,'dist/customization'),{recursive:true}); await mkdir(join(directory,'dist/server')); await mkdir(join(directory,'dist/shared')); await writeFile(join(directory,'dist/shared/protocol.js'),'export class ApiError extends Error {}');
  await writeFile(join(directory,'package.json'),JSON.stringify({type:'module'}));
  await writeFile(join(directory,'dist/customization/sdk.js'),`export async function hostIdentity(){return {build:'fixture',requiresBuild:false};}`);
  await writeFile(join(directory,'dist/server/app.js'),`import {writeFile} from 'node:fs/promises';process.send({type:'importing'});await new Promise(resolve=>setTimeout(resolve,500));export async function startWeb(){await writeFile(${JSON.stringify(marker)},'unwanted');return {close:async()=>{}};}`);
  const code=`const {runManagedWorker}=await import(${JSON.stringify(pathToFileURL(resolve('dist/core/managed-worker.js')).href)});await runManagedWorker(${JSON.stringify({directory,workspace:root,home:join(root,'data'),port:0,expectedBuild:'fixture'})});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','ignore','pipe','ipc']});
  child.once('message',()=>child.disconnect());
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  try {
    const code=await new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
    expect(code).toBe(0); await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});
  } finally { clearTimeout(timer); }
},10000);
