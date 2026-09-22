import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SDK_VERSION } from "nekomimi/extensions";
import { run, readSession } from "nekomimi";
import {
  CustomizationHost,
  validateExtension,
} from "./node_modules/nekomimi/dist/customization/host.js";
import { Candidates } from "./node_modules/nekomimi/dist/customization/candidates.js";
import { Packages } from "./node_modules/nekomimi/dist/customization/packages.js";
import { ProviderProfiles } from "./node_modules/nekomimi/dist/customization/provider-profiles.js";
import { randomUUID } from "node:crypto";
import { sdkCatalog } from "./node_modules/nekomimi/dist/customization/sdk.js";
import {oauthFixture} from './oauth-fixture.mjs';
import {reviewPackageFiles} from './review-package-fixture.mjs';
if (SDK_VERSION !== 1) throw new Error("Missing public SDK");
const workspace = resolve("custom-workspace");
const home = resolve("custom-home");
await mkdir(workspace);
await mkdir(home);
const root = resolve(workspace, ".nekomimi/extensions/check");
await mkdir(root, { recursive: true });
await writeFile(
  resolve(root, "extension.json"),
  JSON.stringify({
    name: "check",
    sdkVersion: 1,
    entry: "index.ts",
    requiredCapabilities: ["commands", "tools"],
  }),
);
await writeFile(
  resolve(root, "index.ts"),
  `import { SDK_VERSION } from 'nekomimi/extensions'; export default api => { api.registerCommand('check', {description:'Check installed SDK', async handler(_,ctx) { const list=await ctx.callTool('resource_list',{}); const doc=list.details.find(r=>r.kind==='doc'&&r.name==='README.md'); const result=await ctx.callTool('resource_read',{id:doc.id}); if(!result.content[0].text.includes('SDK 1')) throw Error('Missing installed docs'); return 'installed-sdk-'+SDK_VERSION; }}); };`,
);
await writeFile(
  resolve(workspace, "mcp.mjs"),
  `import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'pack',version:'1'}}:m.method==='tools/list'?{tools:[{name:'check',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:'pack-mcp'}]};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`,
);
await writeFile(
  resolve(workspace, ".nekomimi/mcp.json"),
  JSON.stringify({
    version: 1,
    servers: {
      pack: {
        transport: "stdio",
        command: process.execPath,
        args: ["mcp.mjs"],
      },
    },
  }),
);
let host = new CustomizationHost(workspace, home);
try {
  const resources = await host.catalog.discover();
  if (
    (await validateExtension(resources.find((r) => r.kind === "extension")))
      .length !== 0
  )
    throw Error("Invalid installed fixture");
  for (const r of resources.filter((r) =>
    ["extension", "mcp"].includes(r.kind),
  ))
    await host.catalog.decide(
      r.id,
      true,
      true,
      (await host.catalog.decisions()).revision,
    );
  const activation = await host.acquire();
  if (activation.mcp[0].tools[0].name !== "check")
    throw Error("Missing MCP tools");
  const result = await activation.mcp[0].call(
    "check",
    {},
    new AbortController().signal,
  );
  if (result.content[0].text !== "pack-mcp") throw Error("MCP call failed");
  await host.release();
  const used = await run({
    workspace,
    home,
    customization: host,
    session: resolve("custom-session"),
    apiKey: "unused",
    prompt: "/check",
    fetch: async () => {
      throw Error("Unexpected model call");
    },
  });
  if (used.status !== "completed" || used.text !== "installed-sdk-1")
    throw Error(used.error ?? "Command failed");
  if (
    !(await readSession(used.session)).events.some(
      (e) => e.type === "resources.activated",
    )
  )
    throw Error("Missing installed evidence");
  const sdk = await sdkCatalog("legacy");
  if (!sdk.text.includes("ExtensionContext")) throw Error("Missing installed signatures");
  const candidates = new Candidates(workspace);
  const draft = await candidates.scaffold("installed-review");
  const { candidate } = await candidates.inspect(draft.id);
  if (!candidate.report.passed) throw Error(JSON.stringify(candidate.report.diagnostics));
  const activated = await host.requestCandidate(draft.id, candidate.contentHash, true);
  await host.reload(activated);
  if (activated.status !== "activated") throw Error(activated.error);
  const candidateRun = await run({ workspace, home, customization: host, session: used.session, apiKey: "unused", prompt: "/installed-review", fetch: async () => { throw Error("Unexpected model call"); } });
  if (candidateRun.status !== "completed" || candidateRun.text !== "Ready") throw Error(candidateRun.error ?? "Installed candidate failed");
  const source=resolve(workspace,'installed-kit');await mkdir(source);
  const files=['durable-review.ts','panel-extension.ts','review-panel.ts','http-providers.ts'];
  for(const name of files)await writeFile(resolve(source,name),await readFile(resolve('node_modules/nekomimi/extension-docs',name),'utf8'));
  await writeFile(resolve(source,'index.ts'),`import type {ExtensionFactory2} from 'nekomimi/extensions';import workflow from './durable-review';import panel from './panel-extension';export default (async api=>{await workflow(api);await panel(api);api.registerCommand('installed-model',{description:'Installed custom model',async handler(_args,ctx){return ctx.model('Installed auxiliary request');}});}) satisfies ExtensionFactory2;`);
  await writeFile(resolve(source,'nekomimi.json'),JSON.stringify({manifestVersion:1,name:'installed-kit',version:'1.0.0',sdkVersion:2,requiredCapabilities:['commands','tools','ui','model','workflows','workspace-state','panels','providers'],dependencies:{},files,resources:[{kind:'extension',name:'installed-kit',entry:'index.ts'},{kind:'provider',name:'installed-provider',entry:'http-providers.ts'}]}));
  const packages=new Packages(workspace,home),pkg=await packages.prepare({kind:'local',path:source},'project');
  const checked=await packages.preview('project',pkg.id);if(!checked.passed)throw Error(JSON.stringify(checked.checks));
  const installed=await host.requestPackage(pkg.id,'project',true);await host.reload(installed);if(installed.status!=='activated')throw Error(installed.error);
  const panel=host.panels.catalog()[0];if(!panel)throw Error('Missing installed panel build');
  const preview=await host.panels.mount(panel.resourceId,panel.id,panel.revision,{items:['Installed bundle']},undefined,true);
  if(!(await host.panels.document(preview.instanceId)).html.includes('NekomimiPanel'))throw Error('Missing installed browser bundle');
  await writeFile(resolve(workspace,'review.txt'),'Installed durable evidence');
  const activation2=await host.acquire(),workflow=activation2.extensions.flatMap(e=>e.workflows).find(w=>w.id==='durable-review');
  const created=await host.workflows.create(workflow.resource.id,workflow.id,{target:'review.txt'},activation2);await host.release();
  const waiting=await host.workflows.advance(created.id);if(waiting.status!=='waiting')throw Error(waiting.error??'Installed workflow wait failed');
  const ready=await host.workflows.answer(waiting.id,waiting.wait.id,randomUUID(),{'decision':'通过'},waiting.revision);
  if((await host.workflows.advance(ready.id)).status!=='completed')throw Error('Installed workflow resume failed');
  const provider=host.active.extensions.flatMap(e=>e.providers).find(p=>p.id==='example-chat'),profiles=new ProviderProfiles(home);
  await profiles.save({id:'installed-model',providerId:provider.id,resourceId:provider.resource.id,model:'fixture-model',baseUrl:'https://fixture.invalid',paths:['/chat/completions']},0);await profiles.select('auxiliary','installed-model',1);
  const modelRun=await run({workspace,home,customization:host,session:resolve('installed-provider-session'),apiKey:'unused',prompt:'/installed-model',fetch:async()=>Response.json({choices:[{message:{role:'assistant',content:'Installed custom provider'},finish_reason:'stop'}]})});
  if(modelRun.text!=='Installed custom provider')throw Error(modelRun.error??'Installed Provider failed');
  const shared=await packages.export(pkg.packageId,'installed-kit.tgz');if(!shared.integrity.startsWith('sha512-'))throw Error('Missing share integrity');
  const removed=await host.removePackage(pkg.packageId);await host.reload(removed);if(removed.status!=='activated')throw Error(removed.error);
  const oauth=await oauthFixture(true);
  try{
    const reviewSource=resolve(workspace,'complete-review'),files=await reviewPackageFiles(oauth.resource.config,resolve('node_modules/nekomimi/extension-docs'));
    for(const [name,content] of Object.entries(files)){const target=resolve(reviewSource,name);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,content);}
    await mkdir(resolve(workspace,'src'),{recursive:true});await writeFile(resolve(workspace,'src/change.diff'),'diff --git a/src/a.ts b/src/a.ts\n-old\n+new\n');
    const review=await packages.prepare({kind:'local',path:reviewSource},'project',{'review-rules':'src'}),parts=await packages.resources(review),remote=parts.find(r=>r.kind==='mcp'),adapter=parts.find(r=>r.kind==='provider');
    const auth=await host.oauth.begin(remote);if(!(await fetch(auth.authorizationUrl)).ok)throw Error('Installed OAuth callback failed');
    const receipt=await host.requestPackage(review.id,'project',true);await host.reload(receipt);if(receipt.status!=='activated')throw Error(receipt.error);
    await profiles.save({id:'review-model',providerId:'example-chat',resourceId:adapter.id,model:'fixture-model',baseUrl:'https://fixture.invalid',paths:['/chat/completions']},(await profiles.list()).revision);await profiles.select('auxiliary','review-model',(await profiles.list()).revision);
    const requests=[];const reviewed=await run({workspace,home,customization:host,session:resolve('complete-review-session'),apiKey:'unused',prompt:'/review {"diffFile":"src/change.diff"}',fetch:async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({choices:[{message:{role:'assistant',content:'Installed complete review'},finish_reason:'stop'}]});}});
    if(reviewed.status!=='completed')throw Error(reviewed.error);const flow=(await host.workflows.list()).find(w=>w.definitionId==='review');if(flow?.status!=='waiting')throw Error(flow?.error??'Installed complete review did not wait');
    const request=JSON.stringify(requests.at(-1));for(const marker of ['SKILL_REVIEW','RULE_REVIEW','MCP_CONTEXT','MCP_PROMPT'])if(!request.includes(marker))throw Error('Missing installed context: '+marker);
    await host.close();host=new CustomizationHost(workspace,home);await host.acquire();await host.release();const panel=host.panels.catalog().find(p=>p.id==='review');const mounted=await host.panels.mount(panel.resourceId,panel.id,panel.revision,{items:['Installed complete review']},flow.id);await host.panels.action(mounted.instanceId,1,'workflow.answer',{decision:'approve'});if((await host.workflows.advance(flow.id)).status!=='completed')throw Error('Installed review restart/answer failed');
    if(!(await readFile(resolve(workspace,'review-result.json'),'utf8')).includes('approve'))throw Error('Installed review output missing');
  }finally{await oauth.close();}
  console.log(
    "Installed SDK 1/2, package, Provider, durable workflow, static panel and stdio MCP verified on " +
      process.version,
  );
} finally {
  await host.close();
}
