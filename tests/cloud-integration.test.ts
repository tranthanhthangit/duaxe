import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import sharp from 'sharp';
import {io,type Socket} from 'socket.io-client';
import {pgFixture,postgresEnabled} from './helpers/postgres';
import {mockSupabase} from './helpers/supabase';
import {migratePostgres} from '../server/storage/postgres/migrate';
import {PostgresStorage} from '../server/storage/PostgresStorage';
import {SupabaseTeacherAuth} from '../server/cloud/TeacherAuth';
import {authUserStatus} from '../server/cloud/AuthUserStatus';
import {SupabaseAvatarObjects} from '../server/cloud/AvatarObjects';
import {RoomInvites} from '../server/cloud/RoomInvites';
import {createGameServer} from '../server/app';
import {defaultSet} from '../src/questions/model';
import type {Storage} from '../server/storage/contracts';
import type {Credential,Reply,Frame} from '../shared/protocol';

test('cloud path:20 JWT/invite/private-avatar players, tenant checks, durable replay and reconnect', {skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase(),clients:Socket[]=[];let storage:PostgresStorage|undefined,server:ReturnType<typeof createGameServer>|undefined;
 const jwtUser=randomUUID(),otherUser=randomUUID(),gatewayKey='g'.repeat(43);
 async function connectStorage(){
  storage=await PostgresStorage.connect(f.config,'',new SupabaseAvatarObjects(mock.origin,mock.bucket,mock.secret));
  const adapter:Storage=storage;adapter.teachers=new SupabaseTeacherAuth(storage.db,mock.issuer,undefined,authUserStatus(mock.origin,mock.secret),true);adapter.invites=new RoomInvites(storage.db);return adapter;
 }
 async function listen(adapter:Storage){server=createGameServer({origins:[],storage:adapter,autoTick:false,deployment:{mode:'pilot',key:gatewayKey}});await server.ready;server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const a=server.http.address();assert.ok(a&&typeof a==='object');return 'http://127.0.0.1:'+a.port;}
 const ask=<T,>(socket:Socket,request:unknown)=>new Promise<Reply<T>>((r,j)=>socket.timeout(10000).emit('request',request,(e:Error|null,v:Reply<T>)=>e?j(e):r(v)));
 const ok=async<T,>(socket:Socket,request:unknown)=>{const r=await ask<T>(socket,request);assert.ok(r.ok,r.ok?'':r.error);return r.data;};
 let url='';const connect=async(auth:Record<string,string>={})=>{const s=io(url,{autoConnect:false,transports:['websocket'],reconnection:false,auth,extraHeaders:{'X-Deployment-Key':gatewayKey}});clients.push(s);await new Promise<void>((r,j)=>{s.once('connect',r);s.once('connect_error',j);s.connect();});return s;};
 try{
  await migratePostgres(f.pool,3);await migratePostgres(f.pool,3);
  const teacher=await f.seedTeacher(),other=await f.seedTeacher();await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2),($3,$4)',[jwtUser,teacher.id,otherUser,other.id]);
  const adapter=await connectStorage(),classId=await storage!.classrooms.saveClass(teacher.id,{name:'Synthetic cloud class'});
  await storage!.classrooms.importStudents(teacher.id,classId,Array.from({length:20},(_,i)=>({fullName:'Synthetic '+i,displayName:'Synthetic '+i})));
  const students=await storage!.classrooms.students(teacher.id,classId),image=await sharp({create:{width:128,height:128,channels:3,background:'pink'}}).png().toBuffer();
  for(const student of students)await storage!.avatars.upload(teacher.id,student.id,image);
  assert.equal(mock.objects.size,20);url=await listen(adapter);
  assert.equal((await fetch(url+'/api/classes')).status,503);assert.equal((await fetch(url+'/health')).status,200);
  const token=await mock.token(jwtUser),otherToken=await mock.token(otherUser),headers={Authorization:'Bearer '+token,'X-Deployment-Key':gatewayKey,'X-Classroom-Request':'1'};
  assert.equal((await fetch(url+'/api/classes',{headers})).status,200);
  const avatarEndpoint=url+'/api/students/'+students[0].id+'/avatar';
  assert.equal((await fetch(avatarEndpoint,{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:image})).status,400);
  assert.equal((await fetch(avatarEndpoint,{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:'not an image'})).status,400);
  assert.equal((await fetch(avatarEndpoint,{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:Buffer.alloc(2*1024*1024+1)})).status,400);assert.equal(mock.objects.size,20);
  const unauthorized={...headers,Authorization:'Bearer '+await mock.token(jwtUser,{exp:Math.floor(Date.now()/1000)-60})};assert.equal((await fetch(url+'/api/me',{headers:unauthorized})).status,401);
  assert.equal((await fetch(url+'/api/classes/'+classId+'/students',{headers:{...headers,Authorization:'Bearer '+otherToken}})).status,400);
  assert.equal((await fetch(url+'/api/classes/'+classId,{method:'PATCH',headers:{...headers,'Content-Type':'application/json',Authorization:'Bearer '+otherToken},body:JSON.stringify({name:'Unauthorized'})})).status,400);
  assert.equal((await fetch(url+'/api/avatars/'+(await storage!.classrooms.student(teacher.id,students[0].id)).avatarId,{headers:{...headers,Authorization:'Bearer '+otherToken}})).status,400);
  const imageResponse=await fetch(url+'/api/avatars/'+(await storage!.classrooms.student(teacher.id,students[0].id)).avatarId,{headers});assert.equal(imageResponse.status,200);assert.equal((await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata()).width,128);
  const anonymous=await connect();assert.equal((await ask(anonymous,{type:'create',set:defaultSet})).ok,false);
  const owner=await connect({teacherToken:token}),credential=await ok<Credential>(owner,{type:'create',set:defaultSet,classId,studentIds:students.map(s=>s.id)});
  assert.equal((await fetch(url+'/api/history/'+credential.code,{headers:{...headers,Authorization:'Bearer '+otherToken}})).status,400);
  const expiredOwner=await connect({teacherToken:await mock.token(jwtUser,{exp:Math.floor(Date.now()/1000)-60})});assert.equal((await ask(expiredOwner,{type:'resume',credential})).ok,false);
  const invite=await adapter.invites!.issue(teacher.id,credential.code);assert.ok(!JSON.stringify((await f.pool.query('SELECT token_hash FROM duaxe.room_invites')).rows).includes(invite.token));
  const preview=await ok<{avatarData?:string}[]>(anonymous,{type:'preview',code:credential.code});assert.equal(preview.length,20);assert.ok(preview.every(p=>!p.avatarData));
  const authorized=await connect({invite:invite.token});assert.ok((await ok<{avatarData?:string}[]>(authorized,{type:'preview',code:credential.code})).every(p=>p.avatarData));
  const wrong=await connect({invite:'x'.repeat(43)});assert.equal((await ask(wrong,{type:'preview',code:credential.code})).ok,false);
  const sockets=await Promise.all(students.map(()=>connect({invite:invite.token}))),credentials:Credential[]=[];
  await Promise.all(sockets.map(async(s,i)=>{const avatars=new Promise<unknown[]>(r=>s.once('avatars',r));credentials[i]=await ok<Credential>(s,{type:'claim',code:credential.code,studentId:students[i].id,color:i});assert.equal((await avatars).length,1);}));
  const impostor=await connect({teacherToken:otherToken});assert.equal((await ask(impostor,{type:'resume',credential})).ok,false);
  assert.equal((await ask(sockets[0],{type:'control',action:'start'})).ok,false);await ok(owner,{type:'control',action:'start'});
  const answer={type:'answer',questionId:'sun',optionId:'morning',commandId:'cloud-answer-001'};await Promise.all(sockets.map(s=>ok(s,answer)));await Promise.all(sockets.map(s=>ok(s,answer)));
  assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.race_answers')).rows[0].n,'20');
  await server!.close();await storage!.close();url=await listen(await connectStorage());
  const teacherSocket=await connect({teacherToken:token});await ok(teacherSocket,{type:'resume',credential});
  await Promise.all(credentials.map(async(c)=>{const s=await connect(),frame=new Promise<Frame>(r=>s.once('frame',r));await ok(s,{type:'resume',credential:c});const resumed=await frame;assert.equal(resumed.room.status,'paused');assert.equal(resumed.room.players.find(p=>p.id===c.playerId)!.points,10);await ok(s,answer);}));
  const room=server!.rooms.get(credential.code)!;assert.equal(room.players.size,20);assert.ok(room.profiles.every(p=>p.avatarData&&p.avatarId));assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.race_answers')).rows[0].n,'20');
  assert.equal((await fetch(url+'/api/me',{headers:{...headers,Authorization:'Bearer '+credentials[0].token}})).status,401);
  mock.adminUsers.get(jwtUser)!.banned_until='2999-01-01T00:00:00Z';assert.equal((await ask(teacherSocket,{type:'control',action:'resume'})).ok,false);delete mock.adminUsers.get(jwtUser)!.banned_until;
  await storage!.teachers.logout('Bearer '+token);assert.equal(await storage!.teachers.authenticate('Bearer '+token),null);
  await f.pool.query('UPDATE duaxe.teacher_auth_links SET enabled=false WHERE auth_user_id=$1',[jwtUser]);assert.equal((await ask(teacherSocket,{type:'control',action:'resume'})).ok,false);
 }finally{clients.forEach(s=>s.disconnect());await server?.close();await storage?.close();await f.close();await mock.close();}
});

