import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app';
import { LIMITS } from '../server/Room';
import { defaultSet } from '../src/questions/model';
import type { Credential, Frame, PublicQuestion, Reply, Report } from '../shared/protocol';
import { reportCsv } from '../src/online/export';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function harness(autoTick=false){
 const server=createGameServer({origins:['http://test.local'],autoTick});server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const address=server.http.address();if(!address||typeof address==='string')throw new Error();
 const url=`http://127.0.0.1:${address.port}`,sockets:Socket[]=[];
 async function connect(origin='http://test.local'){
  const socket=io(url,{autoConnect:false,forceNew:true,transports:['websocket'],extraHeaders:{Origin:origin},reconnection:false});sockets.push(socket);const promise=new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject);});socket.connect();await promise;return socket;
 }
 function ask<T=unknown>(socket:Socket,payload:unknown):Promise<Reply<T>>{return new Promise((resolve,reject)=>socket.timeout(2000).emit('request',payload,(error:Error|null,result:Reply<T>)=>error?reject(error):resolve(result)));}
 async function ok<T=unknown>(socket:Socket,payload:unknown){const result=await ask<T>(socket,payload);if(!result.ok)assert.fail(result.error);return result.data;}
 return {server,url,connect,ask,ok,close:async()=>{sockets.forEach(s=>s.disconnect());await server.close();}};
}
test('20 concurrent students, 21st rejected, authoritative ranking and no answer/secret leaks',async()=>{
 const h=await harness();try{
  const teacher=await h.connect(),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet});assert.match(auth.code,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(auth.token.length,43);
  const students=await Promise.all(Array.from({length:20},()=>h.connect()));
  const joined=await Promise.all(students.map((socket,i)=>h.ok<Credential>(socket,{type:'join',code:auth.code,name:`Bé ${i+1}`,color:0xffbd42})));
  assert.equal(new Set(joined.map(p=>p.playerId)).size,20);
  const extra=await h.connect();assert.equal((await h.ask(extra,{type:'join',code:auth.code,name:'Bé 21',color:42})).ok,false);
  let current:PublicQuestion|null=null;students[0].on('question',q=>current=q);
  await h.ok(teacher,{type:'control',action:'start'});await sleep(30);assert.ok(current);assert.equal('correctOptionId' in current!,false);
  await h.ok(students[0],{type:'answer',questionId:'sun',optionId:'morning'});
  const room=h.server.rooms.get(auth.code)!;for(let i=0;i<20;i++)room.tick(.05);
  const view=room.frame(joined[0].playerId);assert.equal(view.room.players.length,20);assert.equal(view.room.players[0].id,joined[0].playerId);assert.equal(view.room.players[0].points,10);assert.ok(view.room.players[0].distance>view.room.players[1].distance);
  const encoded=JSON.stringify(view);for(const c of [auth,...joined]){assert.equal(encoded.includes(c.token),false);}assert.equal(encoded.includes('correctOptionId'),false);assert.equal(encoded.includes('digest'),false);
  assert.equal((await h.ask(students[1],{type:'lane',direction:1,distance:3000,points:1000})).ok,false);
  await h.ok(teacher,{type:'control',action:'end'});const report=await h.ok<Report>(teacher,{type:'report'});assert.equal(report.players.length,20);assert.equal(report.players[0].answers[0].selectedOptionId,'morning');assert.equal(report.players[0].answers[0].correct,true);assert.ok(reportCsv(report).includes('Thời gian (giây)'));
 }finally{await h.close();}
});
test('student reconnect restores identity, car, quiz and results; duplicate tab is replaced',async()=>{
 const h=await harness();try{
  const teacher=await h.connect(),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet});const first=await h.connect(),student=await h.ok<Credential>(first,{type:'join',code:auth.code,name:'Bé An',color:123});
  await h.ok(teacher,{type:'control',action:'start'});await h.ok(first,{type:'answer',questionId:'sun',optionId:'morning'});await h.ok(first,{type:'next',questionId:'sun'});await h.ok(first,{type:'lane',direction:1});
  const room=h.server.rooms.get(auth.code)!,before=room.student(student.playerId);const lane=before.race.cars[0].lane;first.disconnect();await sleep(30);assert.equal(room.frame().room.players[0].online,false);
  const second=await h.connect();await h.ok(second,{type:'resume',credential:student});assert.equal(room.players.size,1);assert.equal(room.student(student.playerId).quiz.index,1);assert.equal(room.student(student.playerId).quiz.totals.correct,1);assert.equal(room.student(student.playerId).race.cars[0].lane,lane);assert.equal(room.frame().room.players[0].name,'Bé An');
  const third=await h.connect();const replaced=new Promise<void>(resolve=>second.once('replaced',()=>resolve()));await h.ok(third,{type:'resume',credential:student});await replaced;await sleep(20);assert.equal(second.connected,false);assert.equal(room.frame().room.players[0].online,true);assert.equal(room.players.size,1);
  const bad=await h.connect();assert.equal((await h.ask(bad,{type:'resume',credential:{...student,token:'a'.repeat(43)}})).ok,false);
 }finally{await h.close();}
});
test('teacher commands require teacher capability; disconnect pauses and restore does not auto resume',async()=>{
 const h=await harness();try{
  const teacher=await h.connect(),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet}),student=await h.connect();await h.ok(student,{type:'join',code:auth.code,name:'Bé',color:1});
  for(const payload of [{type:'control',action:'start'},{type:'configure',set:defaultSet},{type:'report'}])assert.equal((await h.ask(student,payload)).ok,false);
  await h.ok(teacher,{type:'control',action:'start'});teacher.disconnect();await sleep(30);const room=h.server.rooms.get(auth.code)!;assert.equal(room.status,'paused');assert.equal(room.frame().room.teacherOnline,false);const elapsed=room.elapsed;room.tick(.05);assert.equal(room.elapsed,elapsed);
  const restored=await h.connect();await h.ok(restored,{type:'resume',credential:auth});assert.equal(room.status,'paused');assert.equal(room.frame().room.teacherOnline,true);await h.ok(restored,{type:'control',action:'resume'});assert.equal(room.status,'running');
 }finally{await h.close();}
});
test('duplicate answers, late answers, stale next, paused input and invalid payloads are rejected',async()=>{
 const h=await harness();try{
  const teacher=await h.connect(),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet}),student=await h.connect();const identity=await h.ok<Credential>(student,{type:'join',code:auth.code,name:'Bé',color:1});
  assert.equal((await h.ask(student,{type:'answer',questionId:'sun',optionId:'morning'})).ok,false);await h.ok(teacher,{type:'control',action:'start'});
  await h.ok(student,{type:'answer',questionId:'sun',optionId:'morning'});assert.equal((await h.ask(student,{type:'answer',questionId:'sun',optionId:'morning'})).ok,false);await h.ok(student,{type:'next',questionId:'sun'});assert.equal((await h.ask(student,{type:'next',questionId:'sun'})).ok,false);
  const room=h.server.rooms.get(auth.code)!;for(let i=0;i<405;i++)room.tick(.05);assert.equal((await h.ask(student,{type:'answer',questionId:'legs',optionId:'four'})).ok,false);assert.equal(room.student(identity.playerId).quiz.results.length,2);assert.equal(room.student(identity.playerId).quiz.results[1].timedOut,true);
  await h.ok(teacher,{type:'control',action:'pause'});assert.equal((await h.ask(student,{type:'lane',direction:1})).ok,false);assert.equal((await h.ask(student,{type:'next',questionId:'legs'})).ok,false);
  for(const input of [null,{},[],{type:'lane',direction:100},{type:'answer',questionId:'x'.repeat(3000),optionId:'x'},{type:'control',action:'hack'}])assert.equal((await h.ask(student,input)).ok,false);
 }finally{await h.close();}
});
test('room expiry, teacher absence, configuration validation and rate limits are bounded',async()=>{
 const h=await harness();try{
  const teacher=await h.connect(),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet});assert.equal((await h.ask(teacher,{type:'configure',set:{}})).ok,false);
  const set=structuredClone(defaultSet);set.title='Bộ đề mới';await h.ok(teacher,{type:'configure',set});assert.equal(h.server.rooms.get(auth.code)!.set.title,'Bộ đề mới');
  teacher.disconnect();await sleep(20);const room=h.server.rooms.get(auth.code)!;await h.server.cleanup(room.teacherLeftAt!+LIMITS.teacherAbsent+1);assert.equal(h.server.rooms.has(auth.code),false);
  const peer=await h.connect();const replies=[];for(let i=0;i<55;i++)replies.push(await h.ask(peer,{type:'lane',direction:1}));assert.ok(replies.some(r=>!r.ok&&r.error.includes('quá nhanh')));
  const owner=await h.connect(),other=await h.ok<Credential>(owner,{type:'create',set:defaultSet});const expiring=h.server.rooms.get(other.code)!;await h.server.cleanup(expiring.createdAt+LIMITS.roomLife+1);assert.equal(h.server.rooms.size,0);
 }finally{await h.close();}
});
test('live ticker broadcasts 20 connected students while simulation advances',async()=>{
 const h=await harness(true);try{
  const teacher=await h.connect(),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet});const students=await Promise.all(Array.from({length:20},()=>h.connect()));await Promise.all(students.map((s,i)=>h.ok(s,{type:'join',code:auth.code,name:`Bé ${i}`,color:i})));
  const frames=new Map<Socket,Frame>(),counts=new Map<Socket,number>();students.forEach(s=>s.on('frame',frame=>{frames.set(s,frame);counts.set(s,(counts.get(s)??0)+1);}));
  await h.ok(teacher,{type:'control',action:'start'});await sleep(3000);
  assert.equal(frames.size,20);assert.ok([...counts.values()].every(count=>count>=15));for(const frame of frames.values()){assert.ok(frame.room.elapsed>=1);assert.ok(frame.room.players.every(p=>p.distance> -Math.floor((p.number-1)/3)*42+20));assert.equal(frame.room.players.length,20);}
 }finally{await h.close();}
});
test('CSV escapes quotes, Vietnamese, multiline names and spreadsheet formulas',()=>{
 const csv=reportCsv({code:'ABC234',title:'Bộ đề',elapsed:1,players:[{id:'x',number:1,name:'=SUM(1,2)',rank:1,online:true,correct:0,wrong:0,points:0,distance:1,speed:1,lane:0,color:0,boost:0,slow:0,answers:[]}]});assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=SUM(1,2)"'));
});

