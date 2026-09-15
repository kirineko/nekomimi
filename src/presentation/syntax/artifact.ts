import {readArtifact, type Artifact} from '../../journal.js';
import {nodeSyntax} from './node.js';
import {maxSyntaxBytes} from './types.js';
export async function artifactSyntax(directory:string,ref:Artifact|undefined,language:string|undefined) {
  if(!ref || ref.redacted || !language || ref.bytes>maxSyntaxBytes)return;
  try {
    const bytes=await readArtifact(directory,ref);
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    return await nodeSyntax.run(text,language,directory);
  }catch{return;}
}
