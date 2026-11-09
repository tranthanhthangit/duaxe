import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';import {io,type Socket} from 'socket.io-client';
import {ClassroomStore} from '../server/classroom/Store';import {SQLiteStorage} from '../server/storage/SQLiteStorage';import type {Storage,RoomRecord} from '../server/storage/contracts';import {createGameServer} from '../server/app';import {Room,LIMITS} from '../server/Room';import {defaultSet} from '../src/questions/model';import type {Credential,Reply,Frame} from '../shared/protocol';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
async function until(predicate:()=>boolean){const end=performance.now()+3000;while(!predicate()){if(performance.now()>end)throw Error('Condition timeout');await new Promise(r=>setTimeout(r,2));}}
async function harness(autoTick=false,shutdownTimeoutMs=5000){
 const dir=mkdtempSync(join(tmpdir(),'async-server-')),path=join(dir,'db.sqlite'),avatars=join(dir,'avatars'),sockets:Socket[]=[];
 let store=new ClassroomStore(path,avatars),before:(r:RoomRecord)=>Promise<void>=async()=>{},after:(r:RoomRecord)=>Promise<void>=async()=>{};
 function storage():Storage{const base=new SQLiteStorage(store);return {...base,rooms:{...base.rooms,save:async record=>{await before(record);await base.rooms.save(record);await after(record);}},close:()=>base.close()};}
 let server=createGameServer({origins:[],storage:storage(),autoTick,shutdownTimeoutMs}),url='';
 async function listen(){await server.ready;server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const address=server.http.address();assert.ok(address&&typeof address==='object');url='http://127.0.0.1:'+address.port;}await listen();
 const connect=async(cookie='')=>{const s=io(url,{autoConnect:false,transports:['websocket'],reconnection:false,extraHeaders:{Cookie:cookie}});sockets.push(s);const connected=new Promise<void>((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});s.connect();await connected;return s;};
 const ask=<T=unknown>(s:Socket,data:unknown)=>new Promise<Reply<T>>((resolve,reject)=>s.timeout(5000).emit('request',data,(error:Error|null,reply:Reply<T>)=>error?reject(error):resolve(reply)));
 const ok=async<T=unknown>(s:Socket,data:unknown)=>{const result=await ask<T>(s,data);assert.ok(result.ok,result.ok?'':result.error);return result.data;};
 const create=async()=>{const teacher=await connect(),auth=await ok<Credential>(teacher,{type:'create',set:defaultSet});return {teacher,auth};};
 const joinStudent=async(code:string,name='An')=>{const socket=await connect(),auth=await ok<Credential>(socket,{type:'join',code,name,color:1});return {socket,auth};};
 return {get server(){return server;},get store(){return store;},get url(){return url;},connect,ask,ok,create,joinStudent,
 before(fn:typeof before){before=fn;},after(fn:typeof after){after=fn;},
 restart:async()=>{before=async()=>{};after=async()=>{};await server.close();await server.drained();store.close();store=new ClassroomStore(path,avatars);server=createGameServer({origins:[],storage:storage(),autoTick,shutdownTimeoutMs});await listen();},
 close:async()=>{before=async()=>{};after=async()=>{};sockets.forEach(s=>s.disconnect());await server.close().catch(()=>{});await server.drained();store.close();rmSync(dir,{recursive:true,force:true});},
 };
}
const correct={type:'answer',questionId:'sun',optionId:'morning',commandId:'answer-000001'};

