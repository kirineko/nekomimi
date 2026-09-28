import { normalizeColor } from '../shared/color.js';
/** This function is serialized into an opaque-origin iframe, without host state. */
function bootstrap(instanceId: string, nonce: string, props: unknown, actions: string[], normalizeColor: (value: unknown) => string) {
  let connected = false, port: MessagePort | undefined, sequence = 0;
  const pending = new Map<number, {resolve:(value:any)=>void; reject:(error:Error)=>void; timer: ReturnType<typeof setTimeout>}>();
  const fail = () => { port?.postMessage({kind:'crash',instanceId}); };
  window.addEventListener('error', fail); window.addEventListener('unhandledrejection', fail);
  window.addEventListener('message', event => {
    if (connected || event.source !== parent || event.data?.kind !== 'connect' || event.data?.nonce !== nonce || event.data?.instanceId !== instanceId || event.data?.version !== 1 || event.ports.length !== 1) return;
    connected = true; port = event.ports[0]!;
    const disposers: Array<()=>void>=[];window.addEventListener('pagehide',()=>{for(const dispose of disposers)dispose();port?.close();},{once:true});
    const observers = new Set<(theme: unknown)=>void>();
    port.onmessage = message => {
      const value = message.data;
      if(value?.instanceId!==instanceId)return;
      if(value.kind==='theme'){
        const typography=value.value?.typography;
        document.body.style.fontFamily=typography?.family??'system-ui';
        if(typeof typography?.size==='number'&&typography.size>=12&&typography.size<=24)document.body.style.fontSize=typography.size+'px';
        if(typeof typography?.weight==='number'&&typography.weight>=300&&typography.weight<=800)document.body.style.fontWeight=String(typography.weight);
        if(typeof typography?.lineHeight==='number'&&typography.lineHeight>=1.2&&typography.lineHeight<=2.2)document.body.style.lineHeight=String(typography.lineHeight);
        const font=value.value?.fontData;
        if(typeof font==='string'&&/^data:font\/woff2?;base64,[A-Za-z0-9+/=]+$/.test(font)) {
          let style=document.getElementById('panel-font');if(!style){style=document.createElement('style');style.id='panel-font';document.head.append(style);}
          style.textContent='@font-face{font-family:NekomimiTheme;src:url("'+font+'");font-display:swap}';document.body.style.fontFamily='NekomimiTheme,system-ui';
        } else document.getElementById('panel-font')?.remove();
        for(const [name,color] of Object.entries(value.value??{}))if(['background','foreground','accent','border'].includes(name)&&typeof color==='string') {try {document.documentElement.style.setProperty('--panel-'+name,normalizeColor(color));} catch { /* Ignore malformed frame messages. */ }};for(const observer of observers)observer(value.value);return;}
      if(value.kind!=='response')return;
      const item = pending.get(value.id); if (!item) return;
      pending.delete(value.id); clearTimeout(item.timer);
      value.error ? item.reject(new Error(value.error)) : item.resolve(value.result);
    };
    const request = (action: string, value: unknown = null) => new Promise((resolve,reject) => {
      if (!actions.includes(action) || pending.size >= 16 || JSON.stringify(value).length > 32768) {reject(new Error('Panel action/queue limit')); return;}
      const id = ++sequence, timer = setTimeout(()=>{pending.delete(id); reject(new Error('Panel request timeout'));},15000);
      pending.set(id,{resolve,reject,timer}); port!.postMessage({kind:'request',version:1,instanceId,id,action,value});
    });
    Promise.resolve().then(()=>{
      const module = (window as any).NekomimiPanel?.default;
      if (typeof module?.mount !== 'function') throw new Error('Panel must export default PanelModule');
      const resize = new ResizeObserver(()=>port!.postMessage({kind:'resize',instanceId,height:document.getElementById('panel-root')!.getBoundingClientRect().height+24}));
      resize.observe(document.getElementById('panel-root')!);disposers.push(()=>resize.disconnect());
      return Promise.resolve(module.mount(document.getElementById('panel-root'),{props,request,
        onThemeChange(handler: (theme:unknown)=>void){observers.add(handler);return()=>observers.delete(handler);},
        subscribe(handler:(state:unknown)=>void){let active=true;const tick=()=>request('state.subscribe').then(value=>{if(active)handler(value);}).catch(()=>{active=false;clearInterval(timer);});const timer=setInterval(tick,2000);void tick();const stop=()=>{active=false;clearInterval(timer);};disposers.push(stop);return stop;}
      })).then(cleanup=>{if(typeof cleanup==='function')disposers.push(cleanup);});
    }).catch(fail);
  });
  parent.postMessage({kind:'ready',version:1,instanceId,nonce},'*');
}
export function panelDocument(value: {instanceId:string; nonce:string; bundle:string; css:string; props:unknown; actions:string[]; theme?:Record<string,string>}) {
  const escaped = (input:unknown) => JSON.stringify(input).replace(/</g,'\\u003c');
  const theme = Object.entries(value.theme ?? {}).map(([name,color])=>`--panel-${name}:${normalizeColor(color)}`).join(';');
  const csp = `default-src 'none'; script-src 'nonce-${value.nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; navigate-to 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>:root{${theme}}body{margin:12px;background:var(--panel-background,#ffffff);color:var(--panel-foreground,#111111);font:14px system-ui}button,input,select{font:inherit}button{cursor:pointer}${value.css.replace(/</g,'\\3c ')}</style></head><body><div id="panel-root"></div><script nonce="${value.nonce}">${value.bundle.replace(/<\/script/gi,'<\\/script')}</script><script nonce="${value.nonce}">(${bootstrap.toString()})(${escaped(value.instanceId)},${escaped(value.nonce)},${escaped(value.props)},${escaped(value.actions)},${normalizeColor.toString()})</script></body></html>`;
}
