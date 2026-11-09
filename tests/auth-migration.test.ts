import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pgFixture,postgresEnabled} from './helpers/postgres';
import {mockSupabase} from './helpers/supabase';
import {migratePostgres} from '../server/storage/postgres/migrate';
import {migrateTeachers,migrationManifest,auditTeachers,type AuthAdmin} from '../server/cloud/TeacherMigration';
import {SupabaseAuthAdmin} from '../server/cloud/AuthAdmin';
import {SupabaseTeacherAuth} from '../server/cloud/TeacherAuth';
import {authUserStatus} from '../server/cloud/AuthUserStatus';
import {createLocalJWKSet} from 'jose';
import {Room} from '../server/Room';
import {defaultSet} from '../src/questions/model';

test('Auth manifest requires unique teacher IDs and explicit ownership review for existing users',()=>{
 const teacherId=randomUUID();assert.equal(migrationManifest.safeParse([{teacherId},{teacherId}]).success,false);
 assert.equal(migrationManifest.safeParse([{teacherId,existingAuthUserId:randomUUID()}]).success,false);
 assert.equal(migrationManifest.safeParse([{teacherId,existingAuthUserId:randomUUID(),ownershipVerified:true}]).success,true);
});

test('Auth migration dry-run, ambiguous create, retry, verified finalize and nondestructive rollback',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,3);await migratePostgres(f.pool,3);
  const teacher=await f.seedTeacher(),storage=await f.connect(),classId=await storage.classrooms.saveClass(teacher.id,{name:'Preserve this class'}),studentId=await storage.classrooms.saveStudent(teacher.id,{classId,fullName:'Synthetic child',displayName:'Child',status:'active'});
  const room=new Room('ABC234',defaultSet,'synthetic-room-secret','synthetic-socket');room.ownerId=teacher.id;room.classId=classId;room.sequence++;
  await storage.rooms.save({checkpoint:room.checkpoint(),report:room.report()});const historyBefore=(await f.pool.query('SELECT checkpoint,report FROM duaxe.race_sessions')).rows;await storage.close();
  const before=(await f.pool.query('SELECT * FROM duaxe.teachers')).rows,manifest=[{teacherId:teacher.id}],batchId=randomUUID(),admin=new SupabaseAuthAdmin(mock.origin,mock.secret);
  const dry=await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'prepare'});assert.equal(dry.success,1);assert.equal(mock.creates(),0);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.auth_migration_batches')).rows[0].n,'0');
  // Simulate a lost response AFTER Auth persisted the new account, before SQL knows its UUID.
  const ambiguous:AuthAdmin={list:()=>admin.list(),get:id=>admin.get(id),invite:(email,url)=>admin.invite(email,url),create:async(email,metadata)=>{await admin.create(email,metadata);throw Error('lost response');}};
  assert.equal((await migrateTeachers(f.pool,ambiguous,manifest,{batchId,phase:'prepare',apply:true})).failed,1);assert.equal(mock.creates(),1);
  assert.equal((await f.pool.query('SELECT auth_user_id FROM duaxe.auth_migration_items')).rows[0].auth_user_id,null);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'prepare',apply:true})).failed,0);assert.equal(mock.creates(),1);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'prepare',apply:true})).skipped,1);
  const item=(await f.pool.query('SELECT * FROM duaxe.auth_migration_items')).rows[0];assert.equal(item.teacher_id,teacher.id);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'finalize',apply:true})).failed,1);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links')).rows[0].n,'0');
  const invite={batchId,phase:'invite' as const,apply:true,redirectUrl:'https://school.pages.dev/?mode=teacher&auth=recovery&fresh=1'};
  await assert.rejects(migrateTeachers(f.pool,admin,manifest,{...invite,redirectUrl:'https://evil.invalid/'}));
  const inviteLost:AuthAdmin={list:()=>admin.list(),get:id=>admin.get(id),create:(email,meta)=>admin.create(email,meta),invite:async(email,url)=>{await admin.invite(email,url);throw Error('lost invitation acknowledgement');}};
  assert.equal((await migrateTeachers(f.pool,inviteLost,manifest,invite)).failed,1);assert.equal((await migrateTeachers(f.pool,admin,manifest,invite)).skipped,1);assert.equal(mock.invitations.length,1);
  mock.adminUsers.get(item.auth_user_id)!.email_confirmed_at=new Date().toISOString();
  await f.pool.query("CREATE FUNCTION fail_auth_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure';END $$;CREATE TRIGGER fail_auth_link BEFORE INSERT ON duaxe.teacher_auth_links FOR EACH ROW EXECUTE FUNCTION fail_auth_link()");
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'finalize',apply:true})).failed,1);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links')).rows[0].n,'0');assert.equal((await f.pool.query('SELECT state FROM duaxe.auth_migration_items')).rows[0].state,'created');
  await f.pool.query('DROP TRIGGER fail_auth_link ON duaxe.teacher_auth_links');
  const final=await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'finalize',apply:true});assert.equal(final.linked,1);assert.equal(final.failed,0);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'finalize',apply:true})).failed,0);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'prepare',apply:true})).skipped,1);
  const auth=new SupabaseTeacherAuth({query:(s,v)=>f.pool.query(s,v)},mock.issuer,createLocalJWKSet(mock.keys),authUserStatus(mock.origin,mock.secret)),token=await mock.token(item.auth_user_id);
  assert.equal(await auth.authenticate('Bearer '+token),teacher.id);
  const report=JSON.stringify(await auditTeachers(f.pool));assert.ok(!report.includes(before[0].password));assert.ok(report.includes('legacy-scrypt'));
  const rollback=await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'rollback',apply:true});assert.equal(rollback.authUsersDeleted,0);assert.equal(await auth.authenticate('Bearer '+token),null);
  assert.equal(mock.adminUsers.size,1);assert.deepEqual((await f.pool.query('SELECT * FROM duaxe.teachers')).rows,before);assert.equal((await f.pool.query('SELECT id FROM duaxe.students')).rows[0].id,studentId);
  assert.deepEqual((await f.pool.query('SELECT checkpoint,report FROM duaxe.race_sessions')).rows,historyBefore);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'rollback',apply:true})).skipped,1);
  await assert.rejects(migrateTeachers(f.pool,admin,manifest,{batchId,phase:'prepare',apply:true}));
 }finally{await f.close();await mock.close();}
});