test('awaited answer is invisible until commit; same-room duplicates serialize while another room progresses',async()=>{
 const h=await harness(),gate=deferred(),entered=deferred();try{
  const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code),b=await h.joinStudent(auth.code,'Bình');await h.ok(teacher,{type:'control',action:'start'});const live=h.server.rooms.get(auth.code)!,frames:Frame[]=[];teacher.on('frame',(f:Frame)=>frames.push(f));let hold=true,acked=false;
  h.before(async record=>{if(hold&&record.checkpoint.code===auth.code&&record.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
  const first=h.ask(a.socket,correct).then(r=>{acked=true;return r;});await entered.promise;
  const retry=h.ask(a.socket,correct),conflict=h.ask(a.socket,{...correct,commandId:'answer-other1'}),second=h.ask(b.socket,correct);
  await until(()=>h.server.queue.pending(auth.code)>=4);await h.server.advance();assert.equal(acked,false);assert.equal(live.student(a.auth.playerId).quiz.results.length,0);assert.equal(live.student(a.auth.playerId).race.boost,0);assert.equal(frames.some(f=>f.room.players.some(p=>p.points>0)),false);
  const other=await h.create(),c=await h.joinStudent(other.auth.code,'Chi');await h.ok(other.teacher,{type:'control',action:'start'});await h.ok(c.socket,correct);assert.equal(h.server.rooms.get(other.auth.code)!.student(c.auth.playerId).quiz.totals.correct,1);assert.equal(acked,false);
  gate.resolve();const replies=await Promise.all([first,retry,conflict,second]);assert.deepEqual(replies.map(r=>r.ok),[true,true,false,true]);assert.equal(live.student(a.auth.playerId).quiz.results.length,1);assert.equal(live.student(b.auth.playerId).quiz.results.length,1);
  await h.ok(a.socket,{type:'lane',direction:1});await h.server.idle();assert.equal(h.server.queue.metrics().activeRooms,0);
 }finally{gate.resolve();await h.close();}
});

test('failed async transaction never exposes boost/score or acknowledges a receipt retry',async()=>{
 const h=await harness();try{const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});
  h.before(async record=>{if(record.checkpoint.players.some(p=>p.quiz.results.length))throw Error('private storage failure');});
  assert.equal((await h.ask(a.socket,correct)).ok,false);assert.equal((await h.ask(a.socket,correct)).ok,false);const live=h.server.rooms.get(auth.code)!;assert.equal(live.status,'paused');assert.equal(live.student(a.auth.playerId).quiz.totals.correct,0);assert.equal(live.student(a.auth.playerId).race.boost,0);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,0);assert.equal((await fetch(h.url+'/health')).status,503);
 }finally{await h.close();}
});

test('commit succeeded but response failed: restart replays durable receipt without another reward',async()=>{
 const h=await harness();try{const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});let once=true;
  h.after(async record=>{if(once&&record.checkpoint.players.some(p=>p.quiz.results.length)){once=false;throw Error('lost commit response');}});
  assert.equal((await h.ask(a.socket,correct)).ok,false);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,1);assert.equal(h.server.rooms.get(auth.code)!.student(a.auth.playerId).quiz.totals.correct,0);
  await h.restart();assert.equal(h.server.rooms.get(auth.code)!.status,'paused');const t=await h.connect(),s=await h.connect();await h.ok(t,{type:'resume',credential:auth});await h.ok(s,{type:'resume',credential:a.auth});await h.ok(s,correct);const p=h.server.rooms.get(auth.code)!.student(a.auth.playerId);assert.equal(p.quiz.totals.correct,1);assert.equal(p.quiz.results.length,1);assert.equal(p.race.boost,3);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,1);
 }finally{await h.close();}
});

test('slow checkpoint cannot overwrite a later answer; tick work is coalesced while persistence waits',async()=>{
 const h=await harness(true),gate=deferred(),entered=deferred();try{
  const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});let hold=true;
  h.before(async r=>{if(hold&&r.checkpoint.code===auth.code&&r.checkpoint.status==='running'&&!r.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
  await entered.promise;const response=h.ask(a.socket,correct);await until(()=>h.server.queue.pending(auth.code)>=2);for(let i=0;i<5;i++)await h.server.advance();assert.equal(h.server.queue.pending(auth.code),2);
  gate.resolve();assert.equal((await response).ok,true);await h.server.advance(performance.now()+2000);const row=JSON.parse(String(h.store.db.prepare('SELECT checkpoint FROM race_sessions WHERE code=?').get(auth.code)!.checkpoint));assert.equal(row.players[0].quiz.results.length,1);assert.equal(row.players[0].receipts[0][0],correct.commandId);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,1);
 }finally{gate.resolve();await h.close();}
});

