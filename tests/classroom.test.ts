import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { ClassroomStore } from '../server/classroom/Store';
import { parseRoster } from '../server/classroom/import';
import { backup, restore, verifyBackup } from '../server/classroom/cli';
import { Room } from '../server/Room';
import { defaultSet } from '../src/questions/model';
function fixture(){const dir=mkdtempSync(join(tmpdir(),'duaxe-classroom-test-'));const store=new ClassroomStore(join(dir,'classroom.sqlite'),join(dir,'avatars'));const owner=store.createTeacher('teacher@example.test','test-password-long'),other=store.createTeacher('other@example.test','other-password-long');return {dir,store,owner,other,close(){store.close();rmSync(dir,{recursive:true,force:true});}};}
const picture=()=>sharp({create:{width:240,height:160,channels:3,background:'#51a980'}}).jpeg().withMetadata().toBuffer();
test('persistent classrooms and students: scoped CRUD, transfer and duplicate names use different IDs',()=>{
 const h=fixture();try{const {store:s,owner:o,other}=h;const a=s.saveClass(o,{name:'Lớp Lá',schoolYear:'2026–27'}),b=s.saveClass(o,{name:'Lớp Mầm'});s.saveClass(o,{name:'Lá 1',schoolYear:'2026–27'},a);assert.equal(s.classes(o)[0].name,'Lá 1');
 const input={classId:a,fullName:'Nguyễn Minh An',displayName:'Minh An'},x=s.saveStudent(o,input),y=s.saveStudent(o,input);assert.notEqual(x,y);assert.equal(s.classes(o).find(c=>c.id===a)?.studentCount,2);
 assert.throws(()=>s.student(other,x));assert.throws(()=>s.saveStudent(other,{...input,classId:b},x));assert.throws(()=>s.deleteClass(other,a));
 s.saveStudent(o,{...input,classId:b,displayName:'An'},x);assert.equal(s.student(o,x).classId,b);s.deleteStudent(o,y);assert.equal(s.students(o,a).length,0);s.deleteClass(o,a);assert.equal(s.classes(o).length,1);s.deleteClass(o,b);assert.throws(()=>s.student(o,x));
 }finally{h.close();}
});
test('avatar decode limits, EXIF removal, replacement, restart persistence and deletion',async()=>{
 const h=fixture();let closed=false;try{const {store:s,owner:o}=h;const cls=s.saveClass(o,{name:'Mầm'}),id=s.saveStudent(o,{classId:cls,fullName:'An',displayName:'An'});
 await assert.rejects(s.upload(o,id,Buffer.from('<svg><script/></svg>')));await assert.rejects(s.upload(o,id,Buffer.alloc(2*1024*1024+1)));await assert.rejects(s.upload(h.other,id,await picture()));
 const large=await sharp({create:{width:4100,height:4000,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(s.upload(o,id,large));
 const first=await s.upload(o,id,await picture()),meta=await sharp(s.avatar(o,first)).metadata();assert.equal(meta.width,128);assert.equal(meta.height,128);assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.throws(()=>s.avatar(h.other,first));
 const second=await s.upload(o,id,await picture());assert.notEqual(first,second);assert.equal(existsSync(join(s.avatarDir,first+'.webp')),false);
 const token=s.login('teacher@example.test','test-password-long');assert.equal(s.authenticate('teacher_session='+token),o);s.logout('teacher_session='+token);assert.equal(s.authenticate('teacher_session='+token),null);
 assert.throws(()=>new ClassroomStore(s.dbPath,s.avatarDir));s.close();closed=true;
 const restarted=new ClassroomStore(s.dbPath,s.avatarDir);try{assert.equal(restarted.student(o,id).avatarId,second);assert.ok(restarted.avatar(o,second).length);restarted.removeAvatar(o,id);assert.equal(restarted.student(o,id).avatarId,null);assert.equal(readdirSync(restarted.avatarDir).length,0);}finally{restarted.close();}
 }finally{if(!closed)h.store.close();rmSync(h.dir,{recursive:true,force:true});}
});
test('CSV/XLSX preview preserves Vietnamese, missing names and duplicate warnings without merging',async()=>{
 const csv=await parseRoster(Buffer.from('\uFEFFHọ và tên,Tên hiển thị\nNguyễn An,An\nNguyễn An,An 2\n,Bé\nTrần Tú,Tú'),'csv',['Trần Tú']);assert.equal(csv.length,4);assert.equal(csv[0].duplicate,false);assert.equal(csv[1].duplicate,true);assert.ok(csv[2].error);assert.equal(csv[3].duplicate,true);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Lá');sheet.addRows([['Họ và tên','Tên hiển thị'],['Nguyễn An','An'],['','Không tên'],['Nguyễn An','An']]);const xlsx=await parseRoster(Buffer.from(await book.xlsx.writeBuffer()),'xlsx',[]);assert.equal(xlsx[0].fullName,'Nguyễn An');assert.ok(xlsx[1].error);assert.equal(xlsx[2].duplicate,true);await assert.rejects(parseRoster(Buffer.alloc(2*1024*1024+1),'csv',[]));
});
test('consistent backup/restore includes DB and avatars, excludes sessions, rejects overwrite and corruption',async()=>{
 const h=fixture();try{const {store:s,owner:o}=h;const cls=s.saveClass(o,{name:'Lá'}),id=s.saveStudent(o,{classId:cls,fullName:'Bé A',displayName:'A'}),avatar=await s.upload(o,id,await picture());s.login('teacher@example.test','test-password-long');
 const target=join(h.dir,'backup');backup(s,target);verifyBackup(target);assert.throws(()=>backup(s,target));const restored=join(h.dir,'restored');restore(target,restored);assert.throws(()=>restore(target,restored));const copy=new ClassroomStore(join(restored,'classroom.sqlite'),join(restored,'avatars'));try{assert.equal(copy.student(o,id).avatarId,avatar);assert.deepEqual(copy.avatar(o,avatar),s.avatar(o,avatar));assert.equal(copy.db.prepare('SELECT COUNT(*) n FROM sessions').get()!.n,0);}finally{copy.close();}
 writeFileSync(join(target,'avatars',avatar+'.webp'),'corrupt');assert.throws(()=>verifyBackup(target));
 }finally{h.close();}
});
test('room profiles survive source deletion; claims atomic, reconnect identity and 20 avatar mappings stay stable across ranks',async()=>{
 const h=fixture();try{const {store:s,owner:o}=h,cls=s.saveClass(o,{name:'Lá'});const ids:string[]=[];for(let i=0;i<20;i++){const id=s.saveStudent(o,{classId:cls,fullName:'Cùng tên',displayName:'Bé '+i});await s.upload(o,id,await picture());ids.push(id);}
 const room=new Room('ABC234',defaultSet,'secret','teacher');room.ownerId=o;room.profiles=s.profiles(o,cls,ids);const auth=ids.map((id,i)=>room.claim(id,i,'socket'+i));assert.throws(()=>room.claim(ids[0],3,'intruder'),/đã tham gia/);s.deleteClass(o,cls);assert.equal(s.classes(o).length,0);assert.ok(room.profiles.every(p=>p.avatarData));
 const before=room.frame().room.players;room.control('start');auth.forEach((a,i)=>room.answer(a.playerId,'sun',i%2?'morning':'night'));for(let i=0;i<60;i++)room.tick(.05);const after=room.frame().room.players;for(const p of after){assert.equal(p.studentId,before.find(x=>x.id===p.id)?.studentId);assert.equal(p.avatarId,room.profiles.find(x=>x.studentId===p.studentId)?.avatarId);}assert.ok(before.find(p=>p.id===auth[3].playerId)!.rank>before.find(p=>p.id===auth[0].playerId)!.rank);assert.ok(after.find(p=>p.id===auth[3].playerId)!.rank<after.find(p=>p.id===auth[0].playerId)!.rank);assert.equal(JSON.stringify(room.frame()).includes('base64'),false);assert.equal(JSON.stringify(room.report()).includes('base64'),false);
 room.disconnect('student',auth[0].playerId,'socket0');assert.equal(room.student(auth[0].playerId).quiz.results.length,1);assert.throws(()=>room.release(ids[0]));
 }finally{h.close();}
});
