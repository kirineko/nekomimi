import { Worker } from 'node:worker_threads';
import { SyntaxPool } from './pool.js';
export const nodeSyntax = new SyntaxPool((message,error)=>{
  const worker=new Worker(new URL(import.meta.url.endsWith('.ts') ? '../../../dist/presentation/syntax/node-worker.js' : './node-worker.js',import.meta.url));
  worker.on('message',message);worker.on('error',error);
  return {postMessage:value=>worker.postMessage(value),terminate:()=>{void worker.terminate();}};
});
