import {readArtifact,type Artifact} from '../journal.js';
import {ApiError} from '../shared/protocol.js';
import type {Entry} from './sessions.js';
/** Only saved raster attachments may be shown inline. No external URL or active document is loaded. */
export async function inspectionImage(entry:Entry,digest:string){
  let image:{mimeType:string;artifact:Artifact}|undefined;
  for(const event of entry.reader.events){
    if(!['model.operation.result','codemode.finished'].includes(event.type))continue;
    const payload=event.payload as {attachments?:Array<{mimeType:string;artifact:Artifact}>;images?:Array<{mimeType:string;artifact:Artifact}>};
    image=(payload.attachments??payload.images??[]).find(item=>item.artifact?.sha256===digest);if(image)break;
  }
  if(!image)throw new ApiError(404,'inspection_image','当前会话未记录此图片附件');
  if(image.artifact.bytes>16*1024*1024)throw new ApiError(413,'inspection_image','图片超过 16 MiB 预览上限，请分段读取原始附件');
  let bytes:Buffer;try{bytes=await readArtifact(entry.directory,image.artifact);}catch{throw new ApiError(422,'inspection_image','图片附件缺失或完整性检查失败');}
  const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))?'image/gif':bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP'?'image/webp':undefined;
  if(!mime||mime!==image.mimeType)throw new ApiError(415,'inspection_image','图片格式不支持或与保存的类型不匹配');
  return {bytes,mime};
}
