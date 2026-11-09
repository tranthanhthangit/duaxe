import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync,statSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {Room} from '../../Room';
import {canonical,checksum} from './json';
export const tableKeys={teachers:['id'],sessions:['token_hash'],classes:['id'],avatars:['id'],students:['id'],race_sessions:['code'],room_questions:['room_code','question_id'],race_players:['room_code','player_id'],race_answers:['room_code','player_id','question_id'],command_receipts:['room_code','role','actor_id','command_id']} as const;
type Table=keyof typeof tableKeys;type Row=Record<string,unknown>;
const tables=Object.keys(tableKeys) as Table[];
const jsonColumns=new Set(['checkpoint','report','state','result','question','data']);
const key=(table:Table,row:Row)=>canonical(tableKeys[table].map(k=>row[k]));
const normalize=(row:Row)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Date?v.toISOString():typeof v==='string'&&['expires_at','created_at','started_at','finished_at','updated_at','sequence'].includes(k)?Number(v):v]));
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const containsNul=(value:unknown):boolean=>typeof value==='string'?value.includes('\0'):Array.isArray(value)?value.some(containsNul):!!value&&typeof value==='object'?Object.values(value).some(containsNul):false;
export interface SQLiteBundle {version:number;sourceChecksum:string;rows:Record<Table,Row[]>;counts:Record<string,number>}
export function readSQLiteCopy(path:string,confirmedCopy=false):SQLiteBundle {
 if(!confirmedCopy)throw Error('Cần xác nhận nguồn là bản sao SQLite (--source-is-copy).');
 const source=realpathSync(path),originalPath=resolve(process.env.CLASSROOM_DB_PATH??'/workspace/duaxe-data/classroom.sqlite'),original=existsSync(originalPath)?realpathSync(originalPath):originalPath;
 if(source===original||(existsSync(original)&&statSync(source).ino===statSync(original).ino&&statSync(source).dev===statSync(original).dev))throw Error('Không đọc database SQLite gốc bằng công cụ migration.');
 if(existsSync(source+'-wal')&&statSync(source+'-wal').size)throw Error('Nguồn có WAL chưa checkpoint; dùng bản backup nhất quán.');
 const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash(),db=new DatabaseSync(source,{readOnly:true});
 try{
  const version=Number(db.prepare('PRAGMA user_version').get()!.user_version);if(![1,2].includes(version))throw Error('SQLite schema chưa hỗ trợ.');
  if(db.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite integrity/foreign key không đạt.');
  const read=(table:string)=>db.prepare('SELECT * FROM '+table).all() as Row[],rows=Object.fromEntries(tables.map(t=>[t,[]])) as unknown as Record<Table,Row[]>;
  rows.teachers=read('teachers').map(r=>({id:r.id,email:r.email,password:r.password,created_at:r.createdAt}));
  rows.sessions=read('sessions').map(r=>({token_hash:r.tokenHash,teacher_id:r.teacherId,expires_at:r.expiresAt}));
  rows.classes=read('classes').map(r=>({id:r.id,owner_id:r.ownerId,name:r.name,school_year:r.schoolYear,created_at:r.createdAt,updated_at:r.updatedAt}));
  rows.avatars=read('avatars').map(r=>({id:r.id,owner_id:r.ownerId,storage_key:r.storageKey,mime_type:r.mimeType,file_size:r.fileSize,created_at:r.createdAt,local_owned:false}));
  const owners=new Map(rows.classes.map(r=>[r.id,r.owner_id]));
  rows.students=read('students').map(r=>({id:r.id,owner_id:owners.get(r.classId),class_id:r.classId,full_name:r.fullName,display_name:r.displayName,avatar_id:r.avatarId,status:r.status,created_at:r.createdAt,updated_at:r.updatedAt}));
  if(version===2){
   for(const r of read('race_sessions')){
    let cp:ReturnType<Room['checkpoint']>,report:Row;try{cp=JSON.parse(String(r.checkpoint));report=JSON.parse(String(r.report));Room.restore(cp);}catch{throw Error('Checkpoint/report lỗi; dry-run dừng, cần xử lý bản sao có kiểm soát.');}
    if(cp.code!==r.code||report.code!==r.code||!Array.isArray(report.players))throw Error('ID checkpoint/report không khớp.');
    rows.race_sessions.push({code:r.code,owner_id:r.ownerId,class_id:r.classId,status:r.status,created_at:r.createdAt,started_at:r.startedAt,finished_at:r.finishedAt,updated_at:r.updatedAt,checkpoint_version:1,sequence:cp.sequence,checkpoint:cp,report,error:r.error});
    cp.set.questions.forEach((q,position)=>rows.room_questions.push({room_code:r.code,question_id:q.id,position,question:q}));
    for(const actor of [{role:'teacher',id:'teacher',owner:cp.teacher},...cp.players.map(p=>({role:'student',id:p.id,owner:p}))])for(const [command_id,receipt] of actor.owner.receipts)rows.command_receipts.push({room_code:r.code,role:actor.role,actor_id:actor.id,command_id,signature:receipt.signature,data:receipt.data??null});
   }
   rows.race_players=read('race_players').map(r=>({room_code:r.roomCode,player_id:r.playerId,student_id:r.studentId,digest:r.digest,state:JSON.parse(String(r.state))}));
   rows.race_answers=read('race_answers').map(r=>({room_code:r.roomCode,player_id:r.playerId,question_id:r.questionId,result:JSON.parse(String(r.result))}));
   for(const room of rows.race_sessions){const cp=room.checkpoint as ReturnType<Room['checkpoint']>,players=rows.race_players.filter(p=>p.room_code===room.code);if(players.length!==cp.players.length)throw Error('Số player trong checkpoint không khớp.');
    for(const p of cp.players){if(!players.some(r=>r.player_id===p.id&&canonical(r.state)===canonical(p)))throw Error('Player state không khớp checkpoint.');for(const a of p.quiz.results)if(!rows.race_answers.some(r=>r.room_code===room.code&&r.player_id===p.id&&r.question_id===a.questionId&&canonical(r.result)===canonical(a)))throw Error('Answer không khớp checkpoint.');}
    if(rows.race_answers.filter(r=>r.room_code===room.code).length!==cp.players.reduce((n,p)=>n+p.quiz.results.length,0))throw Error('Số answer không khớp.');
   }
  }
  for(const table of tables){const seen=new Set<string>();for(const row of rows[table]){
   const identity=key(table,row);if(seen.has(identity))throw Error('Trùng khóa nguồn.');seen.add(identity);
   if(containsNul(row))throw Error('PostgreSQL JSONB không nhận NUL; không tự sửa nguồn.');
   for(const [name,value] of Object.entries(row)){if(value!==null&&['id','owner_id','teacher_id','class_id','avatar_id','player_id','student_id'].includes(name)&&!uuid(value))throw Error('ID nguồn không phải UUID hợp lệ.');if(name.endsWith('_at')&&typeof value==='string'){if(!Number.isFinite(Date.parse(value)))throw Error('Timestamp nguồn không hợp lệ.');row[name]=new Date(value).toISOString();}}
   if(table==='avatars'&&!/^[a-f0-9-]+\.webp$/.test(String(row.storage_key)))throw Error('Đường dẫn avatar nguồn không an toàn.');
  }}
  if(hash()!==before)throw Error('Nguồn thay đổi khi đọc; không dùng bản copy đang ghi.');
  return {version,sourceChecksum:before,rows,counts:Object.fromEntries(tables.map(t=>[t,rows[t].length]))};
 }finally{db.close();}
}
export async function verifyBundle(client:Pool|PoolClient,bundle:SQLiteBundle){
 for(const table of tables)for(const row of bundle.rows[table]){
  const cols=Object.keys(row),keys=tableKeys[table],where=keys.map((k,i)=>`${k}=$${i+1}`).join(' AND '),r=await client.query(`SELECT ${cols.join(',')} FROM duaxe.${table} WHERE ${where}`,keys.map(k=>row[k]));
  if(r.rowCount!==1||canonical(normalize(r.rows[0]))!==canonical(row))throw Error('Đối chiếu dữ liệu migration không đạt.');
 }
 return bundle.counts;
}
async function snapshotHash(client:PoolClient){const state:Record<string,unknown>={};for(const table of tables){const r=await client.query(`SELECT * FROM duaxe.${table}`);state[table]=r.rows.map(normalize).sort((a,b)=>key(table,a).localeCompare(key(table,b)));}for(const table of ['teacher_auth_links','room_invites','teacher_auth_revocations','auth_migration_batches','auth_migration_items','teacher_auth_cutoffs','teacher_profiles']){if((await client.query('SELECT to_regclass($1) name',['duaxe.'+table])).rows[0].name){const rows=(await client.query('SELECT * FROM duaxe.'+table)).rows.map(normalize);state[table]=rows.sort((a,b)=>canonical(a).localeCompare(canonical(b)));}}return checksum(state);}
async function migrationSession(pool:Pool,expectedDatabase:string){
 if(!expectedDatabase)throw Error('Cần tên database staging đích được xác nhận.');const client=await pool.connect();
 try{if((await client.query('SELECT current_database() name')).rows[0].name!==expectedDatabase)throw Error('Database đích không khớp allowlist.');await client.query("BEGIN; SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='30000ms'; SET LOCAL synchronous_commit=on");if(!(await client.query('SELECT pg_try_advisory_xact_lock(924,901) allowed')).rows[0].allowed)throw Error('Writer đang chạy; dừng staging trước migration.');return client;}
 catch(e){await client.query('ROLLBACK').catch(()=>{});client.release();throw e;}
}
export async function importBundle(pool:Pool,bundle:SQLiteBundle,options:{apply?:boolean;batchId:string;expectedDatabase:string}){
 if(!uuid(options.batchId))throw Error('Batch ID phải là UUID.');const client=await migrationSession(pool,options.expectedDatabase);
 try{
  const existing=await client.query('SELECT source_checksum,status FROM duaxe.migration_batches WHERE id=$1',[options.batchId]);
  if(existing.rowCount){if(existing.rows[0].source_checksum!==bundle.sourceChecksum||existing.rows[0].status!=='applied')throw Error('Batch đã dùng cho nguồn hoặc trạng thái khác.');await verifyBundle(client,bundle);await client.query('ROLLBACK');return {dryRun:!options.apply,batchId:options.batchId,counts:bundle.counts,alreadyApplied:true};}
  const additions:{table:Table;row:Row}[]=[];
  for(const table of tables)for(const row of bundle.rows[table]){
   const cols=Object.keys(row),keys=tableKeys[table],where=keys.map((k,i)=>`${k}=$${i+1}`).join(' AND '),old=await client.query(`SELECT ${cols.join(',')} FROM duaxe.${table} WHERE ${where}`,keys.map(k=>row[k]));
   if(old.rowCount){if(canonical(normalize(old.rows[0]))!==canonical(row))throw Error('ID đích đã có nội dung khác; không ghi đè.');}else additions.push({table,row});
  }
  await client.query('INSERT INTO duaxe.migration_batches(id,source_checksum,manifest,status) VALUES($1,$2,$3,\'applied\')',[options.batchId,bundle.sourceChecksum,JSON.stringify({counts:bundle.counts})]);
  for(const {table,row} of additions){const cols=Object.keys(row);await client.query(`INSERT INTO duaxe.${table}(${cols.join(',')}) VALUES(${cols.map((k,i)=>'$'+(i+1)+(jsonColumns.has(k)?'::jsonb':'')).join(',')})`,cols.map(k=>jsonColumns.has(k)?JSON.stringify(row[k]):row[k]));await client.query('INSERT INTO duaxe.migration_items VALUES($1,$2,$3,$4)',[options.batchId,table,key(table,row),checksum(row)]);}
  await verifyBundle(client,bundle);const targetCounts:Record<string,number>={};for(const table of tables)targetCounts[table]=Number((await client.query(`SELECT count(*) n FROM duaxe.${table}`)).rows[0].n);
  if(!options.apply){await client.query('ROLLBACK');return {dryRun:true,batchId:options.batchId,counts:bundle.counts,targetCounts,rowsToCreate:additions.length,verified:true};}
  const targetChecksum=await snapshotHash(client);await client.query('UPDATE duaxe.migration_batches SET manifest=$1 WHERE id=$2',[JSON.stringify({counts:bundle.counts,targetChecksum}),options.batchId]);await client.query('COMMIT');
  return {dryRun:false,batchId:options.batchId,counts:bundle.counts,targetCounts,rowsCreated:additions.length,verified:true};
 }catch{await client.query('ROLLBACK').catch(()=>{});throw Error('Migration chưa được xác nhận. Đã yêu cầu rollback; nếu mất phản hồi COMMIT, kiểm tra batch trước khi chạy lại.');}finally{client.release();}
}
export async function rollbackBatch(pool:Pool,batchId:string,expectedDatabase:string){
 const client=await migrationSession(pool,expectedDatabase);try{
  const batch=(await client.query('SELECT status,manifest FROM duaxe.migration_batches WHERE id=$1 FOR UPDATE',[batchId])).rows[0];if(!batch)throw Error('Không có batch.');if(batch.status==='rolled_back'){await client.query('ROLLBACK');return {alreadyRolledBack:true};}
  if(await snapshotHash(client)!==batch.manifest.targetChecksum)throw Error('Dữ liệu đích đã đổi; từ chối rollback tự động.');
  const items=(await client.query('SELECT table_name,row_key,row_checksum FROM duaxe.migration_items WHERE batch_id=$1',[batchId])).rows;
  for(const table of [...tables].reverse())for(const item of items.filter(i=>i.table_name===table)){const values=JSON.parse(item.row_key),where=tableKeys[table].map((k,i)=>`${k}=$${i+1}`).join(' AND ');await client.query(`DELETE FROM duaxe.${table} WHERE ${where}`,values);}
  await client.query("UPDATE duaxe.migration_batches SET status='rolled_back' WHERE id=$1",[batchId]);await client.query('COMMIT');return {rolledBack:true};
 }catch{await client.query('ROLLBACK').catch(()=>{});throw Error('Rollback bị từ chối hoặc không hoàn tất; không xóa dữ liệu đã thay đổi.');}finally{client.release();}
}
