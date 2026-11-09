import {gatewayAllowed,type DeploymentAccess} from './cloud/DeploymentGate';
import type { ClassroomStore } from './classroom/Store';
import { SQLiteStorage } from './storage/SQLiteStorage';
import type { Storage, RoomRecord } from './storage/contracts';
import { RoomQueue } from './runtime/RoomQueue';
import { Samples } from './runtime/Samples';
import { classroomApi } from './classroom/api';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { LIMITS, Room, roomCode, validateSet, verify } from './Room';
import type { Membership, Reply } from '../shared/protocol';
const code = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);
const credential = z.object({code,role:z.enum(['teacher','student']),playerId:z.string().min(1).max(100),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
const requestSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('create'),set:z.unknown(),classId:z.string().uuid().optional(),studentIds:z.array(z.string().uuid()).min(1).max(20).optional()}).strict(),
 z.object({type:z.literal('join'),code,name:z.string().trim().min(1).max(30).refine(s=>!/[\u0000-\u001f\u007f]/.test(s)),color:z.number().int().min(0).max(0xffffff)}).strict(),
 z.object({type:z.literal('preview'),code}).strict(),
 z.object({type:z.literal('recoverTeacher'),code}).strict(),
 z.object({type:z.literal('claim'),code,studentId:z.string().uuid(),color:z.number().int().min(0).max(0xffffff)}).strict(),
 z.object({type:z.literal('release'),studentId:z.string().uuid(),remove:z.boolean().optional()}).strict(),
 z.object({type:z.literal('resume'),credential}).strict(),
 z.object({type:z.literal('configure'),set:z.unknown()}).strict(),
 z.object({type:z.literal('control'),action:z.enum(['start','pause','resume','end'])}).strict(),
 z.object({type:z.literal('answer'),questionId:z.string().min(1).max(100),optionId:z.string().min(1).max(100)}).strict(),
 z.object({type:z.literal('next'),questionId:z.string().min(1).max(100)}).strict(),
 z.object({type:z.literal('lane'),direction:z.union([z.literal(-1),z.literal(1)])}).strict(),
 z.object({type:z.literal('report')}).strict(),
]);
class RateLimit {
 private buckets=new Map<string,{count:number;until:number}>();
 take(key:string,limit:number,window:number,now=Date.now()) {this.prune(now);let bucket=this.buckets.get(key);if(!bucket){if(this.buckets.size>=10000)return false;bucket={count:0,until:now+window};this.buckets.set(key,bucket);}return ++bucket.count<=limit;}
 prune(now=Date.now()){for(const [key,b]of this.buckets)if(b.until<=now)this.buckets.delete(key);}
}
type Operation=ReturnType<typeof requestSchema.parse>;
interface Outcome {data:unknown;after?:()=>void}
export function createGameServer(options:{origins:string[];deployment?:DeploymentAccess;autoTick?:boolean;store?:ClassroomStore;storage?:Storage;persistence?:boolean;shutdownTimeoutMs?:number}) {
 if(options.store&&options.storage)throw new Error('Chỉ chọn một storage adapter.');
 const storage:Storage|undefined=options.storage??(options.store?new SQLiteStorage(options.store):undefined);
 const persistence=options.persistence===false?undefined:storage?.rooms;
 const rooms=new Map<string,Room>(),queue=new RoomQueue(),rate=new RateLimit();
 const lastTick=new Map<string,number>(),lastSaved=new Map<string,number>(),entering=new Set<string>();
 const inFlight=new Set<Promise<unknown>>();
 const ackTimes=new Samples(),saveTimes=new Samples(),checkpointTimes=new Samples(),requestWaits=new Map<string,Samples>(),requestAcks=new Map<string,Samples>();
 const recordTiming=(map:Map<string,Samples>,type:string,ms:number)=>{let samples=map.get(type);if(!samples){samples=new Samples();map.set(type,samples);}samples.add(ms);};
 let storageFault=false,initialized=false,closing=false,aborted=false;
 function track<T>(task:Promise<T>):Promise<T>{inFlight.add(task);void task.then(()=>inFlight.delete(task),()=>inFlight.delete(task));return task;}
 const faultMessage='Lưu trữ gặp lỗi. Phòng đã khóa thao tác; kiểm tra lưu trữ và khởi động lại server.';
 function failStorage(){storageFault=true;io.emit('storage-error',faultMessage);for(const r of rooms.values())if(r.status==='running')r.control('pause');}
 function assertAvailable(){if(storageFault||aborted)throw new Error(faultMessage);try{storage?.assertWritable?.();}catch{failStorage();throw new Error(faultMessage);}}
 async function saveRoom(candidate:Room,checkpoint=false){
  const started=performance.now();
  assertAvailable();candidate.sequence++;
  // Freeze the value before awaiting: queued physics/commands must never mutate this record.
  const record:RoomRecord=structuredClone({checkpoint:candidate.checkpoint(),report:candidate.report()});
  try{await persistence?.save(record);assertAvailable();lastSaved.set(candidate.code,performance.now());}
  catch{failStorage();throw new Error(faultMessage);}
  finally{saveTimes.add(performance.now()-started);if(checkpoint)checkpointTimes.add(performance.now()-started);}
 }
 function forget(code:string){rooms.delete(code);lastTick.delete(code);lastSaved.delete(code);}
 function expireSockets(room:Room){
  io.to('preview:'+room.code).emit('expired');io.in('preview:'+room.code).socketsLeave('preview:'+room.code);
  for(const id of [room.teacher.socketId,...[...room.players.values()].map(p=>p.socketId)])if(id){const s=io.sockets.sockets.get(id);s?.emit('expired');s?.disconnect(true);}
 }
 async function deleteHistory(owner:string,code:string){
  const removed=await queue.run(code,async()=>{
   assertAvailable();const room=rooms.get(code);if(room&&room.status!=='finished')throw new Error('Phòng chưa kết thúc.');
   await storage!.rooms.delete(owner,code);forget(code);return room;
  });
  if(removed)expireSockets(removed);
 }
 const api=storage?classroomApi(storage,options.origins,deleteHistory):null;
 const http=createServer((req,res)=>{
  if(req.url==='/health'){const ok=initialized&&!storageFault&&!closing;res.writeHead(ok?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({ok}));return;}
  if(!gatewayAllowed(options.deployment,req.headers)){res.writeHead(503,{'Cache-Control':'no-store'});res.end('Application access is closed.');return;}
  if(req.url?.startsWith('/api/')){
   if(!api||closing){res.writeHead(503);res.end();return;}
   void track((async()=>{try{await ready;await api(req,res);}catch{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:faultMessage}));}else res.end();}})());return;
  }
  res.writeHead(404);res.end();
 });
 const io=new Server(http,{cors:{origin:options.origins,credentials:true,methods:['GET','POST']},maxHttpBufferSize:10*1024*1024,perMessageDeflate:false,allowRequest:(req,callback)=>callback(null,gatewayAllowed(options.deployment,req.headers)&&(!req.headers.origin||options.origins.includes(req.headers.origin))),pingInterval:10000,pingTimeout:10000});
 const traffic={sentBytes:0,receivedBytes:0};io.engine.on('connection',connection=>{
  connection.on('packetCreate',(packet:{type:string;data?:string|Buffer})=>{if(packet.type==='message')traffic.sentBytes+=Buffer.byteLength(packet.data??'');});
  connection.on('packet',(packet:{type:string;data?:string|Buffer})=>{if(packet.type==='message')traffic.receivedBytes+=Buffer.byteLength(packet.data??'');});
 });
 async function initialize(){
  try{
   for(const record of await persistence?.loadActive()??[]){
    let room:Room;
    try{room=Room.restore(record.checkpoint as ReturnType<Room['checkpoint']>);if(room.code!==record.code)throw new Error('Invalid room code');}
    catch{await persistence!.markCorrupt(record.code);continue;}
    if(room.expired()){await persistence!.expire(room.code);continue;}
    room.profiles=await Promise.all(room.profiles.map(async profile=>{
     if(!room.ownerId||!profile.avatarId||!storage)return profile;
     try{return {...profile,avatarData:'data:image/webp;base64,'+(await storage.avatars.read(room.ownerId,profile.avatarId)).toString('base64')};}
     catch{return {...profile,avatarId:null};}
    }));
    // Storage/network errors here are not checkpoint corruption.
    await saveRoom(room);rooms.set(room.code,room);lastTick.set(room.code,performance.now());
   }
   initialized=true;
  }catch{failStorage();throw new Error(faultMessage);}
 }
 const detachStorage=storage?.onUnavailable?.(()=>failStorage());
 const ready=initialize();void ready.catch(()=>{});
 const teacherCredential=(socket:Socket)=>storage?.teachers.bearerOnly?String(socket.data.authHeader??(typeof socket.handshake.auth.teacherToken==='string'?'Bearer '+socket.handshake.auth.teacherToken:'')):socket.handshake.headers.cookie;
 const member=(socket:Socket)=>socket.data.member as Membership|undefined;
 function roomFor(socket:Socket){const m=member(socket),room=m&&rooms.get(m.code);if(!m||!room||room.expired()||room.owner(m.role,m.playerId).socketId!==socket.id)throw new Error('Phiên không hợp lệ hoặc phòng đã hết hạn.');return {room,m};}
 function publish(room:Room,onlySocket?:string){
  room.sequence++;const shared=room.frame().room;
  if(room.teacher.socketId&&(!onlySocket||room.teacher.socketId===onlySocket))io.to(room.teacher.socketId).volatile.emit('frame',{room:shared});
  for(const [id,p] of room.players){if(!p.socketId||(onlySocket&&p.socketId!==onlySocket))continue;const socket=io.sockets.sockets.get(p.socketId);if(!socket)continue;
   const key=room.status==='ready'?'waiting':String(p.quiz.index);
   if(socket.data.questionKey!==key){socket.data.questionKey=key;socket.emit('question',{code:room.code,sequence:room.sequence,index:p.quiz.index,question:room.status==='ready'?null:room.question(id)});}
   socket.volatile.emit('frame',room.frame(id,shared));
  }
 }
 function attach(socket:Socket,m:Membership){
  if(socket.data.previewCode){void socket.leave('preview:'+socket.data.previewCode);delete socket.data.previewCode;}socket.data.member=m;socket.data.questionKey=undefined;
  if(storage?.teachers.bearerOnly&&m.role==='teacher'){
   let checking=false;
   const audit=setInterval(()=>{
    if(checking||!socket.connected)return;checking=true;const header=teacherCredential(socket);
    void storage.teachers.authenticate(header,{fresh:true}).then(owner=>{
     // Do not disconnect a socket whose token was refreshed while the check awaited.
     if(socket.connected&&teacherCredential(socket)===header&&(!owner||owner!==rooms.get(m.code)?.ownerId))socket.disconnect(true);
    }).catch(()=>{if(socket.connected&&teacherCredential(socket)===header)socket.disconnect(true);}).finally(()=>{checking=false;});
   },10000);audit.unref();socket.once('disconnect',()=>clearInterval(audit));
  }
 }
 function tickCandidate(room:Room,now:number){let remaining=Math.min(.25,Math.max(0,(now-(lastTick.get(room.code)??now))/1000));while(remaining>0){const dt=Math.min(.05,remaining);room.tick(dt);remaining-=dt;}}
 const totalBytes=()=>[...rooms.values()].reduce((sum,r)=>sum+Buffer.byteLength(JSON.stringify(r.set)),0);
 io.use((socket,next)=>{
  if(closing||io.engine.clientsCount>500||!rate.take(`connect:${socket.handshake.address}`,100,60000))return next(new Error('Quá nhiều kết nối hoặc máy chủ đang dừng.'));
  void ready.then(()=>closing?next(new Error('Máy chủ đang dừng.')):next(),()=>next(new Error(faultMessage)));
 });
 async function execute(socket:Socket,request:Operation,commandId:string|undefined):Promise<Outcome>{
  if(request.type==='preview'){
   const room=rooms.get(request.code);if(!room||room.expired())throw new Error('Phòng không tồn tại hoặc đã hết hạn.');
   const invite=String(socket.handshake.auth.invite??'');const invited=storage?.invites&&invite?await storage.invites.verify(request.code,invite):false;
   if(storage?.invites&&(room.status!=='ready'||!rate.take('preview:'+socket.handshake.address,30,60000)||(invite&&!invited)))throw new Error('Liên kết phòng hết hạn hoặc thử quá nhiều lần.');
   if(socket.data.previewCode)void socket.leave('preview:'+socket.data.previewCode);if(!member(socket)){socket.data.previewCode=request.code;void socket.join('preview:'+request.code);}
   return {data:room.profiles.map(p=>{const {avatarData,...metadata}=p;return {...metadata,...(!storage?.invites||invited?{avatarData}:{}),...room.roster().find(r=>r.studentId===p.studentId)};})};
  }
  const entry=['create','join','claim','resume','recoverTeacher'].includes(request.type);
  if(entry){if(member(socket)||entering.has(socket.id))throw new Error('Kết nối này đã có phiên hoặc đang tham gia.');entering.add(socket.id);}
  try{
   // Authentication/profile I/O does not need the room lock. Membership is rechecked inside it.
   let teacherId=storage?.teachers.bearerOnly||['create','recoverTeacher','release'].includes(request.type)?await storage?.teachers.authenticate(teacherCredential(socket),{fresh:member(socket)?.role==='teacher'||request.type==='create'||request.type==='recoverTeacher'||request.type==='resume'&&request.credential.role==='teacher'}):undefined;
   let profiles:Room['profiles']=[];
   if(request.type==='create'&&(request.classId||request.studentIds)){
    if(!storage||!teacherId||!request.classId||!request.studentIds)throw new Error('Đăng nhập giáo viên và chọn lớp, học sinh.');
    profiles=await storage.classrooms.profiles(teacherId,request.classId,request.studentIds);
   }
   const key=request.type==='create'?'$create':request.type==='resume'?request.credential.code:'code' in request?request.code:member(socket)?.code;
   if(!key)throw new Error('Phiên không hợp lệ hoặc phòng đã hết hạn.');
   const queuedAt=performance.now();
   return await queue.run(key,async()=>{
    recordTiming(requestWaits,request.type,performance.now()-queuedAt);
    assertAvailable();if(entry&&member(socket))throw new Error('Kết nối này đã có phiên.');
    if(storage?.teachers.bearerOnly||['create','recoverTeacher','release'].includes(request.type)){const current=await storage?.teachers.authenticate(teacherCredential(socket));if(profiles.length&&current!==teacherId)throw new Error('Phiên giáo viên không còn hợp lệ.');teacherId=current;assertAvailable();}
    let live:Room|undefined,candidate:Room,data:unknown={},membership:Membership|undefined;
    const effects:(()=>void)[]=[];const now=performance.now();
    if(request.type==='create'){
     if(storage?.teachers.bearerOnly&&!teacherId)throw new Error('Vui lòng đăng nhập giáo viên.');
     if(!rate.take(`create:${socket.handshake.address}`,5,60000))throw new Error('Mỗi mạng chỉ tạo tối đa 5 phòng/phút.');
     const set=validateSet(request.set);
     if(rooms.size>=LIMITS.rooms||totalBytes()+Buffer.byteLength(JSON.stringify(set))>LIMITS.totalBytes)throw new Error('Máy chủ đã đủ phòng. Thử lại sau.');
     let code=roomCode();while(rooms.has(code)||await persistence?.has(code))code=roomCode();
     const token=randomBytes(32).toString('base64url');candidate=new Room(code,set,token,socket.id);candidate.ownerId=teacherId??undefined;candidate.classId=request.classId;candidate.profiles=profiles;
     data=candidate.credential('teacher','teacher',token);membership={code,role:'teacher',playerId:'teacher'};
    }else{
     const code=request.type==='resume'?request.credential.code:'code' in request?request.code:member(socket)!.code;
     live=rooms.get(code);if(!live||live.expired())throw new Error('Phòng không tồn tại hoặc đã hết hạn.');
     if(storage?.teachers.bearerOnly&&((request.type==='resume'&&request.credential.role==='teacher')||member(socket)?.role==='teacher'||request.type==='recoverTeacher')&&(!teacherId||teacherId!==live.ownerId))throw new Error('Vui lòng đăng nhập đúng giáo viên sở hữu phòng.');
     if(storage?.invites&&['join','claim'].includes(request.type)&&socket.handshake.auth.invite&&!await storage.invites.verify(code,String(socket.handshake.auth.invite)))throw new Error('Cần liên kết mời hợp lệ của cô.');
     // Check authorization/receipt against committed state before advancing any candidate.
     if(!entry){const {room,m}=roomFor(socket);if(room!==live)throw new Error('Phiên không hợp lệ.');
      if(['configure','control','report','release'].includes(request.type)&&m.role!=='teacher')throw new Error('Chỉ giáo viên được thực hiện lệnh này.');
      if(['answer','next','lane'].includes(request.type)&&m.role!=='student')throw new Error('Chỉ học sinh được thực hiện lệnh này.');
      if(commandId&&['answer','next','lane','control','release'].includes(request.type)){
       const signature=createHash('sha256').update(JSON.stringify(request)).digest('hex'),prior=live.owner(m.role,m.playerId).receipts?.get(commandId);
       if(prior){if(prior.signature!==signature)throw new Error('ID lệnh đã được dùng cho thao tác khác.');publish(live);return {data:prior.data};}
      }
     }
     candidate=live.fork();tickCandidate(candidate,now);
     if(request.type==='join'||request.type==='claim'){
      if(candidate.classId&&request.type==='join')throw new Error('Hãy chọn hồ sơ trong danh sách.');
      const auth=request.type==='claim'?candidate.claim(request.studentId,request.color,socket.id):candidate.join(request.name,request.color,socket.id);
      data=auth;membership={code,role:'student',playerId:auth.playerId};
     }else if(request.type==='resume'){
      const auth=request.credential,owner=candidate.owner(auth.role,auth.playerId);if(!verify(auth.token,owner.digest))throw new Error('Mã phiên không hợp lệ.');
      const old=owner.socketId;owner.socketId=socket.id;if(auth.role==='teacher')candidate.teacherLeftAt=undefined;
      membership={code,role:auth.role,playerId:auth.playerId};data=auth;
      if(old&&old!==socket.id)effects.push(()=>{const previous=io.sockets.sockets.get(old);previous?.emit('replaced');previous?.disconnect(true);});
     }else if(request.type==='recoverTeacher'){
      if(!teacherId||teacherId!==candidate.ownerId)throw new Error('Không có quyền khôi phục phòng.');
      const token=randomBytes(32).toString('base64url'),old=candidate.teacher.socketId;candidate.teacher.digest=createHash('sha256').update(token).digest();candidate.teacher.socketId=socket.id;candidate.teacherLeftAt=undefined;
      membership={code,role:'teacher',playerId:'teacher'};data=candidate.credential('teacher','teacher',token);
      if(old&&old!==socket.id)effects.push(()=>{const previous=io.sockets.sockets.get(old);previous?.emit('replaced');previous?.disconnect(true);});
     }else{
      const m=member(socket)!;
      switch(request.type){
       case 'release':{
        if(!candidate.ownerId||teacherId!==candidate.ownerId)throw new Error('Cần đăng nhập giáo viên sở hữu lớp.');
        const old=candidate.release(request.studentId,request.remove);
        if(request.remove)effects.push(()=>{const avatars=candidate.profiles.map(p=>({studentId:p.studentId,avatarId:p.avatarId,avatarData:p.avatarData}));if(candidate.teacher.socketId)io.to(candidate.teacher.socketId).emit('avatars',avatars);for(const player of candidate.players.values())if(player.socketId)io.to(player.socketId).emit('avatars',storage?.teachers.bearerOnly?avatars.filter(a=>a.studentId===player.studentId):avatars);});
        if(old)effects.push(()=>{const previous=io.sockets.sockets.get(old);if(previous){delete previous.data.member;previous.emit('released');previous.disconnect(true);}});break;
       }
       case 'configure':{const set=validateSet(request.set);if(totalBytes()-Buffer.byteLength(JSON.stringify(candidate.set))+Buffer.byteLength(JSON.stringify(set))>LIMITS.totalBytes)throw new Error('Máy chủ không đủ bộ nhớ cho bộ đề này.');candidate.configure(set);effects.push(()=>socket.emit('settings',candidate.set));break;}
       case 'control':candidate.control(request.action);break;
       case 'answer':data=candidate.answer(m.playerId,request.questionId,request.optionId);break;
       case 'next':candidate.next(m.playerId,request.questionId);break;
       case 'lane':candidate.lane(m.playerId,request.direction);break;
       case 'report':if(candidate.status!=='finished')throw new Error('Kết thúc phòng trước khi xuất kết quả.');return {data:candidate.report()};
      }
      if(commandId&&['answer','next','lane','control','release'].includes(request.type)){
       const owner=candidate.owner(m.role,m.playerId);owner.receipts??=new Map();owner.receipts.set(commandId,{signature:createHash('sha256').update(JSON.stringify(request)).digest('hex'),data});if(owner.receipts.size>128)owner.receipts.delete(owner.receipts.keys().next().value!);
      }
     }
    }
    await saveRoom(candidate);
    // This is the only point where a durable command becomes visible in RAM.
    if(live)live.adopt(candidate);else{live=candidate;rooms.set(live.code,live);}lastTick.set(live.code,now);
    if(membership){attach(socket,membership);effects.push(()=>socket.emit('avatars',candidate.profiles.filter(p=>!storage?.teachers.bearerOnly||membership!.role==='teacher'||p.studentId===candidate.student(membership!.playerId).studentId).map(p=>({studentId:p.studentId,avatarId:p.avatarId,avatarData:p.avatarData}))));if(membership.role==='teacher')effects.push(()=>socket.emit('settings',candidate.set));}
    publish(live,['answer','next','lane'].includes(request.type)?socket.id:undefined);
    return {data,after:()=>{effects.forEach(effect=>effect());if(membership&&!socket.connected)void track(disconnect(socket)).catch(()=>{});}};
   });
  }finally{if(entry)entering.delete(socket.id);}
 }
 async function disconnect(socket:Socket){
  const m=member(socket);if(!m||closing)return;
  await queue.run(m.code,async()=>{
   const room=rooms.get(m.code);if(!room)return;
   if(storageFault){room.disconnect(m.role,m.playerId,socket.id);publish(room);return;}
   // A replaced/removed tab must never pause or overwrite its new owner.
   let owner;try{owner=room.owner(m.role,m.playerId);}catch{return;}if(owner.socketId!==socket.id)return;
   const now=performance.now(),candidate=room.fork();tickCandidate(candidate,now);candidate.disconnect(m.role,m.playerId,socket.id);
   await saveRoom(candidate);room.adopt(candidate);lastTick.set(room.code,now);publish(room);
  });
 }
 io.on('connection',socket=>{
  socket.on('teacher-auth',(raw:unknown,ack:unknown)=>{if(typeof ack!=='function'||!rate.take('auth:'+socket.id,30,60000))return;const header=typeof raw==='string'&&raw.length<=8192?'Bearer '+raw:'';void storage?.teachers.authenticate(header).then(owner=>{if(owner){socket.data.authHeader=header;(ack as Function)({ok:true});}else (ack as Function)({ok:false});}).catch(()=>(ack as Function)({ok:false}));});
  socket.on('request',(raw:unknown,ack:(reply:Reply)=>void)=>queue.external(()=>{
   if(typeof ack!=='function')return;
   void track((async()=>{
    const processingAt=performance.now();let operationType='invalid';
    try{
     if(closing)throw new Error('Máy chủ đang dừng, hãy kết nối lại sau.');assertAvailable();
     if(!rate.take(`socket:${socket.id}`,50,10000)||!rate.take(`ip:${socket.handshake.address}`,1200,10000))throw new Error('Thao tác quá nhanh. Chờ vài giây nhé.');
     const size=Buffer.byteLength(JSON.stringify(raw)??''),large=!!raw&&typeof raw==='object'&&['create','configure'].includes(String((raw as {type?:unknown}).type));
     if(size>(large?LIMITS.setBytes+4096:2048))throw new Error('Thông điệp quá lớn.');
     const {commandId,...operation}=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Record<string,unknown>;
     if(commandId!==undefined&&(typeof commandId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(commandId)))throw new Error('ID lệnh không hợp lệ.');
     const parsed=requestSchema.safeParse(commandId===undefined?raw:operation);if(!parsed.success)throw new Error('Dữ liệu gửi lên không hợp lệ.');
     operationType=parsed.data.type;const result=await execute(socket,parsed.data,commandId as string|undefined);assertAvailable();result.after?.();ack({ok:true,data:result.data});
    }catch(error){ack({ok:false,error:error instanceof Error?error.message:'Không thể xử lý yêu cầu.'});}
    finally{const elapsed=performance.now()-processingAt;ackTimes.add(elapsed);recordTiming(requestAcks,operationType,elapsed);}
   })());
  }));
  socket.on('disconnect',()=>queue.external(()=>{void track(disconnect(socket)).catch(()=>{});}));
 });
 async function advance(now=performance.now()){
  if(!initialized||storageFault||closing)return;
  await Promise.all([...rooms.keys()].filter(code=>!queue.pending(code)).map(code=>queue.run(code,async()=>{
   if(storageFault||closing)return;const room=rooms.get(code);if(!room)return;
   const candidate=room.fork(),answers=[...room.players.values()].reduce((n,p)=>n+p.quiz.results.length,0);tickCandidate(candidate,now);
   const critical=candidate.status!==room.status||[...candidate.players.values()].reduce((n,p)=>n+p.quiz.results.length,0)!==answers;
   if(critical||(candidate.status==='running'&&now-(lastSaved.get(code)??0)>=1000))await saveRoom(candidate,true);
   assertAvailable();room.adopt(candidate);lastTick.set(code,now);publish(room);
  })));
 }
 async function cleanup(now=Date.now()){
  if(!initialized||storageFault||closing)return;rate.prune(now);
  await Promise.all([...rooms.keys()].map(async code=>{
   const expired=await queue.run(code,async()=>{
    if(storageFault||closing)return;const room=rooms.get(code);if(!room||!room.expired(now))return;
    await saveRoom(room.fork());try{await persistence?.expire(code);}catch{failStorage();throw new Error(faultMessage);}forget(code);return room;
   });
   if(expired)expireSockets(expired);
  }));
 }
 const ticker=options.autoTick===false?undefined:setInterval(()=>{void track(advance()).catch(()=>{});},100);
 const cleaner=setInterval(()=>{void track(cleanup()).catch(()=>{});},10000);ticker?.unref();cleaner.unref();
 async function idle(){while(inFlight.size)await Promise.allSettled([...inFlight]);await queue.drain();}
 let closePromise:Promise<void>|undefined,shutdownWork:Promise<void>|undefined;
 function close():Promise<void>{
  if(closePromise)return closePromise;closing=true;if(ticker)clearInterval(ticker);clearInterval(cleaner);
  shutdownWork=(async()=>{
   await ready.catch(()=>{});await idle();
   if(!storageFault)for(const room of rooms.values())try{await queue.run(room.code,async()=>{const candidate=room.fork();await saveRoom(candidate);room.adopt(candidate);});}catch{break;}
   // Engine.IO close() drains its packet buffer before closing the transport.
   // io.close() alone discards connections and can erase a just-committed ACK.
   await Promise.all([...new Set([...io.sockets.sockets.values()].map(socket=>socket.conn))].map(connection=>new Promise<void>(resolve=>{
    if(connection.readyState==='closed'){resolve();return;}
    connection.once('close',()=>resolve());connection.close();
   })));
   await new Promise<void>(resolve=>io.close(()=>resolve()));detachStorage?.();
  })();
  let timer:ReturnType<typeof setTimeout>;
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{aborted=true;io.disconnectSockets(true);http.closeAllConnections();reject(new Error('Hết thời gian chờ shutdown; chưa được đóng storage đang bận.'));},options.shutdownTimeoutMs??5000);});
  closePromise=Promise.race([shutdownWork,deadline]).finally(()=>clearTimeout(timer));return closePromise;
 }
 return {http,io,rooms,traffic,ready,queue,advance,cleanup,idle,close,metrics:()=>({ackProcessingMs:ackTimes.summary(),saveMs:saveTimes.summary(),checkpointMs:checkpointTimes.summary(),requestQueueWaitMs:Object.fromEntries([...requestWaits].map(([type,samples])=>[type,samples.summary()])),requestAckMs:Object.fromEntries([...requestAcks].map(([type,samples])=>[type,samples.summary()]))}),drained:async()=>{await shutdownWork;}};
}