test('unapproved browser origins are rejected by the websocket handshake',async()=>{
 const h=await harness();try{await assert.rejects(h.connect('https://not-allowed.example'));}finally{await h.close();}
});
test('20 simultaneous answers are scored once; overtaking changes rank; command receipts survive reconnect',async()=>{
 const h=await harness();try{
  const teacher=await h.connect(),auth=await h.ok<Credential>(teacher,{type:'create',set:defaultSet});
  const clients=await Promise.all(Array.from({length:20},()=>h.connect()));const identities=await Promise.all(clients.map((s,i)=>h.ok<Credential>(s,{type:'join',code:auth.code,name:`Đồng thời ${i}`,color:i})));
  await h.ok(teacher,{type:'control',action:'start'});
  const answers=await Promise.all(clients.map((s,i)=>h.ask(s,{type:'answer',questionId:'sun',optionId:i===0?'night':'morning',commandId:`answer-000${i}`})));assert.ok(answers.every(r=>r.ok));
  await Promise.all(clients.map((s,i)=>h.ok(s,{type:'answer',questionId:'sun',optionId:i===0?'night':'morning',commandId:`answer-000${i}`})));
  const room=h.server.rooms.get(auth.code)!;assert.ok([...room.players.values()].every(p=>p.quiz.results.length===1));
  for(let i=0;i<20;i++)room.tick(.05);assert.notEqual(room.frame().room.players[0].id,identities[0].playerId);assert.ok(room.frame().room.players.find(p=>p.id===identities[0].playerId)!.rank>room.frame().room.players.find(p=>p.id===identities[1].playerId)!.rank);
  const lane={type:'lane',direction:1,commandId:'lane-123456'};await h.ok(clients[0],lane);const before=room.student(identities[0].playerId).race.cars[0].lane;await h.ok(clients[0],lane);assert.equal(room.student(identities[0].playerId).race.cars[0].lane,before);
  clients[0].disconnect();await sleep(15);const restored=await h.connect();await h.ok(restored,{type:'resume',credential:identities[0]});await h.ok(restored,lane);assert.equal(room.student(identities[0].playerId).race.cars[0].lane,before);assert.equal((await h.ask(restored,{...lane,direction:-1})).ok,false);
 }finally{await h.close();}
});
