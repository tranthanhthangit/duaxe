import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorage} from '../server/storage/factory';
import {StorageStartupError,storageStartupMessage} from '../server/storage/startupError';
test('startup messages contain only fixed codes and hints, never raw exception data',()=>{
 const secret='postgres://private-user:private-password@host/db';
 const e=new StorageStartupError('PRIVATE_BUCKET');e.message=secret;e.stack=secret;
 assert.match(storageStartupMessage(e),/STORAGE_INIT_PRIVATE_BUCKET/);
 for(const error of [e,new Error(secret),{message:secret,stage:secret},null])assert.equal(storageStartupMessage(error).includes(secret),false);
});
test('factory reports invalid driver and Turnstile config before any provider connection',async()=>{
 await assert.rejects(createStorage({NODE_ENV:'production',STORAGE_DRIVER:'invalid'}),e=>e instanceof StorageStartupError&&e.stage==='CONFIG');
 await assert.rejects(createStorage({NODE_ENV:'production',STORAGE_DRIVER:'postgres',TEACHER_AUTH_DRIVER:'supabase',AVATAR_STORAGE_DRIVER:'supabase',TEACHER_SELF_SIGNUP:'true',CORS_ORIGINS:'https://school.example.test',BACKEND_GATEWAY_KEY:'g'.repeat(43),PRODUCTION_ACCESS_MODE:'closed'}),e=>e instanceof StorageStartupError&&e.stage==='TURNSTILE_CONFIG');
});
