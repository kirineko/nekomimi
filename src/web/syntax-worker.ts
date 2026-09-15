import { loadLanguage, highlightLoaded } from '../presentation/syntax/core';
self.onmessage=async ({data:{id,text,language}})=>{
  try {
    await loadLanguage(language);
    self.postMessage({id,ready:true});
    self.postMessage({id,lines:highlightLoaded(text,language)});
  }catch {self.postMessage({id});}
};
