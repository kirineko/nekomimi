import type {PanelModule} from 'nekomimi/extensions';
export default {mount(root,context){
 const props=context.props as {name?:string;mood?:string;lines?:string[]};
 const style=document.createElement('style');style.textContent=`.sakura{padding:20px;border:1px solid var(--panel-border,#e7ccdf);border-radius:20px;background:var(--panel-background,#fff7fc);color:var(--panel-foreground,#382d43)}h2{margin:0 0 8px;color:var(--panel-accent,#a04f90)}button{border:0;padding:10px 16px;border-radius:16px;background:#f4deef;color:#633a61}input{display:block;max-width:95%;margin:12px 0;padding:8px;border:1px solid #e7ccdf;border-radius:8px}`;
 const card=document.createElement('section');card.className='sakura';
 const heading=document.createElement('h2');heading.textContent=`ฅ ${props.name??'灵感便签'} ฅ`;card.append(heading);
 const mood=document.createElement('p');mood.textContent=props.mood??'记下今天的小灵感';card.append(mood);
 for(const line of props.lines??[]){const p=document.createElement('p');p.textContent=line;card.append(p);}
 const input=document.createElement('input');input.placeholder='写一句鼓励';input.setAttribute('aria-label','面板便签');card.append(input);
 const button=document.createElement('button');button.textContent='写入草稿';button.onclick=()=>{void context.request('draft.set',{text:input.value||'今天也要加油喵！'}).then(()=>{button.textContent='已提供草稿';}).catch(()=>{button.textContent='暂时无法写入，请重试';});};card.append(button);
 root.append(style,card);return()=>root.replaceChildren();
}} satisfies PanelModule;