test('20 delayed clients preserve serialized answers and durable receipts through async restart',async()=>{
 const h=await harness();try{const {teacher,auth}=await h.create(),students=await Promise.all(Array.from({length:20},(_,i)=>h.joinStudent(auth.code,'Bạn '+i)));await h.ok(teacher,{type:'control',action:'start'});let active=0,maxActive=0;
  h.before(async r=>{if(r.checkpoint.players.some(p=>p.quiz.results.length)){active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,4));active--;}});
  await Promise.all(students.map(p=>h.ok(p.socket,correct)));assert.equal(maxActive,1);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,20);await h.server.idle();assert.equal(h.server.queue.metrics().pending,0);
  await h.restart();const t=await h.connect();await h.ok(t,{type:'resume',credential:auth});await Promise.all(students.map(async p=>{const s=await h.connect();await h.ok(s,{type:'resume',credential:p.auth});await h.ok(s,correct);}));const room=h.server.rooms.get(auth.code)!;assert.equal(room.status,'paused');assert.equal(room.players.size,20);assert.ok([...room.players.values()].every(p=>p.quiz.results.length===1&&p.quiz.totals.correct===1));assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,20);
 }finally{await h.close();}
});

test('graceful shutdown drains admitted answer before final checkpoint and leaves DB lifecycle to caller',async()=>{
 const h=await harness(),gate=deferred(),entered=deferred();try{const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});let hold=true;
  h.before(async r=>{if(hold&&r.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
  const answer=h.ask(a.socket,correct);await entered.promise;const closing=h.server.close();assert.equal((await h.ask(teacher,{type:'control',action:'end'})).ok,false);gate.resolve();assert.equal((await answer).ok,true);await closing;assert.equal(h.server.queue.metrics().pending,0);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,1);
 }finally{gate.resolve();await h.close();}
});

test('shutdown deadline rejects without closing busy storage or confirming a late commit',async()=>{
 const h=await harness(false,40),gate=deferred(),entered=deferred();try{const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});let hold=true;
  h.before(async r=>{if(hold&&r.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
  const response=h.ask(a.socket,correct).catch(()=>null);await entered.promise;await assert.rejects(h.server.close(),/Hết thời gian/);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,0);gate.resolve();await h.server.drained();assert.notEqual((await response)?.ok,true);assert.equal(h.server.queue.metrics().pending,0);
 }finally{gate.resolve();await h.close();}
});

test('startup I/O failure is not misclassified as corrupt room data and health stays unavailable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'async-startup-')),store=new ClassroomStore(join(dir,'db.sqlite'),join(dir,'avatars')),base=new SQLiteStorage(store),room=new Room('ABC234',defaultSet,'x'.repeat(43),'teacher');room.sequence=1;await base.rooms.save({checkpoint:room.checkpoint(),report:room.report()});let corrupt=0;
 const storage:Storage={...base,rooms:{...base.rooms,loadActive:async()=>{throw Error('connection failed');},markCorrupt:async()=>{corrupt++;}},close:()=>base.close()},server=createGameServer({origins:[],storage});
 try{await assert.rejects(server.ready,/Lưu trữ/);server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const a=server.http.address();assert.ok(a&&typeof a==='object');assert.equal((await fetch('http://127.0.0.1:'+a.port+'/health')).status,503);assert.equal(corrupt,0);assert.equal(store.db.prepare('SELECT status FROM race_sessions').get()!.status,'ready');}
 finally{await server.close();await base.close();rmSync(dir,{recursive:true,force:true});}
});


