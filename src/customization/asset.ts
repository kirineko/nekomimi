import { extname } from 'node:path';
/** Validate the supported local asset formats before snapshotting or embedding. */
export function assetMime(name: string, bytes: Buffer): string {
 const ext=extname(name).toLowerCase();
 const mime=({'.woff':'font/woff','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'} as Record<string,string>)[ext];
 const valid=ext==='.woff'?bytes.subarray(0,4).toString()==='wOFF':ext==='.woff2'?bytes.subarray(0,4).toString()==='wOF2':ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!mime||!valid)throw new Error(`Asset MIME mismatch: ${name}`);
 return mime;
}
