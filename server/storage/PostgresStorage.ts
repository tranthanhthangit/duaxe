import type {PoolConfig} from 'pg';
import {randomBytes,randomUUID,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {LocalAvatarObjects,type AvatarObjects} from '../cloud/AvatarObjects';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {classInput,studentInput} from '../classroom/Store';
import type {Storage,TeacherRepository,ClassroomRepository,AvatarRepository,RoomRepository,HistoryEntry} from './contracts';
import type {SchoolClass,Student} from '../../shared/classroom';
import {PostgresDatabase,DatabaseError,type SQL} from './postgres/Database';
import {writeRoom} from './postgres/room';
const derive=promisify(scrypt),digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const denied=()=>new Error('Không tìm thấy dữ liệu hoặc không có quyền.');
const iso=(v:unknown)=>new Date(v as string).toISOString();
const studentColumns=`id,class_id "classId",full_name "fullName",display_name "displayName",avatar_id "avatarId",status,created_at "createdAt",updated_at "updatedAt"`;
const student=(r:Record<string,unknown>):Student=>({...r,createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt)} as unknown as Student);
export class PostgresStorage implements Storage {
 readonly db:PostgresDatabase;readonly avatarDir:string;
 readonly teachers:TeacherRepository;readonly classrooms:ClassroomRepository;readonly avatars:AvatarRepository;readonly rooms:RoomRepository;
 static async connect(config:PoolConfig,avatarDir:string,objects?:AvatarObjects){const storage=new PostgresStorage(config,avatarDir,objects);try{await storage.db.start();if(!objects)await mkdir(storage.avatarDir,{recursive:true,mode:0o700});return storage;}catch(e){await storage.close();throw e;}}
 private constructor(config:PoolConfig,avatarDir:string,private objects:AvatarObjects=new LocalAvatarObjects(avatarDir)){
  this.db=new PostgresDatabase(config);this.avatarDir=resolve(avatarDir);const db=this.db;
  const ownClass=async(sql:SQL,owner:string,id:string)=>{if(!(await sql.query('SELECT id FROM duaxe.classes WHERE id=$1 AND owner_id=$2',[id,owner])).rowCount)throw denied();};
  const ownStudent=async(sql:SQL,owner:string,id:string)=>{const r=await sql.query(`SELECT ${studentColumns} FROM duaxe.students WHERE id=$1 AND owner_id=$2`,[id,owner]);if(!r.rowCount)throw denied();return student(r.rows[0]);};
  const saveStudent=async(sql:SQL,owner:string,input:unknown,id?:string)=>{
   const p=studentInput.parse(input);await ownClass(sql,owner,p.classId);const now=new Date().toISOString();
   if(id){const r=await sql.query('UPDATE duaxe.students SET class_id=$1,full_name=$2,display_name=$3,status=$4,updated_at=$5 WHERE id=$6 AND owner_id=$7',[p.classId,p.fullName,p.displayName,p.status,now,id,owner]);if(!r.rowCount)throw denied();}
   else{id=randomUUID();await sql.query('INSERT INTO duaxe.students(id,owner_id,class_id,full_name,display_name,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',[id,owner,p.classId,p.fullName,p.displayName,p.status,now]);}return id;
  };
  this.teachers={
   login:async(email,password)=>{
    const row=(await db.query('SELECT id,password FROM duaxe.teachers WHERE email=$1',[email.toLowerCase()])).rows[0],encoded=String(row?.password??'00000000000000000000000000000000:'+ '0'.repeat(128)),[salt,expected]=encoded.split(':'),actual=await derive(password,salt,64) as Buffer;
    if(!row||expected.length!==128||!timingSafeEqual(actual,Buffer.from(expected,'hex')))throw Error('Email hoặc mật khẩu không đúng.');
    const token=randomBytes(32).toString('base64url');await db.transaction(async sql=>{const current=(await sql.query('SELECT password FROM duaxe.teachers WHERE id=$1 FOR UPDATE',[row.id])).rows[0];if(current?.password!==encoded)throw denied();await sql.query('DELETE FROM duaxe.sessions WHERE expires_at<$1',[Date.now()]);await sql.query('INSERT INTO duaxe.sessions VALUES($1,$2,$3)',[digest(token),row.id,Date.now()+12*3600000]);});return token;
   },
   authenticate:async(cookie='')=>{const token=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('teacher_session='))?.slice(16);if(!token)return null;return (await db.query('SELECT teacher_id FROM duaxe.sessions WHERE token_hash=$1 AND expires_at>$2',[digest(token),Date.now()])).rows[0]?.teacher_id??null;},
   logout:async(cookie='')=>{const token=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('teacher_session='))?.slice(16);if(token)await db.transaction(sql=>sql.query('DELETE FROM duaxe.sessions WHERE token_hash=$1',[digest(token)]));},
  };
  this.classrooms={
   ownClass:(o,id)=>ownClass(db,o,id),
   classes:async owner=>(await db.query(`SELECT c.id,c.name,c.school_year "schoolYear",c.created_at "createdAt",c.updated_at "updatedAt",COUNT(s.id) "studentCount" FROM duaxe.classes c LEFT JOIN duaxe.students s ON s.class_id=c.id WHERE c.owner_id=$1 GROUP BY c.id ORDER BY c.name`,[owner])).rows.map(r=>({...r,createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt),studentCount:Number(r.studentCount)} as SchoolClass)),
   saveClass:async(owner,input,id)=>{const p=classInput.parse(input),now=new Date().toISOString();return db.transaction(async sql=>{if(id){const r=await sql.query('UPDATE duaxe.classes SET name=$1,school_year=$2,updated_at=$3 WHERE id=$4 AND owner_id=$5',[p.name,p.schoolYear,now,id,owner]);if(!r.rowCount)throw denied();}else{id=randomUUID();await sql.query('INSERT INTO duaxe.classes VALUES($1,$2,$3,$4,$5,$5)',[id,owner,p.name,p.schoolYear,now]);}return id;});},
   deleteClass:async(owner,id)=>{await db.transaction(async sql=>{await ownClass(sql,owner,id);await sql.query('DELETE FROM duaxe.classes WHERE id=$1 AND owner_id=$2',[id,owner]);});await this.gc();},
   students:async(owner,id)=>{await ownClass(db,owner,id);return (await db.query(`SELECT ${studentColumns} FROM duaxe.students WHERE class_id=$1 AND owner_id=$2 ORDER BY full_name`,[id,owner])).rows.map(student);},
   student:(o,id)=>ownStudent(db,o,id),saveStudent:(o,input,id)=>db.transaction(sql=>saveStudent(sql,o,input,id)),
   deleteStudent:async(owner,id)=>{await db.transaction(async sql=>{if(!(await sql.query('DELETE FROM duaxe.students WHERE id=$1 AND owner_id=$2',[id,owner])).rowCount)throw denied();});await this.gc();},
   profiles:async(owner,classId,ids)=>{await ownClass(db,owner,classId);if(ids.length<1||ids.length>20||new Set(ids).size!==ids.length)throw Error('Chọn 1–20 học sinh khác nhau.');return Promise.all(ids.map(async id=>{const s=await ownStudent(db,owner,id);if(s.classId!==classId||s.status!=='active')throw denied();return {studentId:s.id,displayName:s.displayName,avatarId:s.avatarId,online:false,...(s.avatarId?{avatarData:'data:image/webp;base64,'+(await this.avatars.read(owner,s.avatarId)).toString('base64')}:{})};}));},
   exportClass:async(owner,id)=>{await ownClass(db,owner,id);return {version:1,class:(await this.classrooms.classes(owner)).find(c=>c.id===id),students:await this.classrooms.students(owner,id)};},
   importStudents:(owner,classId,rows)=>db.transaction(async sql=>{await ownClass(sql,owner,classId);let success=0;const errors:{row:number;error:string}[]=[];for(const [i,row] of rows.entries()){const parsed=studentInput.safeParse({...row,classId,status:'active'});if(!parsed.success){errors.push({row:i+2,error:'Thiếu tên hoặc vượt giới hạn.'});continue;}await saveStudent(sql,owner,parsed.data);success++;}return {success,errors};}),
  };
  this.avatars={
   read:async(owner,id)=>{const row=(await db.query('SELECT storage_key FROM duaxe.avatars WHERE id=$1 AND owner_id=$2',[id,owner])).rows[0];if(!row||!/^[-a-f0-9]+\.webp$/.test(row.storage_key))throw denied();return this.objects.read(owner,row.storage_key);},
   remove:async(owner,id)=>{await db.transaction(async sql=>{if(!(await sql.query('UPDATE duaxe.students SET avatar_id=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2',[id,owner])).rowCount)throw denied();});await this.gc();},
   upload:async(owner,id,bytes)=>{
    await ownStudent(db,owner,id);if(bytes.length>2*1024*1024)throw Error('Ảnh tối đa 2 MB.');const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'warning'}),meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)!==1)throw Error('Chỉ chấp nhận JPG, PNG, WebP tĩnh.');const output=await image.rotate().resize(128,128,{fit:'cover'}).webp({quality:82}).toBuffer(),avatar=randomUUID(),key=avatar+'.webp',file=join(this.avatarDir,key);
    await this.objects.write(owner,key,output);
    try{await db.transaction(async sql=>{await ownStudent(sql,owner,id);await sql.query('INSERT INTO duaxe.avatars(id,owner_id,storage_key,mime_type,file_size,created_at,local_owned) VALUES($1,$2,$3,\'image/webp\',$4,now(),true)',[avatar,owner,key,output.length]);await sql.query('UPDATE duaxe.students SET avatar_id=$1,updated_at=now() WHERE id=$2 AND owner_id=$3',[avatar,id,owner]);});}
    catch(e){if(!(e instanceof DatabaseError&&e.kind==='uncertain-commit'))await this.objects.remove(owner,key).catch(()=>{});throw e;}await this.gc();return avatar;
   },
  };
  this.rooms={
   has:async code=>!!(await db.query('SELECT code FROM duaxe.race_sessions WHERE code=$1',[code])).rowCount,
   save:record=>{const value=structuredClone(record);return db.transaction(sql=>writeRoom(sql,value),'room',value.checkpoint.code);},
   loadActive:async()=>(await db.query("SELECT code,checkpoint FROM duaxe.race_sessions WHERE status IN ('ready','running','paused') AND error IS NULL ORDER BY created_at DESC LIMIT 50")).rows.map(r=>({code:r.code,checkpoint:r.checkpoint})),
   markCorrupt:async code=>{await db.transaction(sql=>sql.query("UPDATE duaxe.race_sessions SET status='corrupt',error='Invalid checkpoint' WHERE code=$1",[code]));},
   expire:async code=>{await db.transaction(sql=>sql.query("UPDATE duaxe.race_sessions SET status='expired' WHERE code=$1 AND status!='finished'",[code]));},
   list:async(owner,id,from,to)=>(await db.query(`SELECT code,class_id "classId",status,created_at "createdAt",started_at "startedAt",finished_at "finishedAt",updated_at "updatedAt",error FROM duaxe.race_sessions WHERE owner_id=$1 AND ($2::text='' OR class_id::text=$2) AND created_at>=$3 AND created_at<=$4 ORDER BY created_at DESC LIMIT 200`,[owner,id,from?Date.parse(from):0,to?Date.parse(to+'T23:59:59.999Z'):8640000000000000])).rows.map(r=>({...r,createdAt:Number(r.createdAt),startedAt:r.startedAt===null?null:Number(r.startedAt),finishedAt:r.finishedAt===null?null:Number(r.finishedAt),updatedAt:Number(r.updatedAt)} as HistoryEntry)),
   report:async(owner,code)=>{const r=(await db.query('SELECT report FROM duaxe.race_sessions WHERE owner_id=$1 AND code=$2',[owner,code])).rows[0];if(!r)throw denied();return r.report;},
   delete:async(owner,code)=>{await db.transaction(async sql=>{const r=(await sql.query('SELECT status FROM duaxe.race_sessions WHERE code=$1 AND owner_id=$2 FOR UPDATE',[code,owner])).rows[0];if(!r||['ready','running','paused'].includes(r.status))throw denied();await sql.query('DELETE FROM duaxe.race_sessions WHERE code=$1 AND owner_id=$2',[code,owner]);});},
  };
 }
 private async gc(){const rows=await this.db.transaction(sql=>sql.query(`DELETE FROM duaxe.avatars a WHERE NOT EXISTS(SELECT 1 FROM duaxe.students s WHERE s.avatar_id=a.id) AND NOT EXISTS(SELECT 1 FROM duaxe.race_players p WHERE p.state->>'avatarId'=a.id::text) AND NOT EXISTS(SELECT 1 FROM duaxe.race_sessions r,jsonb_array_elements(r.checkpoint->'profiles') p WHERE p->>'avatarId'=a.id::text) RETURNING owner_id,storage_key,local_owned`));for(const row of rows.rows)if(row.local_owned)await this.objects.remove(row.owner_id,row.storage_key).catch(()=>{});}
 assertWritable(){this.db.assertWritable();}
 onUnavailable(listener:()=>void){return this.db.onUnavailable(listener);}
 metrics(){return this.db.metrics();}
 async close(){await this.db.close();}
}
