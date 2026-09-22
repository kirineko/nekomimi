import type {ExtensionFactory2,Json,ToolResult} from 'nekomimi/extensions';
const json=(value:unknown):Json=>JSON.parse(JSON.stringify(value));
export default ((api)=>{
  api.registerTool({name:'diff',description:'读取合成 Git diff',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']},async execute(args,ctx){try{return await ctx.callTool('read',{path:String(args.path)});}catch(error){if(!String(error).includes('Rules were loaded or changed'))throw error;await ctx.model('Read the newly loaded scoped rules before reading the synthetic diff at '+String(args.path));return ctx.callTool('read',{path:String(args.path)});}}});
  api.registerPanel({id:'review',uiVersion:1,entry:'review-panel.ts',slot:'result',propsSchema:{type:'object',properties:{items:{type:'array',items:{type:'string'}}},required:['items'],additionalProperties:false},actions:['workflow.state','workflow.answer','workflow.cancel'],fallback:'审查报告保存在工作流 Journal。面板不可用时使用宿主表单确认。',theme:{background:'#ffffff',foreground:'#111111',accent:'#2255bb'}});
  api.registerWorkflow({id:'review',schemaVersion:1,inputSchema:{type:'object',properties:{diffFile:{type:'string'}},required:['diffFile'],additionalProperties:false},triggers:[{kind:'command',name:'review'}],entry:'analyze',steps:{
    analyze:{transitions:['finish'],async execute(input,ctx){
      const resources=(await ctx.callTool('resource_list',{})).details as Array<{id:string;kind:string;name:string}>;
      const skill=resources.find(r=>r.kind==='skill'&&r.name==='review-checklist'),mcp=resources.find(r=>r.kind==='mcp'&&r.name==='review-context');
      if(!skill||!mcp)throw new Error('Review package resources unavailable');
      await ctx.callTool('resource_read',{id:skill.id});
      const diff=await ctx.callTool('ext_review_diff',{path:String((input as {diffFile:string}).diffFile)});
      const content=await ctx.callTool('mcp_content',{action:'read',server:mcp.id,uri:'fixture:document'});
      const prompt=await ctx.callTool('mcp_content',{action:'prompt',server:mcp.id,name:'review',parameters:{target:'src'}});
      const report=await ctx.model(JSON.stringify({diff,content,prompt}));
      await ctx.ui({kind:'panel',title:'审查报告',panelId:'review',props:{items:[report]}});
      return {kind:'wait',step:'finish',input:{report},form:{kind:'form',title:'审查确认',text:report,fields:[{name:'decision',label:'审查决定',required:true,options:['approve','reject']}]}};
    }},
    finish:{transitions:[],async execute(input,ctx){
      const value=input as {input:{report:string};answer:{decision:string}};
      const old=await ctx.workspaceState.get('reviews',1);await ctx.workspaceState.set('reviews',1,old?.revision??0,Number(old?.value??0)+1);
      await ctx.callTool('write',{path:'review-result.json',content:JSON.stringify(value)});
      return {kind:'complete',output:json(value)};
    }}
  }});
}) satisfies ExtensionFactory2;
