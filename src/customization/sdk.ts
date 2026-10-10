import {homedir} from 'node:os';
import {userHome} from '../storage/paths.js';
import { join, dirname } from 'node:path';
import { hash } from '../journal.js';
import { readFile, readdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { exists, safePath } from "./resources.js";
import { CAPABILITIES, SDK_VERSION } from "./types.js";
import { SDK_MODES, SDK_PROTOCOLS } from "./capabilities.js";
import { CONTRACT_VERSIONS } from "./contracts.js";
import { ApiError, type SessionTarget } from "../shared/protocol.js";
import { DATA_FORMAT_VERSION } from "../shared/versions.js";
export const developmentGuides = {
 "README.md":"Choose a development path", "cli.md":"Offline installed CLI development", "core-source.md":"Independent core source candidates", "tool-prompts.md":"Tool descriptions, parameters and prompt contributions",
 "extensions.md":"Commands, tools and hooks", "skills-rules-mcp.md":"Skills, scoped rules and MCP",
 "runtime-ui.md":"Fonts, colors, spacing, bubbles, motion, panels and runtime views",
 "platform.md":"Providers, workflows and versioned packages", "validation.md":"Static validation, trials and diagnostics",
 "customization-lifecycle.md":"Activation and evidence-based delivery", "scopes.md":"Project and user scope", "context.md":"Context and compaction",
} as const;
const entries = {
  public: "../extensions",
  legacy: "./types",
  contracts: "./sdk-contracts",
  ui: "./ui-contract",
  capabilities: "./capabilities",
} as const;
let identity: Promise<{version:string;build:string;contract:string;entry:string;node:string;requiresBuild:boolean}> | undefined;
export function hostIdentity() {
  return identity ??= (async () => {
    const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
    const root=fileURLToPath(new URL('../',import.meta.url));
    const manifest=join(root,'build-identity.json');
    let build: string;
    if(extension==='.js'&&await exists(manifest)) build=JSON.parse(await readFile(manifest,'utf8')).sha256;
    else {
      const inputs: string[]=[];
      const walk=async(directory:string):Promise<void>=>{for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(ts|tsx|js|css)$/.test(entry.name))inputs.push(path.slice(root.length),await readFile(path,'utf8'));}};
      await walk(root);build=hash(JSON.stringify(inputs));
    }
    const pkg=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
    return {version:pkg.version as string,build,contract:hash(JSON.stringify(CONTRACT_VERSIONS)),entry:fileURLToPath(new URL(`../cli${extension}`,import.meta.url)),node:process.execPath,requiresBuild:extension==='.ts'};
  })();
}
export async function sdkCatalog(entry?: string, workspace?: string, home?:string, target?: SessionTarget) {
  const identity=await hostIdentity();
  if (target && workspace) workspace = await realpath(workspace);
  if (target && (target.root !== workspace || !target.host || target.host.id !== hash(identity.entry) || target.host.build !== identity.build ||
      target.host.sdkVersion !== SDK_VERSION || target.host.dataFormatVersion !== DATA_FORMAT_VERSION))
    throw new ApiError(409, "host_changed", "开发资料与绑定的目标宿主不匹配，读取已阻止");
  const actualHome=userHome(home);
  const scopes={default:'project',supported:['project','user'],precedence:'project-over-user',candidateScope:'project',userWritesRequireAuthorization:true,executionAuthorization:'separate',paths:{project:workspace?{extensions:join(workspace,'.nekomimi/extensions'),skills:join(workspace,'.agents/skills'),rules:join(workspace,'AGENTS.md'),mcp:join(workspace,'.nekomimi/mcp.json')}:undefined,user:{extensions:join(actualHome,'extensions'),skills:actualHome===userHome()?join(homedir(),'.agents/skills'):join(actualHome,'skills'),rules:join(actualHome,'AGENTS.md'),mcp:join(actualHome,'mcp.json')}}};
  const catalog = {
    modes: SDK_MODES, protocols: SDK_PROTOCOLS,
    modePolicy: { default: "both", declarations: ["tools", "commands", "workflows"], creationTools: "create-only", enforcement: "before-dispatch" },
    capabilityPolicy: { supported: "availableCapabilities", required: "manifest.requiredCapabilities", granted: "explicit resource authorization", executable: "intersection of current grant, mode, resource revision and cancellation/budget gates" },
    scopes, target: target ? {id:target.id,kind:target.kind,root:target.root,host:target.host,scope:target.scope} : undefined, security: {controlledFiles:"Workspace path and symlink checks",shell:"Trusted process with host OS permissions; cwd is not an OS sandbox",extensions:"Trusted Node code; only host service calls are recorded",coreSource:"Installed SDK is not core source; a separate source candidate and trusted build authorization are required"}, host: {...identity,workspace,home:actualHome,cli:identity.requiresBuild?{requiresBuild:true,packageRoot:dirname(dirname(identity.entry)),hint:"源码宿主优先使用内置工具；构建后 CLI 属于新构建，需重新核对身份。"}:{command:identity.node,args:[identity.entry,...(workspace?["--workspace",workspace]:[]),"--home",actualHome]}}, templates:["command","theme","panel","view"], capabilityStatus:"supported_not_granted", versions: CONTRACT_VERSIONS, supportedSdkVersions: [SDK_VERSION], availableCapabilities: CAPABILITIES, entries: Object.keys(entries), guides: Object.entries(developmentGuides).map(([path,topic])=>({entry:`guide:${path}`,topic})) };
  if (!entry) return {...catalog, guidance:"使用 public 查询完整 SDK，ui 查询全局风格与视图。支持能力不等于资源获准能力；当前宿主状态见 customization_status；resource_list 仅为本轮固定快照。"};
  if(entry.startsWith("guide:")) {
    const path=entry.slice(6);
    const root=fileURLToPath(new URL('../../extension-docs/',import.meta.url));
    if(!/\.(md|ts|json|txt)$/.test(path))throw new Error("Unsupported guide file; choose a catalog entry");
    const actual=await safePath(root,path);
    if(!await exists(actual))throw new Error("Installed guide unavailable; omit entry to list SDK guides");
    const text=await readFile(actual,"utf8");
    return {...catalog,entry,text,hash:hash(text),source:`installed-guide:${path}`};
  }
  if (!Object.hasOwn(entries, entry)) throw new Error("Unknown SDK catalog entry; omit entry to list types and guides");
  const path = entries[entry as keyof typeof entries];
  const declaration = fileURLToPath(new URL(path + ".d.ts", import.meta.url));
  const source = fileURLToPath(new URL(path + ".ts", import.meta.url));
  const text=await readFile(await exists(declaration) ? declaration : source, "utf8");
  if(entry==='public') {
    const sections=await Promise.all((['legacy','contracts','ui','capabilities'] as const).map(async name=>{
      const base=entries[name],declaration=fileURLToPath(new URL(base+'.d.ts',import.meta.url)),source=fileURLToPath(new URL(base+'.ts',import.meta.url));
      return {entry:name,text:await readFile(await exists(declaration)?declaration:source,'utf8')};
    }));
    return {...catalog,entry,text,sections};
  }
  return { ...catalog, entry, text };
}
