import type {SQL} from './Database';
import type {RoomRecord} from '../contracts';
import {updateExistingRoom} from './roomWrite';

/** Caller owns one transaction/client. Initial creation and question reconfiguration
 * retain the existing schema-compatible path; normal commands use one guarded write.
 */
export async function writeRoom(sql:SQL,record:RoomRecord){
 const s=record.checkpoint;if(s.version!==1||record.report.code!==s.code)throw Error('Checkpoint không hợp lệ.');
 if(sql.lockedRoom!==s.code)await sql.query('SELECT pg_advisory_xact_lock(hashtext($1),902)',[s.code]);
 if(await updateExistingRoom(sql,record))return;
 const players=s.players.map(p=>({player_id:p.id,student_id:p.studentId??null,digest:p.digest,state:p}));
 const answers=s.players.flatMap(p=>p.quiz.results.map(r=>({player_id:p.id,question_id:r.questionId,result:r})));
 const receipts=[{role:'teacher',actor_id:'teacher',owner:s.teacher},...s.players.map(p=>({role:'student',actor_id:p.id,owner:p}))].flatMap(p=>p.owner.receipts.map(([command_id,r])=>({role:p.role,actor_id:p.actor_id,command_id,signature:r.signature,data:r.data??null})));
 await sql.query(`INSERT INTO duaxe.race_sessions(code,owner_id,class_id,status,created_at,started_at,finished_at,updated_at,checkpoint_version,sequence,checkpoint,report)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11) ON CONFLICT(code) DO UPDATE SET status=excluded.status,started_at=excluded.started_at,finished_at=excluded.finished_at,updated_at=excluded.updated_at,sequence=excluded.sequence,checkpoint=excluded.checkpoint,report=excluded.report`,[s.code,s.ownerId??null,s.classId??null,s.status,s.createdAt,s.startedAt??null,s.finishedAt??null,Date.now(),s.sequence,JSON.stringify(s),JSON.stringify(record.report)]);
 {
  await sql.query('DELETE FROM duaxe.room_questions WHERE room_code=$1',[s.code]);
  await sql.query(`INSERT INTO duaxe.room_questions(room_code,question_id,position,question) SELECT $1,q.id,q.position,q.question FROM jsonb_to_recordset($2::jsonb) q(id text,position int,question jsonb)`,[s.code,JSON.stringify(s.set.questions.map((q,position)=>({id:q.id,position,question:q})))]);
 }
 await sql.query('DELETE FROM duaxe.race_players WHERE room_code=$1 AND NOT(player_id=ANY($2::uuid[]))',[s.code,players.map(p=>p.player_id)]);
 await sql.query(`INSERT INTO duaxe.race_players(room_code,player_id,student_id,digest,state) SELECT $1,p.player_id,p.student_id,p.digest,p.state FROM jsonb_to_recordset($2::jsonb) p(player_id uuid,student_id uuid,digest text,state jsonb) ON CONFLICT(room_code,player_id) DO UPDATE SET student_id=excluded.student_id,digest=excluded.digest,state=excluded.state`,[s.code,JSON.stringify(players)]);
 await sql.query(`INSERT INTO duaxe.race_answers(room_code,player_id,question_id,result) SELECT $1,a.player_id,a.question_id,a.result FROM jsonb_to_recordset($2::jsonb) a(player_id uuid,question_id text,result jsonb) ON CONFLICT DO NOTHING`,[s.code,JSON.stringify(answers)]);
 await sql.query(`INSERT INTO duaxe.command_receipts(room_code,role,actor_id,command_id,signature,data) SELECT $1,r.role,r.actor_id,r.command_id,r.signature,COALESCE(r.data,'null'::jsonb) FROM jsonb_to_recordset($2::jsonb) r(role text,actor_id text,command_id text,signature text,data jsonb) ON CONFLICT DO NOTHING`,[s.code,JSON.stringify(receipts)]);
}
