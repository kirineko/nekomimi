/** Contracts for host tools only; remote and extension schemas are never rewritten. */
const contracts: Record<string,{snippet:string;fields:Record<string,string>;actions?:Record<string,string[]>}> = {
 resource_read:{snippet:'Read a skill or installed SDK resource',fields:{id:'Exact enabled resource ID from the catalog.',file:'Declared relative file required for extension/provider/workflow/panel resources; omit for skills, rules, docs and MCP.'}},
 resource_list:{snippet:'Discover resource IDs and pinned activation states',fields:{}},
 customization_sdk:{snippet:'Find installed SDK types and development guides',fields:{entry:'Omit for catalog; public, ui, contracts, legacy for types, or guide:<path> from the catalog for installed documentation.'}},
 customization_status:{snippet:'Check current delivery stages and missing permissions',fields:{resourceId:'Optional exact resource ID; omit for all discovered resources. This queries current state, not the pinned activation.'}},
 customization_validate:{snippet:'Statically check discovered extensions',fields:{}},
 customization_reload:{snippet:'Queue reload for after this run',fields:{}},
 customization_candidate:{snippet:'Develop and check an isolated project candidate',fields:{action:'create(name, optional template); list(); inspect(id); activate(id, contentHash); rollback(name); export(id, contentHash, output). Candidates are project-scoped.',name:'Candidate name for create or rollback; lowercase kebab-case.',template:'create only: command (default), theme, panel or view.',id:'Candidate ID returned by create/list; required for inspect, activate and export.',contentHash:'Exact checked content hash from inspect; required for activate/export.',output:'Workspace-relative output archive path for export.'},actions:{create:['name'],list:[],inspect:['id'],activate:['id','contentHash'],rollback:['name'],export:['id','contentHash','output']}},
 customization_package:{snippet:'Prepare and manage versioned capability packages',fields:{action:'prepare(source, optional bindings/scope); inspect(candidate id); activate(candidate id); list(); rollback(installed package id); export(installed package id, output); uninstall(installed package id).',scope:'project by default; user only for explicitly requested cross-project use and separately authorized user writes.',id:'Candidate ID for inspect/activate; installed package ID for rollback/export/uninstall.',source:'prepare only. local requires path; npm requires name, exact version, registry; git requires url and pinned commit.',bindings:'prepare only: rule names mapped to workspace target paths.',output:'Workspace-relative archive output path for export.'},actions:{prepare:['source'],inspect:['id'],activate:['id'],list:[],rollback:['id'],export:['id','output'],uninstall:['id']}},
 resource_write:{snippet:'Write a project or explicitly requested user resource',fields:{scope:'project by default. user requires explicit cross-project intent and user-directory write authorization; code execution authorization is separate.',kind:'Resource family: extension, skill, rule or mcp.',name:'Resource name in the selected scope.',file:'Resource-relative file path; cannot escape its resource root.',text:'Complete UTF-8 file content.',previousHash:'null only to create; for replacement supply the exact current content SHA-256, re-read on conflicts.'}},
 mcp_content:{snippet:'Read remote resources and prompts as data',fields:{action:'list(server); read(server, exactly one of uri/template, optional parameters); prompt(server, name, optional parameters); subscribe/unsubscribe(server, uri).',server:'Exact enabled MCP resource ID, not its display name.',uri:'Resource URI for read or subscription; mutually exclusive with template.',template:'Resource URI template for read; supply parameters for placeholders.',name:'Prompt name from list, required for prompt.',parameters:'String-valued template or prompt arguments; use the listed required fields.'},actions:{list:['server'],read:['server'],prompt:['server','name'],subscribe:['server','uri'],unsubscribe:['server','uri']}},
};
export function hostToolContract(name:string,parameters:object){
 const contract=contracts[name];if(!contract)return {parameters,snippet:''};
 const schema=JSON.parse(JSON.stringify(parameters));
 for(const [key,description] of Object.entries(contract.fields)) if(schema.properties?.[key])schema.properties[key].description=description;
 if(name==='customization_package' && schema.properties.source?.properties){
  const descriptions:Record<string,string>={kind:'local, npm or git; selects required source fields.',path:'Local source path inside the workspace.',name:'npm package name.',version:'Exact npm version; ranges are not accepted.',registry:'Explicit npm registry URL.',url:'Git source URL or allowed workspace path.',commit:'Pinned git commit, not a moving branch.'};
  for(const [key,description] of Object.entries(descriptions))schema.properties.source.properties[key].description=description;
 }
 return {parameters:schema,snippet:contract.snippet};
}
export function validateHostToolArgs(name:string,args:Record<string,unknown>){
 const contract=contracts[name];if(!contract)return;
 if(contract.actions){
  const action=String(args.action??'');
  if(!Object.hasOwn(contract.actions,action))throw new Error(`${name}: unknown action; choose ${Object.keys(contract.actions).join(', ')}`);
  for(const field of contract.actions[action]!)if(args[field]===undefined || args[field]===null || (typeof args[field]==='string' && !args[field].trim()))throw new Error(`${name}.${action}: missing ${field}; consult the action parameter contract`);
 }
 if(name==='mcp_content' && args.action==='read' && (!!args.uri===!!args.template))throw new Error('mcp_content.read: specify exactly one of uri or template');
 if(name==='mcp_content' && args.uri && args.template)throw new Error('mcp_content: uri and template are mutually exclusive');
 if(name==='customization_package' && args.action==='prepare'){
  const source=args.source as Record<string,unknown>;
  if(!source || typeof source!=='object' || Array.isArray(source))throw new Error('customization_package.prepare: source must be an object');
  const fields:Record<string,string[]>={local:['path'],npm:['name','version','registry'],git:['url','commit']};
  const required=fields[String(source.kind)];if(!required)throw new Error('customization_package.prepare: source.kind must be local, npm or git');
  for(const key of required)if(typeof source[key]!=='string'||!source[key].trim())throw new Error(`customization_package.prepare: source.${key} required for ${source.kind}`);
  for(const key of ['path','name','version','registry','url','commit'])if(source[key]!==undefined&&!required.includes(key))throw new Error(`customization_package.prepare: source.${key} conflicts with ${source.kind}`);
 }
}
