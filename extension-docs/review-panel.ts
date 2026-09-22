import type { PanelModule, Json } from 'nekomimi/extensions';
export default {
  mount(root, context) {
    const props = context.props as {items?:string[]};
    const filter = document.createElement('input'); filter.placeholder='筛选审查项'; filter.setAttribute('aria-label','筛选审查项');
    const list=document.createElement('ul'), status=document.createElement('p');
    const render=()=>{list.replaceChildren(...(props.items??[]).filter(item=>item.includes(filter.value)).map(item=>{const li=document.createElement('li');li.textContent=item;return li;}));};
    filter.addEventListener('input',render);render();
    const decision=document.createElement('select');decision.setAttribute('aria-label','审查决定');for(const value of ['approve','reject']){const option=document.createElement('option');option.value=value;option.textContent=value;decision.append(option);}
    const button=document.createElement('button');button.textContent='确认审查';
    button.onclick=()=>{button.disabled=true;void context.request('workflow.answer',{decision:decision.value}).then((value:Json)=>{status.textContent=JSON.stringify(value);}).catch(async(error:unknown)=>{status.textContent=String(error);button.disabled=false;try{const current=await context.request('workflow.state');status.textContent+=' · '+JSON.stringify(current);}catch{}});};
    root.append(filter,list,decision,button,status);
  }
} satisfies PanelModule;
