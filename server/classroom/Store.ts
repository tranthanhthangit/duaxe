import { acquireProcessLock } from './ProcessLock';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, unlinkSync, chmodSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { Student, SchoolClass, RoomProfile } from '../../shared/classroom';
export const classInput=z.object({name:z.string().trim().min(1).max(100),schoolYear:z.string().trim().max(40).default('')}).strict();
export const studentInput=z.object({classId:z.string().uuid(),fullName:z.string().trim().min(1).max(100),displayName:z.string().trim().min(1).max(30),status:z.enum(['active','inactive']).default('active')}).strict();
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export class ClassroomStore {
 readonly db!:DatabaseSync;readonly dbPath:string;readonly avatarDir:string;private releaseLock:()=>void;
 constructor(dbPath=process.env.CLASSROOM_DB_PATH??resolve('/workspace/duaxe-data/classroom.sqlite'),avatarDir=process.env.CLASSROOM_AVATAR_DIR??resolve('/workspace/duaxe-data/avatars')){
  this.dbPath=resolve(dbPath);this.avatarDir=resolve(avatarDir);mkdirSync(dirname(this.dbPath),{recursive:true,mode:0o700});mkdirSync(this.avatarDir,{recursive:true,mode:0o700});
  this.releaseLock=acquireProcessLock(this.dbPath);
  try{this.db=new DatabaseSync(this.dbPath);chmodSync(this.dbPath,0o600);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');this.migrate();this.gc();}catch(e){try{this.db!?.close();}finally{this.releaseLock();}throw e;}
 }
 private migrate(){const version=Number(this.db.prepare('PRAGMA user_version').get()!.user_version);if(version>2)throw new Error('Database có phiên bản mới hơn ứng dụng.');if(version===2)return;if(version===1){this.db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE race_sessions(code TEXT PRIMARY KEY,ownerId TEXT REFERENCES teachers(id),classId TEXT,status TEXT NOT NULL,createdAt INTEGER NOT NULL,startedAt INTEGER,finishedAt INTEGER,updatedAt INTEGER NOT NULL,checkpoint TEXT NOT NULL,report TEXT NOT NULL,error TEXT);
 CREATE INDEX race_sessions_owner_date ON race_sessions(ownerId,createdAt);
 CREATE TABLE race_players(roomCode TEXT NOT NULL REFERENCES race_sessions(code) ON DELETE CASCADE,playerId TEXT NOT NULL,studentId TEXT,digest TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(roomCode,playerId),UNIQUE(roomCode,studentId));
 CREATE TABLE race_answers(roomCode TEXT NOT NULL,playerId TEXT NOT NULL,questionId TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(roomCode,playerId,questionId),FOREIGN KEY(roomCode,playerId) REFERENCES race_players(roomCode,playerId) ON DELETE CASCADE);
 PRAGMA user_version=2;COMMIT;`);return;}
 this.db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE teachers(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE sessions(tokenHash TEXT PRIMARY KEY,teacherId TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,expiresAt INTEGER NOT NULL);
 CREATE TABLE classes(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL REFERENCES teachers(id),name TEXT NOT NULL,schoolYear TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
 CREATE TABLE avatars(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL REFERENCES teachers(id),storageKey TEXT NOT NULL UNIQUE,mimeType TEXT NOT NULL,fileSize INTEGER NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE students(id TEXT PRIMARY KEY,classId TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,fullName TEXT NOT NULL,displayName TEXT NOT NULL,avatarId TEXT REFERENCES avatars(id) ON DELETE SET NULL,status TEXT NOT NULL CHECK(status IN ('active','inactive')),createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
 CREATE INDEX students_class ON students(classId); CREATE INDEX classes_owner ON classes(ownerId); PRAGMA user_version=1; COMMIT;`);this.migrate();}
 createTeacher(email:string,password:string){if(!z.string().email().max(150).safeParse(email).success||password.length<12||password.length>200)throw new Error('Email hợp lệ và mật khẩu 12–200 ký tự là bắt buộc.');const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex'),id=randomUUID();this.db.prepare('INSERT INTO teachers VALUES(?,?,?,?)').run(id,email.toLowerCase(),salt+':'+hash,new Date().toISOString());return id;}
 login(email:string,password:string){const teacher=this.db.prepare('SELECT * FROM teachers WHERE email=?').get(email.toLowerCase());const [salt,expected]=String(teacher?.password??'00000000000000000000000000000000:'+ '0'.repeat(128)).split(':');const actual=scryptSync(password,salt,64);if(!teacher||!timingSafeEqual(actual,Buffer.from(expected,'hex')))throw new Error('Email hoặc mật khẩu không đúng.');const token=randomBytes(32).toString('base64url');this.db.prepare('DELETE FROM sessions WHERE expiresAt<?').run(Date.now());this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),String(teacher.id),Date.now()+12*3600000);return token;}
 authenticate(cookie=''){const token=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('teacher_session='))?.slice(16);if(!token)return null;return this.db.prepare('SELECT teacherId FROM sessions WHERE tokenHash=? AND expiresAt>?').get(digest(token),Date.now())?.teacherId as string|undefined??null;}
 logout(cookie=''){const token=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('teacher_session='))?.slice(16);if(token)this.db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(digest(token));}
 ownClass(owner:string,id:string){if(!this.db.prepare('SELECT id FROM classes WHERE id=? AND ownerId=?').get(id,owner))throw new Error('Không tìm thấy lớp hoặc không có quyền.');}
 classes(owner:string){return this.db.prepare('SELECT c.*,COUNT(s.id) studentCount FROM classes c LEFT JOIN students s ON s.classId=c.id WHERE c.ownerId=? GROUP BY c.id ORDER BY c.name').all(owner) as unknown as SchoolClass[];}
 saveClass(owner:string,input:unknown,id?:string){const p=classInput.parse(input),now=new Date().toISOString();if(id){this.ownClass(owner,id);this.db.prepare('UPDATE classes SET name=?,schoolYear=?,updatedAt=? WHERE id=?').run(p.name,p.schoolYear,now,id);}else{id=randomUUID();this.db.prepare('INSERT INTO classes VALUES(?,?,?,?,?,?)').run(id,owner,p.name,p.schoolYear,now,now);}return id;}
 students(owner:string,classId:string){this.ownClass(owner,classId);return this.db.prepare('SELECT * FROM students WHERE classId=? ORDER BY fullName').all(classId) as unknown as Student[];}
 student(owner:string,id:string){const row=this.db.prepare('SELECT s.* FROM students s JOIN classes c ON s.classId=c.id WHERE s.id=? AND c.ownerId=?').get(id,owner);if(!row)throw new Error('Không tìm thấy học sinh hoặc không có quyền.');return row as unknown as Student;}
 saveStudent(owner:string,input:unknown,id?:string){const p=studentInput.parse(input);this.ownClass(owner,p.classId);const now=new Date().toISOString();if(id){this.student(owner,id);this.db.prepare('UPDATE students SET classId=?,fullName=?,displayName=?,status=?,updatedAt=? WHERE id=?').run(p.classId,p.fullName,p.displayName,p.status,now,id);}else{id=randomUUID();this.db.prepare('INSERT INTO students VALUES(?,?,?,?,?,?,?,?)').run(id,p.classId,p.fullName,p.displayName,null,p.status,now,now);}return id;}
 deleteClass(owner:string,id:string){this.ownClass(owner,id);this.db.prepare('DELETE FROM classes WHERE id=?').run(id);this.gc();}
 deleteStudent(owner:string,id:string){this.student(owner,id);this.db.prepare('DELETE FROM students WHERE id=?').run(id);this.gc();}
 removeAvatar(owner:string,id:string){this.student(owner,id);this.db.prepare('UPDATE students SET avatarId=NULL,updatedAt=? WHERE id=?').run(new Date().toISOString(),id);this.gc();}
 avatar(owner:string,id:string){const row=this.db.prepare('SELECT storageKey FROM avatars WHERE id=? AND ownerId=?').get(id,owner);if(!row)throw new Error('Không có quyền truy cập ảnh.');return readFileSync(join(this.avatarDir,String(row.storageKey)));}
 async upload(owner:string,studentId:string,bytes:Buffer){this.student(owner,studentId);if(bytes.length>2*1024*1024)throw new Error('Ảnh tối đa 2 MB.');const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'warning'}),meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)!==1)throw new Error('Chỉ chấp nhận JPG, PNG, WebP tĩnh.');const output=await image.rotate().resize(128,128,{fit:'cover'}).webp({quality:82}).toBuffer();this.student(owner,studentId);
 const id=randomUUID(),key=id+'.webp',file=join(this.avatarDir,key);writeFileSync(file+'.part',output,{mode:0o600,flag:'wx'});renameSync(file+'.part',file);
 try{this.db.exec('BEGIN IMMEDIATE');this.db.prepare('INSERT INTO avatars VALUES(?,?,?,?,?,?)').run(id,owner,key,'image/webp',output.length,new Date().toISOString());this.db.prepare('UPDATE students SET avatarId=?,updatedAt=? WHERE id=?').run(id,new Date().toISOString(),studentId);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');unlinkSync(file);throw e;}this.gc();return id;}
 gc(){const rows=this.db.prepare('SELECT id,storageKey FROM avatars WHERE id NOT IN (SELECT avatarId FROM students WHERE avatarId IS NOT NULL)').all();for(const row of rows){const file=join(this.avatarDir,String(row.storageKey));if(existsSync(file))unlinkSync(file);this.db.prepare('DELETE FROM avatars WHERE id=?').run(row.id!);}}

 profiles(owner:string,classId:string,ids:string[]):RoomProfile[]{this.ownClass(owner,classId);if(ids.length<1||ids.length>20||new Set(ids).size!==ids.length)throw new Error('Chọn 1–20 học sinh khác nhau.');return ids.map(id=>{const s=this.student(owner,id);if(s.classId!==classId||s.status!=='active')throw new Error('Học sinh không thuộc lớp hoặc đã ngừng hoạt động.');return {studentId:s.id,displayName:s.displayName,avatarId:s.avatarId,online:false,...(s.avatarId?{avatarData:'data:image/webp;base64,'+this.avatar(owner,s.avatarId).toString('base64')}:{})};});}
 exportClass(owner:string,id:string){this.ownClass(owner,id);return {version:1,class:this.classes(owner).find(c=>c.id===id),students:this.students(owner,id)};}
 close(){try{this.db.close();}finally{this.releaseLock();}}
}