test('migration refuses normalized email duplicates, unknown IDs, email-only matching and banned users',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,3);const t=await f.seedTeacher(),other=await f.seedTeacher(),admin=new SupabaseAuthAdmin(mock.origin,mock.secret),batchId=randomUUID();
  await f.pool.query('UPDATE duaxe.teachers SET email=$1 WHERE id=$2',[t.email.toUpperCase(),other.id]);
  await assert.rejects(migrateTeachers(f.pool,admin,[{teacherId:t.id}],{batchId,phase:'prepare',apply:true}));assert.equal(mock.creates(),0);
  await f.pool.query('UPDATE duaxe.teachers SET email=$1 WHERE id=$2',[other.email,other.id]);
  await assert.rejects(migrateTeachers(f.pool,admin,[{teacherId:randomUUID()}],{batchId,phase:'prepare'}));
  const userId=randomUUID();mock.adminUsers.set(userId,{id:userId,email:t.email,email_confirmed_at:new Date().toISOString()});
  await assert.rejects(migrateTeachers(f.pool,admin,[{teacherId:t.id}],{batchId,phase:'prepare',apply:true}));assert.equal(mock.creates(),0);
  const manifest=[{teacherId:t.id,existingAuthUserId:userId,ownershipVerified:true}];
  mock.adminUsers.get(userId)!.banned_until='2999-01-01T00:00:00Z';await assert.rejects(migrateTeachers(f.pool,admin,manifest,{batchId,phase:'prepare',apply:true}));
  delete mock.adminUsers.get(userId)!.banned_until;
  await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[userId,t.id]);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'prepare',apply:true})).failed,0);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'finalize',apply:true})).failed,0);
  assert.equal((await migrateTeachers(f.pool,admin,manifest,{batchId,phase:'rollback',apply:true})).failed,0);
  assert.equal((await f.pool.query('SELECT enabled FROM duaxe.teacher_auth_links')).rows[0].enabled,true,'preexisting mapping is never disabled by rollback');
  const storage=await f.connect();await assert.rejects(migrateTeachers(f.pool,admin,[{teacherId:other.id}],{batchId:randomUUID(),phase:'prepare',apply:true}));await storage.close();
 }finally{await f.close();await mock.close();}
});

