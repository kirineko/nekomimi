import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root=fileURLToPath(new URL('../dist',import.meta.url)), digest=createHash('sha256');
async function walk(directory){
 for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=join(directory,entry.name);
  if(entry.isDirectory())await walk(path);
  else if(entry.name!=='build-identity.json'){digest.update(relative(root,path));digest.update('\0');digest.update(await readFile(path));digest.update('\0');}
 }
}
await walk(root);
await writeFile(join(root,'build-identity.json'),JSON.stringify({version:1,sha256:digest.digest('hex')}));
