import {expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {browserCommand,openBrowser} from '../src/browser-open.js';
const url='http://127.0.0.1:43127/#token=test-token';
it('opens the exact connection URL as an argument without shell expansion on all platforms',async()=>{
 for(const [platform,command,args] of [['darwin','open',[url]],['linux','xdg-open',[url]],['win32','rundll32.exe',['url.dll,FileProtocolHandler',url]]] as const){
  expect(browserCommand(url,platform)).toEqual([command,args]);let calls=0;
  await openBrowser(url,{platform,spawn:((file:any,argv:any,options:any)=>{calls++;expect([file,argv]).toEqual([command,args]);expect(options.shell).toBe(false);const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child;}) as any});expect(calls).toBe(1);
 }
});
it('rejects opener errors and bounds hangs without throwing an uncaught child error',async()=>{
 await expect(openBrowser(url,{spawn:(()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('missing opener')));return child;}) as any})).rejects.toThrow('missing');
 let killed=false;await expect(openBrowser(url,{timeoutMs:5,spawn:(()=>Object.assign(new EventEmitter(),{kill:()=>{killed=true;}})) as any})).rejects.toThrow('超时');expect(killed).toBe(true);
 expect(()=>browserCommand('file:///private')).toThrow('URL');
});
