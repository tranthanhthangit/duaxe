import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalJWKSet,SignJWT,generateKeyPair} from 'jose';
import {randomUUID} from 'node:crypto';
import {mockSupabase} from './helpers/supabase';
import {SupabaseTeacherAuth} from '../server/cloud/TeacherAuth';
import {SupabaseAvatarObjects,MissingAvatarError} from '../server/cloud/AvatarObjects';
import {deploymentAccess,gatewayAllowed} from '../server/cloud/DeploymentGate';
import {onRequest} from '../functions/_middleware';
import type {SQL} from '../server/storage/postgres/Database';
import {gateway} from '../functions/gateway';

test('Supabase JWT verifies signature/issuer/audience/role and uses explicit enabled mapping',async()=>{
 const mock=await mockSupabase(),user=randomUUID(),teacher=randomUUID();let enabled=true,queries=0;
 const db={query:async(_sql:string,values:unknown[])=>{queries++;return {rows:enabled&&values[0]===user?[{teacher_id:teacher}]:[]};}} as SQL;
 try{
  const auth=new SupabaseTeacherAuth(db,mock.issuer,createLocalJWKSet(mock.keys)),token=await mock.token(user);
  assert.equal(await auth.authenticate('Bearer '+token),teacher);enabled=false;assert.equal(await auth.authenticate('Bearer '+token),null);enabled=true;
  assert.equal(await auth.authenticate('teacher_session=anything'),null);assert.equal(await auth.authenticate('Bearer '+token.slice(0,-3)+'bad'),null);
  assert.equal(await auth.authenticate('Bearer '+await mock.token(randomUUID())),null);
  assert.equal(await auth.authenticate('Bearer '+await mock.token(user,{role:'service_role'})),null);
  assert.equal(await auth.authenticate('Bearer '+await mock.token(user,{is_anonymous:true})),null);
  assert.equal(await auth.authenticate('Bearer '+await mock.token(user,{exp:Math.floor(Date.now()/1000)-60})),null);assert.equal(await auth.authenticate('Bearer '+await mock.token(user,{iss:'https://wrong.invalid/auth/v1'})),null);assert.equal(await auth.authenticate('Bearer '+await mock.token(user,{aud:'wrong'})),null);
  const keys=await generateKeyPair('ES256');const invalid=await new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:'synthetic-key'}).setSubject(user).setIssuer(mock.issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  assert.equal(await auth.authenticate('Bearer '+invalid),null);assert.ok(queries>=3);
  const remote=new SupabaseTeacherAuth(db,mock.issuer);assert.equal(await remote.authenticate('Bearer '+token),teacher);
 }finally{await mock.close();}
});

test('private object store refuses public bucket, anonymous reads, overwrite and unsafe keys',async()=>{
 const mock=await mockSupabase(),owner=randomUUID(),key=randomUUID()+'.webp',objects=new SupabaseAvatarObjects(mock.origin,mock.bucket,mock.secret);
 try{
  await objects.verifyPrivate();mock.setPublic(true);await assert.rejects(objects.verifyPrivate());mock.setPublic(false);
  await assert.rejects(objects.read(owner,key),MissingAvatarError);await objects.write(owner,key,Buffer.from('synthetic bytes'));
  assert.equal((await objects.read(owner,key)).toString(),'synthetic bytes');await assert.rejects(objects.write(owner,key,Buffer.from('replace')));
  const anonymous=await fetch(mock.origin+'/storage/v1/object/authenticated/'+mock.bucket+'/'+owner+'/'+key);assert.equal(anonymous.status,401);
  await assert.rejects(objects.read(owner,'../../photo.webp'));await objects.remove(owner,key);await assert.rejects(objects.read(owner,key),MissingAvatarError);
 }finally{await mock.close();}
});

test('production fails closed, backend key never grants access in closed mode',()=>{
 assert.throws(()=>deploymentAccess({NODE_ENV:'production'}));
 const base={NODE_ENV:'production',STORAGE_DRIVER:'postgres',TEACHER_AUTH_DRIVER:'supabase',AVATAR_STORAGE_DRIVER:'supabase',BACKEND_GATEWAY_KEY:'x'.repeat(43),CORS_ORIGINS:'https://school.pages.dev'};
 assert.equal(gatewayAllowed(deploymentAccess(base),{'x-deployment-key':base.BACKEND_GATEWAY_KEY}),false);
 assert.equal(gatewayAllowed(deploymentAccess({...base,NODE_ENV:'development'}),{'x-deployment-key':base.BACKEND_GATEWAY_KEY}),false);
 const gate=deploymentAccess({...base,PRODUCTION_ACCESS_MODE:'pilot'});assert.equal(gatewayAllowed(gate,{}),false);assert.equal(gatewayAllowed(gate,{'x-deployment-key':base.BACKEND_GATEWAY_KEY}),true);
});

test('Pages middleware defaults closed and pilot without Access proof denies static/API requests',async()=>{
 let calls=0;const next=async()=>{calls++;return new Response('private application');};
 for(const path of ['/','/api/classes','/socket.io/?EIO=4']){
  const request=new Request('https://school.pages.dev'+path);
  assert.equal((await onRequest({request,env:{},next})).status,503);
  assert.equal((await onRequest({request,env:{ACCESS_MODE:'pilot'},next})).status,403);
 }
 assert.equal(calls,0);
 const response=await onRequest({request:new Request('https://school.pages.dev/'),env:{ACCESS_MODE:'live',SUPABASE_PUBLIC_ORIGIN:'https://project.supabase.co'},next});
 assert.equal(response.status,200);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.ok(response.headers.get('Content-Security-Policy')?.includes('https://project.supabase.co'));
 const teacher=await onRequest({request:new Request('https://school.pages.dev/?mode=teacher'),env:{ACCESS_MODE:'live'},next});assert.ok(teacher.headers.get('Content-Security-Policy')?.includes('https://challenges.cloudflare.com'));
 const student=await onRequest({request:new Request('https://school.pages.dev/?mode=student'),env:{ACCESS_MODE:'live'},next});assert.equal(student.headers.get('Content-Security-Policy')?.includes('https://challenges.cloudflare.com'),false);
});

test('Pages gateway preserves Bearer/body, injects backend key and strips Access/cookie secrets',async()=>{
 const original=globalThis.fetch;let called=false;
 globalThis.fetch=async(input)=>{called=true;const request=input as Request;assert.equal(request.url,'https://backend.onrender.com/api/classes');assert.equal(request.headers.get('authorization'),'Bearer synthetic');assert.equal(request.headers.get('x-deployment-key'),'g'.repeat(43));assert.equal(request.headers.get('cookie'),null);assert.equal(request.headers.get('cf-access-client-secret'),null);assert.equal(await request.text(),'{"name":"Synthetic"}');return new Response('{}',{headers:{'set-cookie':'must-not-leak'}});};
 try{const response=await gateway({request:new Request('https://school.pages.dev/api/classes',{method:'POST',headers:{Authorization:'Bearer synthetic',Cookie:'private','CF-Access-Client-Secret':'access-secret','X-Deployment-Key':'attacker'},body:'{"name":"Synthetic"}'}),env:{BACKEND_URL:'https://backend.onrender.com',BACKEND_GATEWAY_KEY:'g'.repeat(43)},next:async()=>new Response()});assert.equal(called,true);assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('Cache-Control'),'no-store');}finally{globalThis.fetch=original;}
});
