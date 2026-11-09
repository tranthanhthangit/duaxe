import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { io, type Socket } from 'socket.io-client';
import { ClassroomStore } from '../server/classroom/Store';
import { createGameServer } from '../server/app';
import { defaultSet } from '../src/questions/model';
import type { Credential,Reply } from '../shared/protocol';
import type { RoomProfile } from '../shared/classroom';
test('private API + 20 profile clients: teacher auth, ownership, avatar access, atomic claims and release/reconnect',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'duaxe-api-test-')),store=new ClassroomStore(join(dir,'classroom.sqlite'),join(dir,'avatars'));
 const owner=store.createTeacher('owner@example.test','owner-password-long');store.createTeacher('other@example.test','other-password-long');
 const server=createGameServer({origins:['http://test.local'],store,autoTick:false}),sockets:Socket[]=[];server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const addr=server.http.address();assert.ok(addr&&typeof addr==='object');const url='http://127.0.0.1:'+addr.port;
 const api=(path:string,method='GET',body?:unknown,cookie='',headers:Record<string,string>={})=>fetch(url+'/api'+path,{method,headers:{Origin:'http://test.local','Content-Type':'application/json','X-Classroom-Request':'1',Cookie:cookie,...headers},body:body===undefined?undefined:body instanceof Buffer?body:JSON.stringify(body)});
 const connect=async(cookie='')=>{const s=io(url,{autoConnect:false,forceNew:true,transports:['websocket'],extraHeaders:{Origin:'http://test.local',Cookie:cookie},reconnection:false});sockets.push(s);const ready=new Promise<void>((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});s.connect();await ready;return s;};
 const ask=<T=unknown>(s:Socket,payload:unknown)=>new Promise<Reply<T>>((resolve,reject)=>s.timeout(2000).emit('request',payload,(err:Error|null,data:Reply<T>)=>err?reject(err):resolve(data)));
 const ok=async<T=unknown>(s:Socket,payload:unknown)=>{const result=await ask<T>(s,payload);assert.ok(result.ok,result.ok?'':result.error);return result.data;};
 try{
 assert.equal((await api('/classes')).status,401);assert.equal((await api('/login','POST',{email:'owner@example.test',password:'wrong'})).status,401);
 const login=await api('/login','POST',{email:'owner@example.test',password:'owner-password-long'}),cookie=login.headers.get('set-cookie')!.split(';')[0];assert.equal(login.status,200);assert.match(login.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);
 const otherLogin=await api('/login','POST',{email:'other@example.test',password:'other-password-long'}),other=otherLogin.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await api('/classes','POST',{name:'Forbidden'},cookie,{'X-Classroom-Request':'0'})).status,403);assert.equal((await api('/classes','GET',undefined,cookie,{Origin:'https://evil.invalid'})).status,403);
 const cls=(await(await api('/classes','POST',{name:'Lớp Lá'},cookie)).json()).id;
 assert.equal((await api('/classes/'+cls+'/students','GET',undefined,other)).status,400);
 const preview=await api('/classes/'+cls+'/preview?format=csv','POST',Buffer.from('Họ tên,Tên xe\nAn,An\n,Bé\nAn,An'),cookie);assert.equal(preview.status,200);const rows=await preview.json();assert.equal(rows[2].duplicate,true);
 const imported=await(await api('/classes/'+cls+'/import','POST',rows.map((r:{fullName:string;displayName:string})=>({fullName:r.fullName,displayName:r.displayName})),cookie)).json();assert.equal(imported.success,2);assert.equal(imported.errors.length,1);
 const ids=store.students(owner,cls).map(s=>s.id);for(let i=2;i<20;i++)ids.push(store.saveStudent(owner,{classId:cls,fullName:'Full private '+i,displayName:'Bé '+i}));
 const picture=await sharp({create:{width:128,height:128,channels:3,background:'green'}}).png().toBuffer();for(const id of ids){const response=await api('/students/'+id+'/avatar','POST',picture,cookie);assert.equal(response.status,200);}
 const avatar=store.student(owner,ids[0]).avatarId!;assert.equal((await api('/avatars/'+avatar)).status,401);assert.equal((await api('/avatars/'+avatar,'GET',undefined,other)).status,400);const image=await api('/avatars/'+avatar,'GET',undefined,cookie);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');
 const anonymous=await connect();assert.equal((await ask(anonymous,{type:'create',set:defaultSet,classId:cls,studentIds:ids})).ok,false);
 const teacher=await connect(cookie),auth=await ok<Credential>(teacher,{type:'create',set:defaultSet,classId:cls,studentIds:ids}),room=server.rooms.get(auth.code)!;
 const roster=await ok<RoomProfile[]>(anonymous,{type:'preview',code:auth.code});assert.equal(roster.length,20);assert.ok(roster.every(p=>p.avatarData));assert.equal(JSON.stringify(roster).includes('Full private'),false);
 const [one,two]=await Promise.all([connect(),connect()]);const competing=await Promise.all([ask<Credential>(one,{type:'claim',code:auth.code,studentId:ids[0],color:1}),ask<Credential>(two,{type:'claim',code:auth.code,studentId:ids[0],color:2})]);assert.equal(competing.filter(r=>r.ok).length,1);const winner=competing.find(r=>r.ok)!;assert.ok(winner.ok);const firstSocket=competing[0].ok?one:two;
 const clients=await Promise.all(ids.slice(1).map(()=>connect()));const identities=await Promise.all(clients.map((s,i)=>ok<Credential>(s,{type:'claim',code:auth.code,studentId:ids[i+1],color:i+3})));assert.equal(room.players.size,20);
 assert.equal((await ask(clients[0],{type:'release',studentId:ids[0]})).ok,false);
 const released=new Promise<void>(resolve=>firstSocket.once('released',resolve));await ok(teacher,{type:'release',studentId:ids[0],commandId:'release-000001'});await released;assert.equal(room.players.size,19);const fresh=await connect();assert.equal((await ask(fresh,{type:'resume',credential:winner.data})).ok,false);const freshAuth=await ok<Credential>(fresh,{type:'claim',code:auth.code,studentId:ids[0],color:2});assert.notEqual(freshAuth.playerId,winner.data.playerId);await ok(teacher,{type:'release',studentId:ids[0],commandId:'release-000001'});assert.equal(room.players.size,20);assert.equal(room.student(freshAuth.playerId).studentId,ids[0]);
 await ok(teacher,{type:'control',action:'start'});await Promise.all(clients.map(s=>ok(s,{type:'answer',questionId:'sun',optionId:'morning'})));assert.ok([...room.players.values()].filter(p=>p.quiz.totals.correct===1).length===19);
 clients[0].disconnect();await new Promise(r=>setTimeout(r,25));const restored=await connect();await ok(restored,{type:'resume',credential:identities[0]});assert.equal(room.student(identities[0].playerId).quiz.totals.correct,1);assert.equal(room.student(identities[0].playerId).studentId,ids[1]);
 await api('/classes/'+cls,'DELETE',undefined,cookie);assert.equal(store.classes(owner).length,0);assert.equal(room.profiles.length,20);assert.ok(room.profiles[0].avatarData);assert.equal(JSON.stringify(room.frame()).includes('base64'),false);assert.equal(JSON.stringify(room.report()).includes('base64'),false);
 await ok(teacher,{type:'control',action:'end'});const expiredPreview=new Promise<void>(resolve=>anonymous.once('expired',resolve));server.cleanup(room.createdAt+3*3600000);await expiredPreview;assert.equal(server.rooms.size,0);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
