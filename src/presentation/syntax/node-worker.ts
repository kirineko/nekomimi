import { parentPort } from 'node:worker_threads';
import { loadLanguage, highlightLoaded } from './core.js';
parentPort!.on('message', async ({id,text,language})=>{
  try {
    await loadLanguage(language);
    parentPort!.postMessage({id,ready:true});
    parentPort!.postMessage({id,lines:highlightLoaded(text,language)});
  }catch {parentPort!.postMessage({id});}
});
