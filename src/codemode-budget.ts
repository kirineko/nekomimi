/** Abort-aware admission. Waiting calls never occupy an executor slot. */
export class ScriptSlots {
 private active=0;
 private readonly waiting:Array<()=>void>=[];
 constructor(private readonly limit:number){}
 async enter(signal:AbortSignal):Promise<()=>void>{
  signal.throwIfAborted();
  if(this.active>=this.limit)await new Promise<void>((resolve,reject)=>{
   const ready=()=>{signal.removeEventListener('abort',abort);resolve();};
   const abort=()=>{const index=this.waiting.indexOf(ready);if(index>=0)this.waiting.splice(index,1);reject(signal.reason);};
   this.waiting.push(ready);signal.addEventListener('abort',abort,{once:true});
  });
  else this.active++;
  const release=()=>{const next=this.waiting.shift();if(next)next();else this.active--;};
  if(signal.aborted){release();signal.throwIfAborted();}
  let released=false;return ()=>{if(!released){released=true;release();}};
 }
}
