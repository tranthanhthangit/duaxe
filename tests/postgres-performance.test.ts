import test from 'node:test';
import assert from 'node:assert/strict';
import {pgFixture,postgresEnabled} from './helpers/postgres';
import {Room} from '../server/Room';
import {defaultSet} from '../src/questions/model';
import {writeRoom} from '../server/storage/postgres/room';

const options={skip:!postgresEnabled};
const snapshot=(room:Room)=>structuredClone({checkpoint:room.checkpoint(),report:room.report()});
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
async function until(check:()=>Promise<boolean>){const limit=performance.now()+800;while(!await check()){if(performance.now()>limit)throw Error('Lock wait not observed');await new Promise(r=>setTimeout(r,5));}}

test('PostgreSQL optimized writes insert only new answers/receipts; archive and immutable guards remain',options,async()=>{
 const f=await pgFixture();try{
  const storage=await f.connect(),room=new Room('ABC234',defaultSet,'synthetic-teacher','teacher');
  const auth=room.join('Synthetic',1,'student');room.control('start');room.sequence=1;await storage.rooms.save(snapshot(room));
  await f.pool.query(`CREATE TABLE duaxe.attempts(kind text);
   CREATE FUNCTION duaxe.audit_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
   BEGIN INSERT INTO duaxe.attempts VALUES(TG_TABLE_NAME);RETURN NEW;END $$;
   CREATE TRIGGER attempts BEFORE INSERT ON duaxe.race_answers FOR EACH ROW EXECUTE FUNCTION duaxe.audit_attempt();
   CREATE TRIGGER attempts BEFORE INSERT ON duaxe.command_receipts FOR EACH ROW EXECUTE FUNCTION duaxe.audit_attempt();
   CREATE TRIGGER attempts BEFORE INSERT ON duaxe.race_players FOR EACH ROW EXECUTE FUNCTION duaxe.audit_attempt()`);
  const result=room.answer(auth.playerId,'sun','morning'),player=room.student(auth.playerId);
  player.receipts=new Map([['answer-000001',{signature:'fixed-signature',data:result}]]);room.sequence++;await storage.rooms.save(snapshot(room));
  room.sequence++;await storage.rooms.save(snapshot(room));
  const counts=(await f.pool.query('SELECT kind,count(*) n FROM duaxe.attempts GROUP BY kind ORDER BY kind')).rows;
  assert.deepEqual(counts,[{kind:'command_receipts',n:'1'},{kind:'race_answers',n:'1'}]);
  player.receipts.set('answer-000001',{signature:'changed',data:result});room.sequence++;await assert.rejects(storage.rooms.save(snapshot(room)),/Receipt/);
  player.receipts.clear();room.sequence++;await storage.rooms.save(snapshot(room));
  player.receipts.set('answer-000001',{signature:'fixed-signature',data:result});room.sequence++;await assert.rejects(storage.rooms.save(snapshot(room)),/Receipt/);
  assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.race_answers')).rows[0].n,'1');
 }finally{await f.close();}
});

test('PostgreSQL waiter reads the committed predecessor after the advisory lock, including its answer',options,async()=>{
 const f=await pgFixture(),entered=gate(),release=gate();let first:Promise<void>|undefined,second:Promise<void>|undefined;
 try{
  const storage=await f.connect(),room=new Room('ABC234',defaultSet,'synthetic-teacher','teacher');
  const a=room.join('A',1,'a'),b=room.join('B',2,'b');room.control('start');room.sequence=1;await storage.rooms.save(snapshot(room));
  const one=room.fork();one.answer(a.playerId,'sun','morning');one.sequence=2;
  const two=one.fork();two.answer(b.playerId,'sun','morning');two.sequence=3;
  first=storage.db.transaction(async sql=>{await writeRoom(sql,snapshot(one));entered.resolve();await release.promise;});await entered.promise;
  second=storage.rooms.save(snapshot(two));
  await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'")).rows[0].n)>0);
  release.resolve();await Promise.all([first,second]);
  assert.equal((await f.pool.query('SELECT sequence FROM duaxe.race_sessions')).rows[0].sequence,'3');
  assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.race_answers')).rows[0].n,'2');
 }finally{release.resolve();await Promise.allSettled([first,second].filter(Boolean));await f.close();}
});

test('PostgreSQL optimized path preserves ready-room release and question reconfiguration',options,async()=>{
 const f=await pgFixture();try{
  const storage=await f.connect(),teacher=await f.seedTeacher(),classId=await storage.classrooms.saveClass(teacher.id,{name:'Synthetic'});
  const ids=await Promise.all(['A','B'].map(fullName=>storage.classrooms.saveStudent(teacher.id,{classId,fullName,displayName:fullName})));
  const room=new Room('ABC234',defaultSet,'synthetic-teacher','teacher');room.ownerId=teacher.id;room.classId=classId;room.profiles=await storage.classrooms.profiles(teacher.id,classId,ids);
  ids.forEach((id,i)=>room.claim(id,i,'student-'+i));room.sequence=1;await storage.rooms.save(snapshot(room));
  room.release(ids[0]);room.sequence++;await storage.rooms.save(snapshot(room));
  assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.race_players')).rows[0].n,'1');
  const set=structuredClone(defaultSet);set.questions[0].id='sun-new';room.configure(set);room.sequence++;await storage.rooms.save(snapshot(room));
  assert.equal((await f.pool.query("SELECT count(*) n FROM duaxe.room_questions WHERE question_id='sun-new'")).rows[0].n,'1');
  const auth=room.claim(ids[0],1,'new-student');room.sequence++;await storage.rooms.save(snapshot(room));
  assert.equal((await f.pool.query('SELECT student_id FROM duaxe.race_players WHERE player_id=$1',[auth.playerId])).rows[0].student_id,ids[0]);
 }finally{await f.close();}
});

test('PostgreSQL guarded statement retains JSON-null receipts and rolls back a missing player row',options,async()=>{
 const f=await pgFixture();try{
  const storage=await f.connect(),room=new Room('ABC234',defaultSet,'synthetic-teacher','teacher'),auth=room.join('A',1,'a');room.sequence=1;
  room.teacher.receipts=new Map([['control-000001',{signature:'fixed',data:undefined}]]);await storage.rooms.save(snapshot(room));
  room.sequence++;await storage.rooms.save(snapshot(room));
  assert.equal((await f.pool.query('SELECT data FROM duaxe.command_receipts')).rows[0].data,null);
  await f.pool.query('DELETE FROM duaxe.race_players WHERE player_id=$1',[auth.playerId]);
  room.sequence++;await assert.rejects(storage.rooms.save(snapshot(room)),/Aggregate/);
  assert.equal((await f.pool.query('SELECT sequence FROM duaxe.race_sessions')).rows[0].sequence,'2');
 }finally{await f.close();}
});