test('schema002 Auth links and invites default-deny untrusted SQL roles',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture();try{
  await migratePostgres(f.pool,3);const teacher=await f.seedTeacher();await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[randomUUID(),teacher.id]);
  await f.pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='duaxe_cloud_untrusted') THEN CREATE ROLE duaxe_cloud_untrusted NOLOGIN NOBYPASSRLS;END IF;END $$;GRANT USAGE ON SCHEMA duaxe TO duaxe_cloud_untrusted;GRANT SELECT ON duaxe.teacher_auth_links,duaxe.room_invites TO duaxe_cloud_untrusted");
  const client=await f.pool.connect();try{await client.query('SET ROLE duaxe_cloud_untrusted');assert.equal((await client.query('SELECT * FROM duaxe.teacher_auth_links')).rowCount,0);assert.equal((await client.query('SELECT * FROM duaxe.room_invites')).rowCount,0);}finally{await client.query('RESET ROLE');client.release();}
 }finally{await f.close();}
});

test('Supabase Storage restrictive policy blocks browser roles even alongside a permissive policy',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture();try{
  await f.pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOBYPASSRLS;END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;END IF;END $$;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;CREATE POLICY preexisting_permissive ON storage.objects TO anon,authenticated USING(true) WITH CHECK(true);INSERT INTO storage.objects VALUES('student-avatars','private.webp'),('other-bucket','unrelated.webp')");
  const {readFile}=await import('node:fs/promises');await f.pool.query(await readFile('ops/supabase-private-storage.sql','utf8'));
  const c=await f.pool.connect();try{for(const role of ['anon','authenticated']){await c.query('SET ROLE '+role);assert.deepEqual((await c.query('SELECT name FROM storage.objects')).rows,[{name:'unrelated.webp'}]);await assert.rejects(c.query("INSERT INTO storage.objects VALUES('student-avatars','blocked.webp')"),{code:'42501'});await c.query('RESET ROLE');}}finally{await c.query('RESET ROLE');c.release();}
 }finally{await f.close();}
});

test('schema002 import rollback refuses newer Auth mappings and keeps source copy unchanged',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture();try{
  const {ClassroomStore}=await import('../server/classroom/Store'),{readSQLiteCopy,importBundle,rollbackBatch}=await import('../server/storage/postgres/importer'),{join}=await import('node:path'),{readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  await migratePostgres(f.pool,3);const source=new ClassroomStore(join(f.dir,'source.sqlite'),join(f.dir,'source-avatars')),owner=source.createTeacher('synthetic@example.test','synthetic-test-password'),copy=join(f.dir,'copy.sqlite');source.db.prepare('VACUUM INTO ?').run(copy);source.close();
  const hash=async()=>createHash('sha256').update(await readFile(copy)).digest('hex'),before=await hash(),batch=randomUUID();await importBundle(f.pool,readSQLiteCopy(copy,true),{batchId:batch,expectedDatabase:f.name,apply:true});
  await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[randomUUID(),owner]);await assert.rejects(rollbackBatch(f.pool,batch,f.name));assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'1');assert.equal(await hash(),before);
 }finally{await f.close();}
});
