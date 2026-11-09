import type { RoomProfile } from '../shared/classroom';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { gridPosition } from '../src/game/perspective';
import { RaceModel } from '../src/game/RaceModel';
import { raceConfig, type RaceStatus } from '../src/game/config';
import { parseQuestionSet, QuestionSession, type QuestionSet } from '../src/questions/model';
import type { Credential, Frame, PlayerView, PublicQuestion, Report, Role } from '../shared/protocol';
export const LIMITS = { players: 20, rooms: 50, setBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, roomLife: 2 * 60 * 60_000, teacherAbsent: 10 * 60_000, finishedLife: 15 * 60_000 };
export const hash = (token: string) => createHash('sha256').update(token).digest();
export function verify(token: string, digest: Buffer) { return timingSafeEqual(hash(token), digest); }
export function validateSet(input: unknown) { if (Buffer.byteLength(JSON.stringify(input) ?? '') > LIMITS.setBytes) throw new Error('Bộ câu hỏi trực tuyến tối đa 8 MB.'); return parseQuestionSet(input); }
interface Owner { receipts?:Map<string,{signature:string;data:unknown}>; digest: Buffer; socketId?: string }
interface Player extends Owner { studentId?:string;avatarId?:string|null; id: string; race: RaceModel; quiz: QuestionSession }
export class Room {
 readonly code: string;
 ownerId?:string; classId?:string; startedAt?:number; recovered=false;
 profiles:RoomProfile[]=[];
 private claims=new Map<string,string>();
 readonly teacher: Owner;
 readonly players = new Map<string, Player>();
 readonly createdAt: number;
 set: QuestionSet;
 status: RaceStatus = 'ready'; elapsed = 0; sequence = 0;
 teacherLeftAt?: number; finishedAt?: number;
 constructor(code: string, set: QuestionSet, teacherToken: string, socketId: string, now = Date.now()) {
  this.code = code; this.set = set; this.createdAt = now; this.teacher = { digest: hash(teacherToken), socketId };
 }
 checkpoint(){
  const owner=(o:Owner)=>({digest:o.digest.toString('hex'),receipts:[...(o.receipts??new Map()).entries()] as [string,{signature:string;data:unknown}][]});
  return {version:1 as const,code:this.code,ownerId:this.ownerId,classId:this.classId,createdAt:this.createdAt,startedAt:this.startedAt,finishedAt:this.finishedAt,set:this.set,status:this.status,elapsed:this.elapsed,sequence:this.sequence,teacher:owner(this.teacher),profiles:this.profiles.map(({avatarData:_,...p})=>p),players:[...this.players.values()].map(p=>({id:p.id,studentId:p.studentId,avatarId:p.avatarId,...owner(p),quiz:p.quiz.checkpoint(),race:{cars:p.race.cars,obstacles:p.race.obstacles,boost:p.race.boost,slow:p.race.slow,elapsed:p.race.elapsed,status:p.race.status}}))};
 }
 static restore(s:ReturnType<Room['checkpoint']>){
  if(s.version!==1||!/^[A-HJ-NP-Z2-9]{6}$/.test(s.code)||!Number.isFinite(s.createdAt)||!Number.isFinite(s.elapsed)||s.elapsed<0||!Number.isInteger(s.sequence)||!['ready','running','paused','finished'].includes(s.status)||!Array.isArray(s.players)||s.players.length>20||!Array.isArray(s.profiles)||s.profiles.length>20)throw new Error('Room checkpoint invalid');
  const room=new Room(s.code,validateSet(s.set),'unused','',s.createdAt);room.ownerId=s.ownerId;room.classId=s.classId;room.startedAt=s.startedAt;room.finishedAt=s.finishedAt;room.elapsed=s.elapsed;room.sequence=s.sequence+1000;room.status=s.status==='running'?'paused':s.status;room.recovered=room.status==='paused';room.teacherLeftAt=Date.now();
  const hydrate=(o:Owner,d:{digest:string;receipts:[string,{signature:string;data:unknown}][]})=>{if(!/^[a-f0-9]{64}$/.test(d.digest)||!Array.isArray(d.receipts)||d.receipts.length>128)throw new Error('Credential checkpoint invalid');o.digest=Buffer.from(d.digest,'hex');o.socketId=undefined;o.receipts=new Map(d.receipts);};
  hydrate(room.teacher,s.teacher);room.profiles=s.profiles.map(p=>({...p,online:false,playerId:undefined}));
  for(const p of s.players){if(room.players.has(p.id)||typeof p.id!=='string'||p.race.cars.length!==1||!p.race.obstacles.every(o=>Number.isFinite(o.distance)&&[0,1,2].includes(o.lane)&&typeof o.hit==='boolean')||!['boost','slow','elapsed'].every(k=>Number.isFinite(p.race[k as 'boost'])&&p.race[k as 'boost']>=0))throw new Error('Player checkpoint invalid');const car=p.race.cars[0];if(car.id!==p.id||!Number.isFinite(car.distance)||car.distance < -1000||car.distance>raceConfig.trackLength||![0,1,2].includes(car.lane)||typeof car.name!=='string'||!Number.isFinite(car.speed))throw new Error('Car checkpoint invalid');const race=new RaceModel(true);Object.assign(race,p.race);const quiz=new QuestionSession(room.set);quiz.restore(p.quiz);const player:Player={id:p.id,studentId:p.studentId,avatarId:p.avatarId,race,quiz,digest:Buffer.alloc(32)};hydrate(player,p);room.players.set(p.id,player);if(p.studentId){if(room.claims.has(p.studentId)||!room.profiles.some(x=>x.studentId===p.studentId))throw new Error('Duplicate profile');room.claims.set(p.studentId,p.id);}}
  room.sync();return room;
 }
 /** In-memory transaction candidate: preserve live clock/status/socket IDs (unlike restore).
  * Question sets and avatar strings are immutable; mutable simulation/results/receipts are copied.
  */
 fork():Room {
  const copy=Object.assign(Object.create(Room.prototype) as Room,this);
  const owner=(o:Owner):Owner=>({...o,digest:Buffer.from(o.digest),receipts:o.receipts?new Map(structuredClone([...o.receipts])):undefined});
  const players=new Map<string,Player>();
  for(const [id,p] of this.players){
   const race=Object.assign(Object.create(RaceModel.prototype) as RaceModel,p.race,{cars:p.race.cars.map(c=>({...c})),obstacles:p.race.obstacles.map(o=>({...o}))});
   const quiz=Object.assign(Object.create(QuestionSession.prototype) as QuestionSession,p.quiz,{results:p.quiz.results.map(r=>({...r}))});
   players.set(id,{...p,...owner(p),race,quiz});
  }
  Object.assign(copy,{teacher:owner(this.teacher),players,profiles:this.profiles.map(p=>({...p})),claims:new Map(this.claims)});
  return copy;
 }
 /** Keep the live Room identity stable for observers; called only after successful commit. */
 adopt(candidate:Room){if(candidate.code!==this.code)throw new Error('Sai phòng khi commit.');Object.assign(this,candidate);}
 credential(role: Role, playerId: string, token: string): Credential { return {code:this.code,role,playerId,token}; }
 join(name: string, color: number, socketId: string) {
  if (this.status !== 'ready') throw new Error('Phòng đã bắt đầu; chỉ phiên cũ được kết nối lại.');
  if (this.players.size >= LIMITS.players) throw new Error('Phòng đã đủ 20 học sinh.');
  const id = randomUUID(), token = randomBytes(32).toString('base64url'), race = new RaceModel(true);
  Object.assign(race.cars[0], {id,name,color,...gridPosition(this.players.size)});
  this.players.set(id, {id,digest:hash(token),socketId,race,quiz:new QuestionSession(this.set)});
  return this.credential('student',id,token);
 }
 claim(studentId:string,color:number,socketId:string){
  const profile=this.profiles.find(p=>p.studentId===studentId);if(!profile)throw new Error('Hồ sơ không có trong phòng.');
  if(this.claims.has(studentId))throw new Error('Bạn này đã tham gia');
  const auth=this.join(profile.displayName,color,socketId);const player=this.student(auth.playerId);player.studentId=studentId;player.avatarId=profile.avatarId;this.claims.set(studentId,auth.playerId);return auth;
 }
 release(studentId:string,remove=false){
  if(this.status!=='ready')throw new Error('Chỉ giải phóng trước khi bắt đầu.');
  const id=this.claims.get(studentId),socketId=id?this.players.get(id)?.socketId:undefined;
  if(id)this.players.delete(id);this.claims.delete(studentId);if(remove)this.profiles=this.profiles.filter(p=>p.studentId!==studentId);
  [...this.players.values()].forEach((p,i)=>Object.assign(p.race.cars[0],gridPosition(i)));
  return socketId;
 }
 roster(){return this.profiles.map(({avatarData:_,...p})=>{const playerId=this.claims.get(p.studentId);return {...p,playerId,online:!!(playerId&&this.players.get(playerId)?.socketId)};});}
 owner(role:Role,id:string) { const owner = role === 'teacher' && id === 'teacher' ? this.teacher : role === 'student' ? this.players.get(id) : undefined; if(!owner)throw new Error('Phiên không hợp lệ.');return owner; }
 configure(input:unknown) {
  if(this.status!=='ready')throw new Error('Chỉ sửa bộ câu hỏi trước khi bắt đầu.');
  this.set=validateSet(input);for(const p of this.players.values())p.quiz=new QuestionSession(this.set);
 }
 control(action:'start'|'pause'|'resume'|'end') {
  if(action==='start'&&this.status==='ready'&&this.players.size>0){this.status='running';this.startedAt??=Date.now();}
  else if(action==='pause'&&this.status==='running')this.status='paused';
  else if(action==='resume'&&this.status==='paused'){this.status='running';this.recovered=false;}
  else if(action==='end'&&this.status!=='finished'){this.status='finished';this.finishedAt=Date.now();}
  else throw new Error('Lệnh không phù hợp với trạng thái phòng.');
  this.sync();
 }
 private sync() {
  for(const p of this.players.values()){
   if(p.race.cars[0].finishTime===undefined)p.race.status=this.status;
   if(this.status!=='running')p.race.cars[0].speed=0;
   p.quiz.sync(this.elapsed,p.race.cars[0].finishTime===undefined?this.status:'finished');
  }
 }
 tick(dt:number) {
  if(this.status!=='running')return;
  this.elapsed+=dt;
  for(const p of this.players.values())p.race.update(dt);
  this.sync();
  if([...this.players.values()].every(p=>p.race.status==='finished')){this.status='finished';this.finishedAt=Date.now();this.sync();}
 }
 student(id:string) {const p=this.players.get(id);if(!p)throw new Error('Không tìm thấy học sinh.');return p;}
 answer(id:string,questionId:string,optionId:string) {
  const p=this.student(id);this.sync();const result=p.quiz.answer(questionId,optionId);
  if(!result)throw new Error('Câu đã trả lời, hết giờ hoặc trò chơi đang dừng.');
  p.race.command({type:result.correct?'boost':'clearBoost'});return result;
 }
 next(id:string,questionId:string) { const p=this.student(id);this.sync();if(p.quiz.current?.id!==questionId||!p.quiz.next())throw new Error('Không thể chuyển câu hỏi.'); }
 lane(id:string,direction:-1|1) {if(this.status!=='running')throw new Error('Cuộc đua chưa chạy.');this.student(id).race.command({type:'lane',direction});}
 disconnect(role:Role,id:string,socketId:string,now=Date.now()) {
  const owner=this.owner(role,id);if(owner.socketId!==socketId)return;
  owner.socketId=undefined;
  if(role==='teacher'){this.teacherLeftAt=now;if(this.status==='running'){this.status='paused';this.sync();}}
 }
 expired(now=Date.now()) {return now>=this.createdAt+LIMITS.roomLife || (this.teacherLeftAt!==undefined&&now>=this.teacherLeftAt+LIMITS.teacherAbsent) || (this.finishedAt!==undefined&&now>=this.finishedAt+LIMITS.finishedLife);}
 question(id:string):PublicQuestion|null {const q=this.student(id).quiz.current;if(!q)return null;const {correctOptionId:_,...publicQuestion}=q;return publicQuestion;}
 frame(id?:string, shared?:Frame['room']):Frame {
  const players:PlayerView[]=shared?.players??[...this.players.values()].map((p,index)=>({...p.race.cars[0],studentId:p.studentId,avatarId:p.avatarId,number:index+1,online:!!p.socketId,rank:0,...p.quiz.totals,points:p.quiz.totals.correct*10,boost:p.race.boost,slow:p.race.slow})).sort((a,b)=>b.distance-a.distance||(a.finishTime??Infinity)-(b.finishTime??Infinity)||a.id.localeCompare(b.id));
  players.forEach((p,i)=>p.rank=i+1);
  const quiz=id?this.student(id).quiz:undefined;
  return {room:shared??{roster:this.ownerId?this.roster():undefined,code:this.code,status:this.status,elapsed:this.elapsed,sequence:this.sequence,teacherOnline:!!this.teacher.socketId,expiresAt:this.createdAt+LIMITS.roomLife,title:this.set.title,totalQuestions:this.set.questions.length,players},...(quiz?{self:{index:quiz.index,remaining:quiz.remaining,complete:!quiz.current,result:quiz.result}}:{})};
 }
 report():Report {return {code:this.code,title:this.set.title,elapsed:this.elapsed,players:this.frame().room.players.map(p=>({...p,answers:this.student(p.id).quiz.results.map(r=>{const q=this.set.questions.find(q=>q.id===r.questionId)!;return {...r,questionText:q.text,selectedText:q.options.find(o=>o.id===r.selectedOptionId)?.text??null,correctText:q.options.find(o=>o.id===q.correctOptionId)!.text};})}))};}
}
export function roomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}
