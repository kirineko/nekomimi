/** This function is serialized into an opaque-origin iframe, without host state. */
function bootstrap(instanceId: string, nonce: string, props: unknown, actions: string[]) {
  let connected = false, port: MessagePort | undefined, sequence = 0;
  const pending = new Map<number, {resolve:(value:any)=>void; reject:(error:Error)=>void; timer: ReturnType<typeof setTimeout>}>();
  const fail = () => { port?.postMessage({kind:'crash',instanceId}); };
  window.addEventListener('error', fail); window.addEventListener('unhandledrejection', fail);
  window.addEventListener('message', event => {
    if (connected || event.source !== parent || event.data?.kind !== 'connect' || event.data?.nonce !== nonce || event.data?.instanceId !== instanceId || event.data?.version !== 1 || event.ports.length !== 1) return;
    connected = true; port = event.ports[0]!;
    port.onmessage = message => {
      const value = message.data;
      if (value?.instanceId !== instanceId || value?.kind !== 'response') return;
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
      return module.mount(document.getElementById('panel-root'),{props,request});
    }).catch(fail);
  });
  parent.postMessage({kind:'ready',version:1,instanceId,nonce},'*');
}
export function panelDocument(value: {instanceId:string; nonce:string; bundle:string; css:string; props:unknown; actions:string[]; theme?:Record<string,string>}) {
  const escaped = (input:unknown) => JSON.stringify(input).replace(/</g,'\\u003c');
  const theme = Object.entries(value.theme ?? {}).map(([name,color])=>`--panel-${name}:${color}`).join(';');
  const csp = `default-src 'none'; script-src 'nonce-${value.nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; navigate-to 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>:root{${theme}}body{margin:12px;background:var(--panel-background,#ffffff);color:var(--panel-foreground,#111111);font:14px system-ui}button,input,select{font:inherit}button{cursor:pointer}${value.css.replace(/</g,'\\3c ')}</style></head><body><div id="panel-root"></div><script nonce="${value.nonce}">${value.bundle.replace(/<\/script/gi,'<\\/script')}</script><script nonce="${value.nonce}">(${bootstrap.toString()})(${escaped(value.instanceId)},${escaped(value.nonce)},${escaped(value.props)},${escaped(value.actions)})</script></body></html>`;
}
