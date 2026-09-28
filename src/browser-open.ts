import { spawn } from 'node:child_process';
export function browserCommand(url:string,platform:NodeJS.Platform=process.platform):[string,string[]] {
  const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error('Invalid browser URL');
  if(platform==='darwin')return ['open',[url]];
  if(platform==='win32')return ['rundll32.exe',['url.dll,FileProtocolHandler',url]];
  return ['xdg-open',[url]];
}
/** Only the web CLI calls this after the listener is ready. No shell interpolation. */
export async function openBrowser(url:string,options:{platform?:NodeJS.Platform;spawn?:typeof spawn;timeoutMs?:number}={}):Promise<void> {
  const [command,args]=browserCommand(url,options.platform);
  await new Promise<void>((resolve,reject)=>{
    const child=(options.spawn??spawn)(command,args,{stdio:'ignore',shell:false});
    const timer=setTimeout(()=>{child.kill();reject(new Error('打开浏览器超时'));},options.timeoutMs??5000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`打开浏览器失败 (${code})`));});
  });
}
