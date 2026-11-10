import test from 'node:test';import assert from 'node:assert/strict';
import {SupabaseAvatarObjects} from '../server/cloud/AvatarObjects';
import {storageStartupMessage,StorageStartupError} from '../server/storage/startupError';
test('bucket diagnostics classify status without leaking response body or credentials',async()=>{
 const secret='synthetic-private-secret';
 for(const status of [400,401,403,404,429,503]){
  const store=new SupabaseAvatarObjects('https://example.test','student-avatars',secret,async()=>new Response(secret,{status}));
  await assert.rejects(store.verifyPrivate(),e=>{assert.ok(e instanceof StorageStartupError);const line=storageStartupMessage(e);assert.ok(line.includes(status===503?'HTTP_5XX':status===429?'HTTP_OTHER':'HTTP_'+status));assert.ok(!line.includes(secret));return true;});
 }
});
test('bucket verification distinguishes private, public, malformed metadata and network failure',async()=>{
 const store=(request:typeof fetch)=>new SupabaseAvatarObjects('https://example.test','student-avatars','synthetic-key',request);
 await store(async()=>Response.json({public:false})).verifyPrivate();
 for(const [request,stage] of [
  [async()=>Response.json({public:true}),'PRIVATE_BUCKET_PUBLIC'],
  [async()=>Response.json({}),'PRIVATE_BUCKET_RESPONSE'],
  [async()=>new Response('not json'),'PRIVATE_BUCKET_RESPONSE'],
  [async()=>{throw Error('secret connection details');},'PRIVATE_BUCKET_NETWORK'],
 ] as const)await assert.rejects(store(request).verifyPrivate(),e=>e instanceof StorageStartupError&&e.stage===stage);
});
