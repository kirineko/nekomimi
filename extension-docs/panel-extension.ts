import type { ExtensionFactory2 } from 'nekomimi/extensions';
export default ((api)=>{
  api.registerPanel({id:'review-panel',uiVersion:1,entry:'review-panel.ts',slot:'result',propsSchema:{type:'object',properties:{items:{type:'array',items:{type:'string'}}},required:['items'],additionalProperties:false},actions:['workflow.state','workflow.answer','workflow.cancel'],fallback:'审查结果；面板不可用时请查看结构化数据，在工作流表单中确认。',theme:{background:'#ffffff',foreground:'#111111',accent:'#2255bb'},themes:{dark:{background:'#111111',foreground:'#ffffff',accent:'#88aaff'}}});
  api.registerCommand('review-panel',{description:'展示审查面板',async handler(_args,ctx){await ctx.ui({kind:'panel',title:'审查结果',panelId:'review-panel',props:{items:['检查变更','检查测试']}});return '审查面板已记录';}});
}) satisfies ExtensionFactory2;
