import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {pgFixture,postgresEnabled} from './helpers/postgres';
import {mockSupabase} from './helpers/supabase';
import {migratePostgres} from '../server/storage/postgres/migrate';
import {SupabaseTeacherAuth} from '../server/cloud/TeacherAuth';
import {authUserStatus} from '../server/cloud/AuthUserStatus';
import {createGameServer} from '../server/app';
import {defaultSet} from '../src/questions/model';
import type {Storage} from '../server/storage/contracts';
import type {Credential,Reply} from '../shared/protocol';

test('teacher socket with an expired JWT loses passive access; refresh preserves the room owner',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture(),mock=await mockSupabase();let server:ReturnType<typeof createGameServer>|undefined;const sockets:ReturnType<typeof io>[]=[];
 try{
  await migratePostgres(f.pool,2);const teacher=await f.seedTeacher(),uid=randomUUID();await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[uid,teacher.id]);
  const storage=await f.connect(),adapter:Storage=storage;adapter.teachers=new SupabaseTeacherAuth(storage.db,mock.issuer,undefined,authUserStatus(mock.origin,mock.secret));
  server=createGameServer({storage:adapter,origins:[],autoTick:false});await server.ready;server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const address=server.http.address();assert.ok(address&&typeof address==='object');
  const connect=async()=>{const socket=io('http://127.0.0.1:'+address.port,{autoConnect:false,transports:['websocket'],auth:{teacherToken:await mock.token(uid,{exp:Math.floor(Date.now()/1000)+2})},reconnection:false});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});return socket;};
  const ask=(s:ReturnType<typeof io>,p:unknown)=>new Promise<Reply<Credential>>(r=>s.emit('request',p,r));
  const expired=await connect(),create=await ask(expired,{type:'create',set:defaultSet});assert.ok(create.ok);const expiredCode=create.data.code;
  const refreshed=await connect(),other=await ask(refreshed,{type:'create',set:defaultSet});assert.ok(other.ok);
  const reply=await new Promise<{ok:boolean}>(r=>refreshed.emit('teacher-auth','invalid-token',r));
  assert.equal(reply.ok,false);
  const fresh=await mock.token(uid);const updated=await new Promise<{ok:boolean}>(r=>refreshed.emit('teacher-auth',fresh,r));assert.equal(updated.ok,true);
  await Promise.race([new Promise<void>(resolve=>expired.once('disconnect',()=>resolve())),new Promise((_,reject)=>setTimeout(()=>reject(Error('Expired teacher retained socket access')),13500).unref())]);
  await server.idle();assert.equal(refreshed.connected,true);assert.equal(server.rooms.get(expiredCode)!.teacher.socketId,undefined);
  const control=await ask(refreshed,{type:'control',action:'end'});assert.ok(control.ok);
 }finally{sockets.forEach(s=>s.disconnect());await server?.close();await f.close();await mock.close();}
});
