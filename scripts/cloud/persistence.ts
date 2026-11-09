/** Real compiled production bootstrap + local PG + HTTPS Auth/Storage emulator. */
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {io,type Socket} from 'socket.io-client';
import {mockSupabase} from '../../tests/helpers/supabase';
import {pgFixture} from '../../tests/helpers/postgres';
import {migratePostgres} from '../../server/storage/postgres/migrate';
import {PostgresStorage} from '../../server/storage/PostgresStorage';
import {SupabaseAvatarObjects} from '../../server/cloud/AvatarObjects';
import {defaultSet} from '../../src/questions/model';
import type {Credential,Reply,Frame} from '../../shared/protocol';

if(!process.env.LOCAL_TEST_TLS_KEY||!process.env.LOCAL_TEST_TLS_CERT)throw Error('Explicit local TLS fixture required.');
const evidence=process.env.AUTH_SIGNALS_OUTPUT??'benchmarks/production-local';
const f=await pgFixture(),mock=await mockSupabase({key:await readFile(process.env.LOCAL_TEST_TLS_KEY),cert:await readFile(process.env.LOCAL_TEST_TLS_CERT)});await migratePostgres(f.pool,process.env.SIGNUP_FACTORY_TEST==='1'?4:3);
const teacher=await f.seedTeacher(),uid=randomUUID();await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[uid,teacher.id]);
const storage=await PostgresStorage.connect(f.config,'',new SupabaseAvatarObjects(mock.origin,mock.bucket,mock.secret)),cls=await storage.classrooms.saveClass(teacher.id,{name:'Synthetic TLS class'});await storage.classrooms.importStudents(teacher.id,cls,Array.from({length:20},(_,i)=>({fullName:'Synthetic '+i,displayName:'Synthetic '+i})));const students=await storage.classrooms.students(teacher.id,cls);
for(const s of students)await storage.avatars.upload(teacher.id,s.id,await sharp({create:{width:128,height:128,channels:3,background:'skyblue'}}).webp().toBuffer());await storage.close();
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const addr=reserve.address();assert.ok(addr&&typeof addr==='object');await new Promise<void>(r=>reserve.close(()=>r()));const base='http://127.0.0.1:'+addr.port,key='g'.repeat(43),origin='https://classroom.test.invalid',token=await mock.token(uid);
let child:ReturnType<typeof spawn>|undefined,logs='';const clients:Socket[]=[],results:unknown[]=[];
const env={...process.env,TEACHER_SELF_SIGNUP:process.env.SIGNUP_FACTORY_TEST==='1'?'true':'false',NODE_ENV:'production',STORAGE_DRIVER:'postgres',TEACHER_AUTH_DRIVER:'supabase',AVATAR_STORAGE_DRIVER:'supabase',DATABASE_URL:f.runtimeUrl,PG_SSL_MODE:'disable',SUPABASE_URL:mock.origin,SUPABASE_STORAGE_KEY:mock.secret,SUPABASE_AVATAR_BUCKET:mock.bucket,PRODUCTION_ACCESS_MODE:'pilot',BACKEND_GATEWAY_KEY:key,CORS_ORIGINS:origin,TURNSTILE_SECRET_KEY:'synthetic-server-enrollment-secret',TURNSTILE_EXPECTED_HOSTNAME:'classroom.test.invalid',PORT:String(addr.port)};
const signupUid=randomUUID();let signupId:string|undefined;mock.adminUsers.set(signupUid,{id:signupUid,email:'self-signup-restart@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{full_name:'Cô thử nghiệm'}});const signupToken=await mock.token(signupUid);
async function checkSignup(){if(process.env.SIGNUP_FACTORY_TEST!=='1')return;const response=await fetch(base+'/api/auth/profile',{method:'POST',headers:{Authorization:'Bearer '+signupToken,'X-Deployment-Key':key,'X-Classroom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({captchaToken:'synthetic-local-enrollment-token'})});assert.equal(response.status,200);const result=await response.json();if(signupId)assert.equal(result.id,signupId);else{assert.notEqual(result.id,signupUid);signupId=result.id;}}
async function start(){child=spawn(process.execPath,[...(process.env.SIGNUP_FACTORY_TEST==='1'?['--import',new URL('../../tests/helpers/turnstile-preload.mjs',import.meta.url).href]:[]),'dist-server/index.js'],{env,stdio:['ignore','pipe','pipe']});child.stdout?.on('data',b=>logs+=b);child.stderr?.on('data',b=>logs+=b);for(let i=0;i<150;i++){try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw Error('Compiled cloud server startup failed');}
async function stop(signal:NodeJS.Signals){if(!child||child.exitCode!==null)return;const done=once(child,'exit');child.kill(signal);await done;child=undefined;}
const connect=async(auth:Record<string,string>={})=>{const s=io(base,{autoConnect:false,transports:['websocket'],reconnection:false,auth,extraHeaders:{Origin:origin,'X-Deployment-Key':key}});clients.push(s);await new Promise<void>((r,j)=>{s.once('connect',r);s.once('connect_error',j);s.connect();});return s;};
const ask=<T,>(s:Socket,p:unknown)=>new Promise<T>((r,j)=>s.timeout(15000).emit('request',p,(e:Error|null,v:Reply<T>)=>e||!v.ok?j(Error('Cloud test request failed')):r(v.data)));
try{
 await start();await checkSignup();assert.equal((await fetch(base+'/api/classes')).status,503);
 for(const signal of ['SIGTERM','SIGINT','SIGKILL'] as NodeJS.Signals[]){
  const owner=await connect({teacherToken:token}),auth=await ask<Credential>(owner,{type:'create',set:defaultSet,classId:cls,studentIds:students.map(s=>s.id)});
  const response=await fetch(base+'/api/rooms/'+auth.code+'/invite',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Deployment-Key':key,'X-Classroom-Request':'1'}});assert.equal(response.status,200);const invite=await response.json();
  const sockets=await Promise.all(students.map(()=>connect({invite:invite.token}))),credentials=await Promise.all(sockets.map((s,i)=>ask<Credential>(s,{type:'claim',code:auth.code,studentId:students[i].id,color:i})));await ask(owner,{type:'control',action:'start'});
  const command={type:'answer',questionId:'sun',optionId:'morning',commandId:'compiled-cloud-answer'};await Promise.all(sockets.map(s=>ask(s,command)));let before=0;sockets[0].on('frame',(f:Frame)=>{before=f.room.players.find(p=>p.id===credentials[0].playerId)?.distance??0;});await new Promise(r=>setTimeout(r,650));await stop(signal);await start();
  await checkSignup();const teacherSocket=await connect({teacherToken:token});await ask(teacherSocket,{type:'resume',credential:auth});let after=0;
  await Promise.all(credentials.map(async(c,i)=>{const s=await connect(),avatars=new Promise<{avatarData?:string;studentId:string}[]>(r=>s.once('avatars',r)),frame=new Promise<Frame>(r=>s.once('frame',r));await ask(s,{type:'resume',credential:c});const f=await frame;assert.equal(f.room.status,'paused');assert.equal(f.room.players.find(p=>p.id===c.playerId)!.points,10);const a=await avatars;assert.equal(a.length,1);assert.equal(a[0].studentId,students[i].id);assert.ok(a[0].avatarData);if(i===0)after=f.room.players.find(p=>p.id===c.playerId)!.distance;await ask(s,command);}));
  assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.race_answers WHERE room_code=$1',[auth.code])).rows[0].n,'20');await ask(teacherSocket,{type:'control',action:'end'});results.push({signal,players:20,acknowledgedAnswers:20,restoredStatus:'paused',avatarsCorrect:20,duplicateReward:false,rollbackMetres:Math.max(0,before-after)});
  for(const c of [auth,...credentials])assert.equal(logs.includes(c.token),false);
 }
 assert.equal(logs.includes(token),false);assert.equal(logs.includes(signupToken),false);assert.equal(logs.includes(mock.secret),false);await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'cloud-signals.json'),JSON.stringify({environment:'Compiled server/index.js NODE_ENV=production; local PostgreSQL17 and HTTPS Auth/Storage emulator; CA verification enabled; fake HTTPS CORS origin. Not hosted Render/Supabase.',selfSignupFactoryEnabled:process.env.SIGNUP_FACTORY_TEST==='1',signupIdPreservedAcrossRestarts:!!signupId,results},null,2)+'\n');console.log('LOCAL INTEGRATION COMPLETED:3 signals,20 durable ACKs/avatars each, paused recovery, no duplicates. Auth/Storage/Turnstile emulated; hosted recovery NOT TESTED.');
}finally{clients.forEach(s=>s.disconnect());await stop('SIGTERM');await f.close();await mock.close();}
