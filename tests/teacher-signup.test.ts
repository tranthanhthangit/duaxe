import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createLocalJWKSet} from 'jose';
import {pgFixture,postgresEnabled} from './helpers/postgres';
import {mockSupabase} from './helpers/supabase';
import {migratePostgres} from '../server/storage/postgres/migrate';
import {TeacherSignup,SignupConflict} from '../server/cloud/TeacherSignup';
import {SupabaseTeacherAuth} from '../server/cloud/TeacherAuth';
import {authUserStatus} from '../server/cloud/AuthUserStatus';
import {createGameServer} from '../server/app';
import type {Storage} from '../server/storage/contracts';

test('confirmed self-signup is atomic/idempotent under concurrent retry and ignores metadata ownership',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,4);await migratePostgres(f.pool,4);const storage=await f.connect(),signup=new TeacherSignup(storage.db,mock.origin,mock.secret,async()=>{}),uid=randomUUID(),session=randomUUID();
  mock.adminUsers.set(uid,{id:uid,email:'new-teacher@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{full_name:'Cô Nguyễn Thị An',teacherId:randomUUID(),role:'admin'}});
  const actor={userId:uid,sessionId:session,issuedAt:Math.floor(Date.now()/1000)},ids=await Promise.all(Array.from({length:5},()=>signup.provision(actor,'synthetic-profile-token')));
  assert.ok(ids[0]);assert.ok(ids.every(id=>id===ids[0]));assert.notEqual(ids[0],uid);assert.notEqual(ids[0],mock.adminUsers.get(uid)!.user_metadata!.teacherId);
  assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'1');assert.equal((await f.pool.query('SELECT full_name FROM duaxe.teacher_profiles')).rows[0].full_name,'Cô Nguyễn Thị An');
  await storage.close();const restarted=await f.connect(),retry=new TeacherSignup(restarted.db,mock.origin,mock.secret,async()=>{});assert.equal(await retry.provision(actor,'synthetic-profile-token'),ids[0]);await restarted.close();
 }finally{await f.close();await mock.close();}
});

test('unconfirmed/disabled provider account and unsafe provider settings never create teacher privileges',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,4);const storage=await f.connect(),signup=new TeacherSignup(storage.db,mock.origin,mock.secret,async()=>{}),uid=randomUUID(),user={id:uid,email:'pending@example.test',email_confirmed_at:null as string|null,user_metadata:{full_name:'Cô Bình'},banned_until:''};mock.adminUsers.set(uid,user);
  const actor={userId:uid,sessionId:randomUUID(),issuedAt:Math.floor(Date.now()/1000)};
  assert.equal(await signup.provision(actor,'synthetic-profile-token'),null);user.email_confirmed_at=new Date().toISOString();user.banned_until='2999-01-01T00:00:00Z';assert.equal(await signup.provision(actor,'synthetic-profile-token'),null);user.banned_until='';
  mock.setAuthSettings({mailer_autoconfirm:true});await assert.rejects(signup.assertProviderConfig());await assert.rejects(signup.provision(actor,'synthetic-profile-token'));mock.setAuthSettings({mailer_autoconfirm:false,disable_signup:true});await assert.rejects(signup.provision(actor,'synthetic-profile-token'));
  assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'0');await storage.close();
 }finally{await f.close();await mock.close();}
});

test('signup cannot claim an old email or replace disabled/revoked mappings; old teacherId stays unchanged',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,4);const old=await f.seedTeacher(),storage=await f.connect(),signup=new TeacherSignup(storage.db,mock.origin,mock.secret,async()=>{}),uid=randomUUID(),sid=randomUUID();mock.adminUsers.set(uid,{id:uid,email:old.email.toUpperCase(),email_confirmed_at:new Date().toISOString(),user_metadata:{full_name:'Different name'}});
  const actor={userId:uid,sessionId:sid,issuedAt:Math.floor(Date.now()/1000)};await assert.rejects(signup.provision(actor,'synthetic-profile-token'),SignupConflict);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links')).rows[0].n,'0');
  await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[uid,old.id]);assert.equal(await signup.provision(actor,'synthetic-profile-token'),old.id);
  await f.pool.query('UPDATE duaxe.teacher_auth_links SET enabled=false WHERE auth_user_id=$1',[uid]);assert.equal(await signup.provision(actor,'synthetic-profile-token'),null);await f.pool.query('UPDATE duaxe.teacher_auth_links SET enabled=true WHERE auth_user_id=$1',[uid]);
  await f.pool.query('INSERT INTO duaxe.teacher_auth_revocations(session_id) VALUES($1)',[sid]);assert.equal(await signup.provision(actor,'synthetic-profile-token'),null);assert.equal((await f.pool.query('SELECT id FROM duaxe.teachers')).rows[0].id,old.id);await storage.close();
 }finally{await f.close();await mock.close();}
});

