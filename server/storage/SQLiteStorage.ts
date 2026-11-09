import { ClassroomStore, studentInput } from '../classroom/Store';
import { SessionStore } from '../sessions/SessionStore';
import type { Storage, TeacherRepository, ClassroomRepository, AvatarRepository, RoomRepository, HistoryEntry } from './contracts';

/** Promise boundary, NOT nonblocking SQLite. DatabaseSync/scrypt/files still run on this thread. */
export class SQLiteStorage implements Storage {
 readonly teachers:TeacherRepository;
 readonly classrooms:ClassroomRepository;
 readonly avatars:AvatarRepository;
 readonly rooms:RoomRepository;
 constructor(private readonly store:ClassroomStore) {
  const history=new SessionStore(store);
  this.teachers={login:async(email,password)=>store.login(email,password),authenticate:async(cookie)=>store.authenticate(cookie),logout:async(cookie)=>store.logout(cookie)};
  this.classrooms={
   ownClass:async(owner,id)=>store.ownClass(owner,id),
   classes:async owner=>store.classes(owner),saveClass:async(owner,input,id)=>store.saveClass(owner,input,id),deleteClass:async(owner,id)=>store.deleteClass(owner,id),
   students:async(owner,id)=>store.students(owner,id),student:async(owner,id)=>store.student(owner,id),saveStudent:async(owner,input,id)=>store.saveStudent(owner,input,id),deleteStudent:async(owner,id)=>store.deleteStudent(owner,id),
   profiles:async(owner,id,ids)=>store.profiles(owner,id,ids),exportClass:async(owner,id)=>store.exportClass(owner,id),
   importStudents:async(owner,classId,rows)=>{
    store.ownClass(owner,classId);let success=0;const errors:{row:number;error:string}[]=[];
    store.db.exec('BEGIN IMMEDIATE');
    try{
     rows.forEach((row,i)=>{
      const parsed=studentInput.safeParse({...row,classId,status:'active'});
      if(!parsed.success){errors.push({row:i+2,error:'Thiếu tên hoặc vượt giới hạn.'});return;}
      // Database failures must abort the transaction, not become row-validation warnings.
      store.saveStudent(owner,parsed.data);success++;
     });
     store.db.exec('COMMIT');return {success,errors};
    }catch(error){store.db.exec('ROLLBACK');throw error;}
   },
  };
  this.avatars={read:async(owner,id)=>store.avatar(owner,id),upload:async(owner,id,bytes)=>store.upload(owner,id,bytes),remove:async(owner,id)=>store.removeAvatar(owner,id)};
  this.rooms={
   has:async code=>history.has(code),save:async record=>history.saveRecord(structuredClone(record),true),
   loadActive:async()=>store.db.prepare("SELECT code,checkpoint FROM race_sessions WHERE status IN ('ready','running','paused') AND error IS NULL ORDER BY createdAt DESC LIMIT 50").all().map(row=>{
    let checkpoint:unknown;try{checkpoint=JSON.parse(String(row.checkpoint));}catch{checkpoint=null;}
    return {code:String(row.code),checkpoint};
   }),
   markCorrupt:async code=>{store.db.prepare("UPDATE race_sessions SET error='Invalid checkpoint',status='corrupt' WHERE code=?").run(code);},
   expire:async code=>history.expire(code),
   list:async(owner,id,from,to)=>history.list(owner,id,from,to) as unknown as HistoryEntry[],
   report:async(owner,code)=>history.report(owner,code),delete:async(owner,code)=>history.delete(owner,code),
  };
 }
 async close(){this.store.close();}
}