test('fresh provider check rejects disabled/unverified/deleted accounts and outages despite valid JWT',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,2);const teacher=await f.seedTeacher(),uid=randomUUID(),token=await mock.token(uid);await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[uid,teacher.id]);
  let calls=0;const verify=authUserStatus(mock.origin,mock.secret),auth=new SupabaseTeacherAuth({query:(s,v)=>f.pool.query(s,v)},mock.issuer,createLocalJWKSet(mock.keys),async(t,id)=>{calls++;return verify(t,id);});
  assert.equal(await auth.authenticate('Bearer '+token),teacher.id);assert.equal(await auth.authenticate('Bearer '+token),teacher.id);assert.equal(calls,1);
  mock.adminUsers.get(uid)!.banned_until='2999-01-01T00:00:00Z';assert.equal(await auth.authenticate('Bearer '+token,{fresh:true}),null);delete mock.adminUsers.get(uid)!.banned_until;
  mock.adminUsers.get(uid)!.email_confirmed_at=null;assert.equal(await auth.authenticate('Bearer '+token,{fresh:true}),null);mock.adminUsers.get(uid)!.email_confirmed_at=new Date().toISOString();
  mock.adminUsers.get(uid)!.deleted_at=new Date().toISOString();assert.equal(await auth.authenticate('Bearer '+token,{fresh:true}),null);delete mock.adminUsers.get(uid)!.deleted_at;
  const outage=new SupabaseTeacherAuth({query:(s,v)=>f.pool.query(s,v)},mock.issuer,createLocalJWKSet(mock.keys),async()=>false);assert.equal(await outage.authenticate('Bearer '+token),null);
 }finally{await f.close();await mock.close();}
});

test('Auth migration journal is not readable or writable by runtime SQL role',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture();try{await migratePostgres(f.pool,3);const storage=await f.connect();await assert.rejects(storage.db.query('SELECT * FROM duaxe.auth_migration_items'));await assert.rejects(storage.db.query('DELETE FROM duaxe.auth_migration_batches'));await storage.close();}finally{await f.close();}
});

test('password reset cutoff revokes all older access JWTs durably without affecting another teacher',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();try{
  await migratePostgres(f.pool,3);const teacher=await f.seedTeacher(),other=await f.seedTeacher(),uid=randomUUID(),otherUid=randomUUID();await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2),($3,$4)',[uid,teacher.id,otherUid,other.id]);
  const first=await mock.token(uid),second=await mock.token(uid,{session_id:randomUUID()}),otherToken=await mock.token(otherUid);
  const storage=await f.connect(),auth=new SupabaseTeacherAuth(storage.db,mock.issuer,undefined,authUserStatus(mock.origin,mock.secret),true);assert.equal(await auth.authenticate('Bearer '+second),teacher.id);
  await auth.revokeAll('Bearer '+first);assert.equal(await auth.authenticate('Bearer '+first),null);assert.equal(await auth.authenticate('Bearer '+second),null);assert.equal(await auth.authenticate('Bearer '+otherToken),other.id);
  const future=await mock.token(uid,{session_id:randomUUID(),iat:Math.floor(Date.now()/1000)+2});assert.equal(await auth.authenticate('Bearer '+future),teacher.id);
  await storage.close();const restarted=await f.connect(),restored=new SupabaseTeacherAuth(restarted.db,mock.issuer,undefined,authUserStatus(mock.origin,mock.secret),true);assert.equal(await restored.authenticate('Bearer '+second),null);assert.equal(await restored.authenticate('Bearer '+otherToken),other.id);
  const rows=JSON.stringify((await f.pool.query('SELECT * FROM duaxe.teacher_auth_cutoffs')).rows);assert.ok(!rows.includes(first));assert.ok(!rows.includes(second));await restarted.close();
 }finally{await f.close();await mock.close();}
});