test('signup rollback and lost COMMIT response leave no partial or duplicate profile',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,4);const storage=await f.connect(),uid=randomUUID();mock.adminUsers.set(uid,{id:uid,email:'transaction@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{full_name:'Cô Chi'}});const actor={userId:uid,sessionId:randomUUID(),issuedAt:Math.floor(Date.now()/1000)},signup=new TeacherSignup(storage.db,mock.origin,mock.secret,async()=>{});
  await f.pool.query("CREATE FUNCTION reject_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure';END $$;CREATE TRIGGER reject_profile BEFORE INSERT ON duaxe.teacher_profiles FOR EACH ROW EXECUTE FUNCTION reject_profile()");await assert.rejects(signup.provision(actor,'synthetic-profile-token'));assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'0');await f.pool.query('DROP TRIGGER reject_profile ON duaxe.teacher_profiles');
  const ambiguous=new TeacherSignup({query:(s,v)=>storage.db.query(s,v),transaction:async fn=>{await storage.db.transaction(fn);throw Error('synthetic commit response loss');}},mock.origin,mock.secret,async()=>{});await assert.rejects(ambiguous.provision(actor,'synthetic-profile-token'));
  const id=await signup.provision(actor,'synthetic-profile-token');assert.ok(id);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'1');assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_profiles')).rows[0].n,'1');await storage.close();
 }finally{await f.close();await mock.close();}
});

test('profile enrollment API rejects forged/expired/student tokens and body IDs; rate limits retries',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();let server:ReturnType<typeof createGameServer>|undefined;try{
  await migratePostgres(f.pool,4);const storage=await f.connect(),signup=new TeacherSignup(storage.db,mock.origin,mock.secret,async()=>{}),adapter:Storage=storage;adapter.teachers=new SupabaseTeacherAuth(storage.db,mock.issuer,createLocalJWKSet(mock.keys),authUserStatus(mock.origin,mock.secret),true,(a,t)=>signup.provision(a,t));
  server=createGameServer({storage:adapter,origins:[],autoTick:false});await server.ready;server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const addr=server.http.address();assert.ok(addr&&typeof addr==='object');const url='http://127.0.0.1:'+addr.port+'/api/auth/profile',uid=randomUUID();mock.adminUsers.set(uid,{id:uid,email:'api-new@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{full_name:'Cô Duyên'}});const token=await mock.token(uid);
  const post=(t:string,body?:unknown)=>fetch(url,{method:'POST',headers:{Authorization:'Bearer '+t,'X-Classroom-Request':'1',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await post(randomUUID())).status,401);assert.equal((await post(token.slice(0,-5)+'forged')).status,401);assert.equal((await post(await mock.token(uid,{exp:Math.floor(Date.now()/1000)-60}))).status,401);assert.equal((await post(token,{teacherId:randomUUID(),ownerId:randomUUID()})).status,400);
  assert.equal((await post(token)).status,428);const first=await post(token,{captchaToken:'synthetic-profile-token'});assert.equal(first.status,200);const id=(await first.json()).id;assert.equal((await (await post(token)).json()).id,id);
  let limited=false;for(let i=0;i<21;i++){if((await post(token)).status===429){limited=true;break;}}assert.ok(limited);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'1');
 }finally{await server?.close();await f.close();await mock.close();}
});

test('signup schema denies untrusted profile reads and refuses old normalized email collisions atomically',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture();try{
  await migratePostgres(f.pool,3);const a=await f.seedTeacher(),b=await f.seedTeacher();await f.pool.query('UPDATE duaxe.teachers SET email=$1 WHERE id=$2',[a.email.toUpperCase(),b.id]);await assert.rejects(migratePostgres(f.pool,4));assert.equal((await f.pool.query('SELECT max(version) v FROM duaxe.schema_migrations')).rows[0].v,3);assert.equal((await f.pool.query("SELECT to_regclass('duaxe.teacher_profiles') t")).rows[0].t,null);
  await f.pool.query('UPDATE duaxe.teachers SET email=$1 WHERE id=$2',[b.email,b.id]);await migratePostgres(f.pool,4);await f.pool.query('INSERT INTO duaxe.teacher_profiles(teacher_id,full_name) VALUES($1,$2)',[a.id,'Cô An']);
  const client=await f.pool.connect();try{await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='signup_untrusted') THEN CREATE ROLE signup_untrusted NOLOGIN NOBYPASSRLS;END IF;END $$;GRANT USAGE ON SCHEMA duaxe TO signup_untrusted;GRANT SELECT ON duaxe.teacher_profiles TO signup_untrusted;SET ROLE signup_untrusted");assert.equal((await client.query('SELECT * FROM duaxe.teacher_profiles')).rowCount,0);}finally{await client.query('RESET ROLE');client.release();}
 }finally{await f.close();}
});