test('tab replacement queued behind an answer cannot allow a stale tab to change the car',async()=>{
 const h=await harness(),gate=deferred(),entered=deferred();try{const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});let hold=true;
 h.before(async r=>{if(hold&&r.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
 const response=h.ask(a.socket,correct);await entered.promise;const newTab=await h.connect(),resume=h.ask(newTab,{type:'resume',credential:a.auth});await until(()=>h.server.queue.pending(auth.code)>=2);const staleLane=h.ask(a.socket,{type:'lane',direction:1}).catch(()=>null);await until(()=>h.server.queue.pending(auth.code)>=3);gate.resolve();assert.equal((await response).ok,true);assert.equal((await resume).ok,true);assert.notEqual((await staleLane)?.ok,true);const p=h.server.rooms.get(auth.code)!.student(a.auth.playerId);assert.equal(p.socketId,newTab.id);assert.equal(p.race.cars[0].lane,0);assert.equal(p.quiz.results.length,1);assert.equal(h.server.rooms.get(auth.code)!.status,'running');
 }finally{gate.resolve();await h.close();}
});

test('teacher recovery queued during persistence rechecks a revoked login before rotating capability',async()=>{
 const h=await harness(),gate=deferred(),entered=deferred();try{
 const owner=h.store.createTeacher('teacher@example.test','teacher-password-long'),cookie='teacher_session='+h.store.login('teacher@example.test','teacher-password-long'),teacher=await h.connect(cookie),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet}),a=await h.joinStudent(auth.code);assert.equal(h.server.rooms.get(auth.code)!.ownerId,owner);await h.ok(teacher,{type:'control',action:'start'});let hold=true;
 h.before(async r=>{if(hold&&r.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
 const response=h.ask(a.socket,correct);await entered.promise;const recoverySocket=await h.connect(cookie),recovery=h.ask(recoverySocket,{type:'recoverTeacher',code:auth.code});await until(()=>h.server.queue.pending(auth.code)>=2);h.store.logout(cookie);gate.resolve();assert.equal((await response).ok,true);assert.equal((await recovery).ok,false);assert.equal(h.server.rooms.get(auth.code)!.teacher.socketId,teacher.id);
 }finally{gate.resolve();await h.close();}
});


test('Wi-Fi disconnect and resume queued behind an in-flight commit preserve one answer and identity',async()=>{
 const h=await harness(),gate=deferred(),entered=deferred();try{const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});let hold=true;
 h.before(async r=>{if(hold&&r.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
 const response=h.ask(a.socket,correct).catch(()=>null);await entered.promise;a.socket.disconnect();const s=await h.connect(),resume=h.ask(s,{type:'resume',credential:a.auth});await until(()=>h.server.queue.pending(auth.code)>=3);gate.resolve();await response;assert.equal((await resume).ok,true);await h.ok(s,correct);const room=h.server.rooms.get(auth.code)!;assert.equal(room.players.size,1);assert.equal(room.student(a.auth.playerId).socketId,s.id);assert.equal(room.student(a.auth.playerId).quiz.results.length,1);assert.equal(room.status,'running');assert.equal(h.server.queue.metrics().rejected,0);
 }finally{gate.resolve();await h.close();}
});

test('expiry queued behind a commit retains its answer and releases room queue bookkeeping',async()=>{
 const h=await harness(),gate=deferred(),entered=deferred();try{const {teacher,auth}=await h.create(),a=await h.joinStudent(auth.code);await h.ok(teacher,{type:'control',action:'start'});let hold=true;
 h.before(async r=>{if(hold&&r.checkpoint.players.some(p=>p.quiz.results.length)){hold=false;entered.resolve();await gate.promise;}});
 const response=h.ask(a.socket,correct).catch(()=>null);await entered.promise;const cleanup=h.server.cleanup(h.server.rooms.get(auth.code)!.createdAt+LIMITS.roomLife+1);await until(()=>h.server.queue.pending(auth.code)>=2);gate.resolve();await response;await cleanup;await h.server.idle();assert.equal(h.server.rooms.has(auth.code),false);assert.equal(h.server.queue.metrics().activeRooms,0);assert.equal(h.server.queue.metrics().pending,0);assert.equal(h.store.db.prepare('SELECT status FROM race_sessions WHERE code=?').get(auth.code)!.status,'expired');assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM race_answers').get()!.n,1);
 }finally{gate.resolve();await h.close();}
});
