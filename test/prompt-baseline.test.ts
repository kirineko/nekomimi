import {it, expect} from 'vitest';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {temporary, key} from './helpers.js';
import {Journal} from '../src/journal.js';
import {CoreTools} from '../src/tools.js';
import {assemblePrompt} from '../src/context.js';
import {estimateTokens} from '../src/context-meter.js';
import {CustomizationHost} from '../src/customization/host.js';
import {CustomRun} from '../src/customization/run.js';

it('captures comparable offline prompt scenarios',async()=>{
 const workspace=await temporary(),home=await temporary();
 await writeFile(join(workspace,'AGENTS.md'),'Preserve public API compatibility.');
 const host=new CustomizationHost(workspace,home),activation=await host.acquire();
 const journal=await Journal.open(join(workspace,'session'));
 try {
  const core=await CoreTools.create(workspace,journal,{});
  const custom=new CustomRun(host,activation,journal,'fixture',new AbortController().signal,{apiKey:key});
  await custom.initialize(core.definitions());
  const scenarios:Record<string,ReturnType<typeof assemblePrompt>>={
   coding:assemblePrompt(custom.definitions,custom.instructions),
   restricted:assemblePrompt(custom.definitions.filter(d=>d.tool.name==='read'),custom.instructions),
   customization:assemblePrompt(custom.definitions,[...custom.instructions,{source:'fixture:development',text:'Develop a project theme; verify activation before reporting success.'}]),
   mcp:assemblePrompt([...core.definitions(),{tool:{name:'mcp_fixture',label:'fixture',description:'Read remote records',parameters:{type:'object',properties:{}} as any,execute:async()=>({content:[],details:{}})},snippet:'',guidance:[],source:'mcp:fixture:v1'}]),
   rulesSkill:assemblePrompt(core.definitions(),[{source:'rule:fixture',text:'Only src/ follows these rules.'},{source:'skill:fixture',text:'Read changes and verify tests.'}]),
   compaction:assemblePrompt([],[],"compaction"),
   title:assemblePrompt([],[],"session-title"),
  };
  const normalize=(v:unknown)=>JSON.parse(JSON.stringify(v).replaceAll(workspace,'<workspace>').replaceAll(home,'<home>').replace(/resources:[a-f0-9]{64}/g,'resources:<revision>').replace(/rule:[^"\n]*AGENTS.md/g,'rule:<workspace>/AGENTS.md'));
  const inputs=Object.fromEntries(Object.entries(scenarios).map(([name,p])=>[name,normalize(p)]));
  const metrics=Object.fromEntries(Object.entries(inputs).map(([name,p])=>[name,{system:estimateTokens(p.text),schemas:estimateTokens(p.schemas),total:estimateTokens(p.text)+estimateTokens(p.schemas)}]));
  const path='test/fixtures/prompt-baseline.json';
  if(process.env.CAPTURE_PROMPT_BASELINE==='1'){
   await mkdir('test/fixtures',{recursive:true});
   await writeFile(path,JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),model:'deepseek-flash',measurement:'estimateTokens; offline; no model calls',inputs,metrics},null,2)+'\n');
  }
  const baseline=JSON.parse(await readFile(path,'utf8'));
  if(process.env.PROMPT_REPORT==='1'){
   await mkdir('docs/validation/prompt-contracts',{recursive:true});
   await writeFile('docs/validation/prompt-contracts/comparison.json',JSON.stringify({baselineRevision:baseline.revision,measurement:baseline.measurement,model:baseline.model,liveEvaluation:'not run',before:baseline.metrics,after:metrics,inputs},null,2)+'\n');
  }
  expect(Object.keys(baseline.inputs)).toEqual(Object.keys(inputs));
  expect(Object.values(metrics).every(m=>m.total>0)).toBe(true);
  expect(metrics.compaction!.total).toBeLessThan(baseline.metrics.compaction.total);
  expect(metrics.restricted!.total).toBeLessThan(baseline.metrics.restricted.total);
  for(const definition of custom.definitions)expect(scenarios.coding!.text).not.toContain(definition.tool.description);
  expect(scenarios.coding!.text).not.toContain('Project candidates are development drafts; publish cross-project');
 } finally {await journal.close();await host.release();await host.close();}
});
