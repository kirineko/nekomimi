import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {McpConfig} from '../../src/customization/resources.js';
export async function reviewPackageFiles(mcp:McpConfig,docs=resolve('extension-docs')) {
 return {
  'nekomimi.json':JSON.stringify({manifestVersion:1,name:'review-kit',version:'1.0.0',sdkVersion:2,requiredCapabilities:['tools','commands','ui','model','panels','workflows','workspace-state','providers'],dependencies:{},files:['review-panel.ts'],resources:[{kind:'extension',name:'review',entry:'index.ts'},{kind:'provider',name:'review-provider',entry:'providers.ts'},{kind:'skill',name:'review-checklist',entry:'skills/SKILL.md'},{kind:'rule',name:'review-rules',entry:'rules/review.md',ruleScope:{root:'.',include:['**/*']}},{kind:'mcp',name:'review-context',entry:'mcp.json'}]}),
  'index.ts':await readFile(resolve(docs,'review-workflow.ts'),'utf8'),
  'providers.ts':await readFile(resolve(docs,'http-providers.ts'),'utf8'),
  'review-panel.ts':await readFile(resolve(docs,'review-panel.ts'),'utf8'),
  'skills/SKILL.md':'---\nname: review-checklist\ndescription: Review observed evidence\n---\nSKILL_REVIEW: explain only observed diff evidence.',
  'rules/review.md':'RULE_REVIEW: keep synthetic src changes scoped and report tests.',
  'mcp.json':JSON.stringify(mcp),
 };
}
