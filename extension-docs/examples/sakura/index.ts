import type {ExtensionFactory} from 'nekomimi/extensions';
export default ((api)=>{
 api.registerTheme({id:'sakura',title:'樱花手记',typography:{family:'Nekomimi Demo',font:'demo.woff',fallback:'sans-serif',size:15,weight:400,lineHeight:1.7},colors:{background:'#faf3fa',surface:'#fffafd',foreground:'#382d43',muted:'#74667f',accent:'#a04f90',border:'#e7ccdf',userBubble:'#f5dfee',assistantBubble:'#fffafd'},spacing:{scale:.85,messageGap:12,controlPadding:8},radii:{control:12,bubble:22,panel:18},shadows:{preset:'soft'},bubbles:{style:'tail',maxWidth:90},assets:{background:'sakura.png'},motion:{preset:'fade',duration:250,intensity:3},density:'compact'});
 api.registerPanel({id:'moe',title:'今日元气',uiVersion:1,entry:'panel.ts',slot:'result',propsSchema:{type:'object'},actions:['draft.set','state.subscribe'],fallback:'今日元气已保存，可查看名字、心情和要点。'});
 api.registerView({id:'inspiration',title:'灵感便签',uiVersion:1,entry:'panel.ts',slot:'composer-toolbar',propsSchema:{type:'object'},actions:['draft.set'],fallback:'把灵感写入草稿。'});
 api.registerCommand('moe',{description:'打开今日元气面板',async handler(args,ctx){const name=args.trim()||'小猫咪';await ctx.ui({kind:'panel',title:'今日元气',panelId:'moe',summary:`${name} · 今日份的元气已加载`,props:{name,mood:'kirakira ✧',lines:['今日份的元气已加载','遇到问题深呼吸，再继续']}});}});
}) satisfies ExtensionFactory;
