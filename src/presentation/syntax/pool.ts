import { languageName, withinSyntaxBudget, type SyntaxLines } from './types.js';
export interface WorkerReply { id: number; ready?: boolean; lines?: SyntaxLines }
export interface SyntaxPort {
  postMessage(message: {id:number;text:string;language:string}): void;
  terminate(): void;
}
export type PortFactory = (message:(value:WorkerReply)=>void, error:()=>void)=>SyntaxPort;
interface Job { id:number; key:string; scope:string; text:string; language:string; finish:(lines?:SyntaxLines)=>void; signal?:AbortSignal; abort:()=>void }
/** One interruptible worker. Every failure is a plain-text result. */
export class SyntaxPool {
  private port?: SyntaxPort;
  private active?: Job;
  private queue: Job[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;
  private serial=0;
  private preparing=new Set<{scope:string;cancelled:boolean}>();
  private workerEpoch=0;
  private cache=new Map<string,{scope:string;lines:SyntaxLines;bytes:number}>();
  private bytes=0;
  constructor(private factory:PortFactory, private options={computeMs:1000,loadMs:10000,maxEntries:128,maxBytes:16*1024*1024,maxQueue:8}) {}
  async run(text:string, language:string, scope='', signal?:AbortSignal):Promise<SyntaxLines|undefined> {
    const name=languageName(language);
    if(!name || !withinSyntaxBudget(text) || signal?.aborted) return;
    const preparation={scope,cancelled:false};
    this.preparing.add(preparation);
    let hash:ArrayBuffer;
    try {hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));}
    catch {return;}
    finally {this.preparing.delete(preparation);}
    const key=JSON.stringify([scope,name,'4.4.3/github-light',Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')]);
    if(signal?.aborted || preparation.cancelled) return;
    const cached=this.cache.get(key);
    if(cached) {this.cache.delete(key);this.cache.set(key,cached);return cached.lines;}
    return new Promise(resolve=>{
      const id=++this.serial;
      const job:Job={id,key,scope,text,language:name,signal,finish:lines=>{signal?.removeEventListener('abort',job.abort);resolve(lines);},abort:()=>{
        if(this.active===job) this.fail();
        else {this.queue=this.queue.filter(j=>j!==job);job.finish();}
      }};
      signal?.addEventListener('abort',job.abort,{once:true});
      // New visible work displaces the oldest queued request; active work remains bounded.
      if(this.queue.length>=this.options.maxQueue) this.queue.shift()?.finish();
      this.queue.push(job);this.next();
    });
  }
  clearScope(scope:string) {
    for(const preparation of this.preparing) if(preparation.scope===scope) preparation.cancelled=true;
    for(const [key,value] of this.cache) if(value.scope===scope) {this.cache.delete(key);this.bytes-=value.bytes;}
    this.queue=this.queue.filter(j=>{if(j.scope!==scope)return true;j.finish();return false;});
    if(this.active?.scope===scope) this.fail();
  }
  dispose() {
    for(const preparation of this.preparing) preparation.cancelled=true;
    for(const job of this.queue)job.finish();this.queue=[];
    this.active?.finish();this.active=undefined;
    clearTimeout(this.timer);clearTimeout(this.idle);this.workerEpoch++;this.port?.terminate();this.port=undefined;
    this.cache.clear();this.bytes=0;
  }
  stats() {return {entries:this.cache.size,bytes:this.bytes,queued:this.queue.length,active:!!this.active};}
  private next() {
    if(this.active)return;
    clearTimeout(this.idle);
    const job=this.queue.shift();
    if(!job) {
      // Do not keep CLI exports or test processes alive after the last job.
      this.idle=setTimeout(()=>{this.port?.terminate();this.port=undefined;},1000);
      return;
    }
    this.active=job;
    try {
      if (!this.port) {
        const epoch=++this.workerEpoch;
        this.port=this.factory(value=>{if(epoch===this.workerEpoch)this.receive(value);},()=>{if(epoch===this.workerEpoch)this.fail();});
      }
      this.timer=setTimeout(()=>this.fail(),this.options.loadMs);
      this.port.postMessage({id:job.id,text:job.text,language:job.language});
    }catch {this.fail();}
  }
  private receive(value:WorkerReply) {
    const job=this.active;if(!job || value.id!==job.id)return;
    clearTimeout(this.timer);
    if(value.ready) {this.timer=setTimeout(()=>this.fail(),this.options.computeMs);return;}
    if(value.lines) {
      const bytes=new TextEncoder().encode(JSON.stringify(value.lines)).length;
      if(bytes<=this.options.maxBytes) {
        const previous=this.cache.get(job.key);if(previous)this.bytes-=previous.bytes;
        this.cache.delete(job.key);this.cache.set(job.key,{scope:job.scope,lines:value.lines,bytes});this.bytes+=bytes;
        while(this.cache.size>this.options.maxEntries || this.bytes>this.options.maxBytes) {
          const key=this.cache.keys().next().value!;this.bytes-=this.cache.get(key)!.bytes;this.cache.delete(key);
        }
      }
    }
    this.active=undefined;job.finish(value.lines);this.next();
  }
  private fail() {
    clearTimeout(this.timer);this.workerEpoch++;this.port?.terminate();this.port=undefined;
    const job=this.active;this.active=undefined;job?.finish();this.next();
  }
}
