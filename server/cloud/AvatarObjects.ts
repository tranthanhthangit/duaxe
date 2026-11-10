import {StorageStartupError,bucketNetworkStage} from '../storage/startupError';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
export class MissingAvatarError extends Error {constructor(){super('Không tìm thấy ảnh riêng tư.');}}
export interface AvatarObjects {read(owner:string,key:string):Promise<Buffer>;write(owner:string,key:string,bytes:Buffer):Promise<void>;remove(owner:string,key:string):Promise<void>;}
export class LocalAvatarObjects implements AvatarObjects {
 constructor(private dir:string){}
 async read(_owner:string,key:string){return readFile(join(this.dir,key));}
 async write(_owner:string,key:string,bytes:Buffer){await mkdir(this.dir,{recursive:true,mode:0o700});const file=join(this.dir,key);await writeFile(file+'.part',bytes,{mode:0o600,flag:'wx'});await rename(file+'.part',file);}
 async remove(_owner:string,key:string){await unlink(join(this.dir,key)).catch(()=>{});}
}
/** No public or permanent signed URLs. Backend proxy enforces owner/room access. */
export class SupabaseAvatarObjects implements AvatarObjects {
 constructor(private origin:string,private bucket:string,private secret:string,private request:typeof fetch=fetch){}
 private async call(path:string,init:RequestInit={},diagnose=false){
  try{return await this.request(this.origin+'/storage/v1/'+path,{...init,headers:{apikey:this.secret,Authorization:'Bearer '+this.secret,...init.headers},signal:AbortSignal.timeout(8000),redirect:'error'});}catch(error){if(diagnose)throw new StorageStartupError(bucketNetworkStage(error));throw Error('Không thể truy cập kho ảnh riêng tư.');}
 }
 private path(owner:string,key:string){if(!/^[a-f0-9-]{36}$/i.test(owner)||!/^[-a-f0-9]+\.webp$/.test(key))throw Error('Đường dẫn ảnh không hợp lệ.');return this.bucket+'/'+owner+'/'+key;}
 async verifyPrivate(){
  if(!/^[\x21-\x7e]+$/.test(this.secret))throw new StorageStartupError('PRIVATE_BUCKET_KEY_FORMAT');
  const response=await this.call('bucket/'+this.bucket,{},true);
  if(!response.ok){
   await response.body?.cancel().catch(()=>{});
   const status=response.status;
   const stage=status===400?'PRIVATE_BUCKET_HTTP_400':status===401?'PRIVATE_BUCKET_HTTP_401':status===403?'PRIVATE_BUCKET_HTTP_403':status===404?'PRIVATE_BUCKET_HTTP_404':status>=500?'PRIVATE_BUCKET_HTTP_5XX':'PRIVATE_BUCKET_HTTP_OTHER';
   throw new StorageStartupError(stage);
  }
  let bucket;try{bucket=await response.json();}catch{throw new StorageStartupError('PRIVATE_BUCKET_RESPONSE');}
  if(bucket?.public===true)throw new StorageStartupError('PRIVATE_BUCKET_PUBLIC');
  if(bucket?.public!==false)throw new StorageStartupError('PRIVATE_BUCKET_RESPONSE');
 }
 async read(owner:string,key:string){const response=await this.call('object/authenticated/'+this.path(owner,key));if(response.status===404)throw new MissingAvatarError();if(!response.ok)throw Error('Không thể đọc ảnh riêng tư.');
  if(Number(response.headers.get('content-length')??0)>2*1024*1024)throw Error('Ảnh vượt giới hạn.');
  const reader=response.body?.getReader();if(!reader)throw Error('Kho ảnh trả dữ liệu lỗi.');const chunks:Uint8Array[]=[];let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>2*1024*1024)throw Error('Ảnh vượt giới hạn.');chunks.push(r.value);}}finally{await reader.cancel();}return Buffer.concat(chunks);
 }
 async write(owner:string,key:string,bytes:Buffer){const response=await this.call('object/'+this.path(owner,key),{method:'POST',headers:{'Content-Type':'image/webp','x-upsert':'false'},body:new Uint8Array(bytes)});if(!response.ok)throw Error('Không thể lưu ảnh riêng tư; không ghi đè ảnh cũ.');}
 async remove(owner:string,key:string){const response=await this.call('object/'+this.path(owner,key),{method:'DELETE'});if(!response.ok&&response.status!==404)throw Error('Không thể dọn ảnh riêng tư.');}
}
