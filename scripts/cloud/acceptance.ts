import {isAbsolute,resolve} from 'node:path';
/** Guarded production synthetic smoke/load. No deployment, real-data import or cleanup. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {io,type Socket} from 'socket.io-client';
import sharp from 'sharp';
import {defaultSet} from '../../src/questions/model';
import type {Credential,Reply} from '../../shared/protocol';

async function main(){
 if(process.env.CLOUD_ACCEPTANCE_APPROVED!=='1'||process.env.CLOUD_ACCEPTANCE_TARGET!=='production')throw Error('Explicit synthetic-production-test approval required.');
 const base=new URL(process.env.CLOUD_APP_ORIGIN??'');if(base.protocol!=='https:'||base.origin!==process.env.CLOUD_EXPECTED_APP_ORIGIN||base.pathname!=='/'||base.username||base.password||base.search||base.hash)throw Error('Exact HTTPS target confirmation required.');
 const output=process.env.CLOUD_EVIDENCE_DIR??'';if(!isAbsolute(output)||resolve(output)===process.cwd()||resolve(output).startsWith(process.cwd()+'/'))throw Error('Set a private absolute evidence directory outside repository.');
 const expectedTeacher=process.env.CLOUD_TEST_TEACHER_ID;if(!expectedTeacher)throw Error('Confirm the dedicated synthetic teacher ID.');
 const token=process.env.CLOUD_TEST_TEACHER_TOKEN??'';if(!/^eyJ[A-Za-z0-9_.-]{20,8192}$/.test(token))throw Error('Actual short-lived JWT required in private runner environment, not an HTTP proxy placeholder.');
 const access:Record<string,string>=process.env.CF_ACCESS_CLIENT_ID&&process.env.CF_ACCESS_CLIENT_SECRET?{'CF-Access-Client-Id':process.env.CF_ACCESS_CLIENT_ID,'CF-Access-Client-Secret':process.env.CF_ACCESS_CLIENT_SECRET}:{};
 const api=async<T,>(path:string,method='GET',body?:unknown):Promise<T>=>{
  const bytes=body instanceof Uint8Array,response=await fetch(base.origin+'/api'+path,{method,headers:{...access,Authorization:'Bearer '+token,'X-Classroom-Request':'1',...(body&&!bytes?{'Content-Type':'application/json'}:{})},body:body?(bytes?new Uint8Array(body):JSON.stringify(body)):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error('API smoke request failed');return response.json();
 };
 assert.equal((await api<{id:string}>('/me')).id,expectedTeacher);
 const batch=randomUUID(),cls=await api<{id:string}>('/classes','POST',{name:'KIỂM THỬ '+batch.slice(0,8),schoolYear:'SYNTHETIC ONLY'}),ids:string[]=[];
 for(let i=0;i<20;i++){const student=await api<{id:string}>('/students','POST',{classId:cls.id,fullName:'Dữ liệu giả '+i,displayName:'Thử '+i});ids.push(student.id);const image=await sharp({create:{width:128,height:128,channels:3,background:['pink','skyblue','gold','palegreen'][i%4]}}).webp().toBuffer();await api('/students/'+student.id+'/avatar','POST',new Uint8Array(image));}
 const sockets:Socket[]=[],connect=async(auth:Record<string,string>={})=>{const socket=io(base.origin,{autoConnect:false,transports:['websocket'],reconnection:false,auth,extraHeaders:access});sockets.push(socket);await new Promise<void>((r,j)=>{socket.once('connect',r);socket.once('connect_error',j);socket.connect();});return socket;};
 const ask=<T,>(socket:Socket,value:unknown)=>new Promise<T>((r,j)=>socket.timeout(15000).emit('request',value,(e:Error|null,result:Reply<T>)=>e||!result.ok?j(Error('Socket request failed')):r(result.data)));
 try{
  const teacher=await connect({teacherToken:token}),owner=await ask<Credential>(teacher,{type:'create',set:defaultSet,classId:cls.id,studentIds:ids});const invite=await api<{token:string}>('/rooms/'+owner.code+'/invite','POST');
  const clients=await Promise.all(ids.map(()=>connect({invite:invite.token}))),credentials=await Promise.all(clients.map((s,i)=>ask<Credential>(s,{type:'claim',code:owner.code,studentId:ids[i],color:i})));await ask(teacher,{type:'control',action:'start'});
  const times:number[]=[];await Promise.all(clients.map(async(s,i)=>{const payload={type:'answer',questionId:'sun',optionId:'morning',commandId:'production-test-'+i},at=performance.now();await ask(s,payload);times.push(performance.now()-at);await ask(s,payload);}));
  await ask(teacher,{type:'control',action:'pause'});for(let i=0;i<3;i++){clients[i].disconnect();const s=await connect();await ask(s,{type:'resume',credential:credentials[i]});}
  await ask(teacher,{type:'control',action:'resume'});await ask(teacher,{type:'control',action:'end'});
  const report=await api<{players:{correct:number;points:number;answers:unknown[]}[]}>('/history/'+owner.code);assert.equal(report.players.length,20);assert.ok(report.players.every(p=>p.correct===1&&p.points===10&&p.answers.length===1));assert.equal(JSON.stringify(report).includes('base64'),false);
  times.sort((a,b)=>a-b);await mkdir(output,{recursive:true,mode:0o700});await writeFile(output+'/synthetic-acceptance.json',JSON.stringify({batch,syntheticClassId:cls.id,roomCode:owner.code,players:20,duplicatesScored:false,reconnects:3,answerRttMs:{samples:times.length,median:times[Math.floor(times.length/2)],p95:times[Math.ceil(times.length*.95)-1],p99:times[Math.ceil(times.length*.99)-1]},photosExported:false,deleted:0,requiresManualChecks:['20 real devices','Chromium FPS','Render process restart','private bucket/RLS with actual principals','long soak']},null,2),{mode:0o600});
  console.log('Synthetic acceptance passed. Data retained for reviewed cleanup. This does not establish20-device classroom readiness.');
 }finally{sockets.forEach(s=>s.disconnect());}
}
void main().catch(()=>{console.error('Acceptance stopped. Verify reviewed target, approval, private credentials and access gate. Any created synthetic data is retained; no cleanup or real-data migration was attempted.');process.exitCode=1;});
