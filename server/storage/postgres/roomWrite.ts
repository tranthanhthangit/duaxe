import type {SQL} from './Database';
import {StaleCheckpointError,type RoomRecord} from '../contracts';

/** One parameterized statement derives relational rows from the checkpoint once.
 * The caller MUST acquire the room advisory lock in an earlier statement, so a
 * waiter gets a fresh READ COMMITTED snapshot here. No mutation runs until the
 * locked previous aggregate, immutable answers and receipt archive all validate.
 */
export async function updateExistingRoom(sql:SQL,record:RoomRecord):Promise<boolean>{
 const s=record.checkpoint;
 const result=await sql.query(`/* room-write */
 WITH previous AS MATERIALIZED (
  SELECT code,sequence,checkpoint,status,owner_id,class_id FROM duaxe.race_sessions WHERE code=$1 FOR UPDATE
 ), previous_ids AS MATERIALIZED (
  SELECT (p->>'id')::uuid player_id FROM previous,jsonb_array_elements(checkpoint->'players') p
 ), players AS MATERIALIZED (
  SELECT (p->>'id')::uuid player_id,(p->>'studentId')::uuid student_id,p->>'digest' digest,p state
  FROM jsonb_array_elements($2::jsonb->'players') p
 ), incoming_answers AS MATERIALIZED (
  SELECT p.player_id,r->>'questionId' question_id,r result FROM players p,jsonb_array_elements(p.state#>'{quiz,results}') r
 ), incoming_receipts AS MATERIALIZED (
  SELECT 'teacher' role,'teacher' actor_id,r->>0 command_id,r#>>'{1,signature}' signature,COALESCE(r#>'{1,data}','null'::jsonb) data
  FROM jsonb_array_elements($2::jsonb#>'{teacher,receipts}') r
  UNION ALL
  SELECT 'student',p.player_id::text,r->>0,r#>>'{1,signature}',COALESCE(r#>'{1,data}','null'::jsonb)
  FROM players p,jsonb_array_elements(p.state->'receipts') r
 ), prior_keys AS MATERIALIZED (
  SELECT 'teacher' role,'teacher' actor_id,r->>0 command_id FROM previous,jsonb_array_elements(checkpoint#>'{teacher,receipts}') r
  UNION ALL
  SELECT 'student',p->>'id',r->>0 FROM previous,jsonb_array_elements(checkpoint->'players') p,jsonb_array_elements(p->'receipts') r
 ), stored_receipts AS MATERIALIZED (
  SELECT r.*,i.signature incoming_signature,i.data incoming_data
  FROM duaxe.command_receipts r JOIN incoming_receipts i USING(role,actor_id,command_id) WHERE r.room_code=$1
 ), validation AS MATERIALIZED (
  SELECT code,sequence<$5 sequence_valid,
   (owner_id IS NOT DISTINCT FROM $6::uuid) AND (class_id IS NOT DISTINCT FROM $7::uuid) owner_valid,
   status='ready' configurable,checkpoint->'set'=$2::jsonb->'set' set_matches,
   NOT EXISTS(SELECT 1 FROM duaxe.race_answers a LEFT JOIN incoming_answers i USING(player_id,question_id)
    WHERE a.room_code=$1 AND (i.player_id IS NULL OR a.result IS DISTINCT FROM i.result)) answers_valid,
   NOT EXISTS(SELECT 1 FROM stored_receipts r LEFT JOIN prior_keys p USING(role,actor_id,command_id)
    WHERE p.command_id IS NULL OR r.signature IS DISTINCT FROM r.incoming_signature OR r.data IS DISTINCT FROM r.incoming_data) receipts_valid
  FROM previous
 ), saved AS (
  UPDATE duaxe.race_sessions s SET status=$8,started_at=$9,finished_at=$10,updated_at=$4,sequence=$5,checkpoint=$2::jsonb,report=$3::jsonb
  FROM validation v WHERE s.code=v.code AND v.sequence_valid AND v.owner_valid AND v.set_matches AND v.answers_valid AND v.receipts_valid RETURNING s.code
 ), removed AS (
  DELETE FROM duaxe.race_players WHERE room_code=$1 AND NOT(player_id IN (SELECT player_id FROM players))
   AND EXISTS(SELECT 1 FROM saved) RETURNING player_id
 ), updated AS (
  UPDATE duaxe.race_players p SET student_id=i.student_id,digest=i.digest,state=i.state
  FROM players i WHERE p.room_code=$1 AND p.player_id=i.player_id AND EXISTS(SELECT 1 FROM saved) RETURNING p.player_id
 ), created AS (
  INSERT INTO duaxe.race_players(room_code,player_id,student_id,digest,state)
  SELECT saved.code,i.player_id,i.student_id,i.digest,i.state FROM saved,players i
  WHERE NOT EXISTS(SELECT 1 FROM previous_ids p WHERE p.player_id=i.player_id) RETURNING player_id
 ), answers AS (
  INSERT INTO duaxe.race_answers(room_code,player_id,question_id,result)
  SELECT saved.code,a.player_id,a.question_id,a.result FROM saved,incoming_answers a
  WHERE NOT EXISTS(SELECT 1 FROM duaxe.race_answers old WHERE old.room_code=$1 AND old.player_id=a.player_id AND old.question_id=a.question_id)
   AND a.player_id IN (SELECT player_id FROM updated UNION ALL SELECT player_id FROM created)
  ON CONFLICT DO NOTHING RETURNING question_id
 ), receipts AS (
  INSERT INTO duaxe.command_receipts(room_code,role,actor_id,command_id,signature,data)
  SELECT saved.code,r.role,r.actor_id,r.command_id,r.signature,r.data FROM saved,incoming_receipts r
  WHERE NOT EXISTS(SELECT 1 FROM stored_receipts old WHERE old.role=r.role AND old.actor_id=r.actor_id AND old.command_id=r.command_id)
  ON CONFLICT DO NOTHING RETURNING command_id
 )
 SELECT (SELECT to_jsonb(v) FROM validation v) previous,
  (SELECT count(*) FROM saved) saved,(SELECT count(*) FROM removed) removed,
  (SELECT count(*) FROM updated) updated,(SELECT count(*) FROM created) created,
  (SELECT count(*) FROM players) expected_players,(SELECT count(*) FROM answers) answers,
  (SELECT count(*) FROM incoming_answers a WHERE NOT EXISTS(SELECT 1 FROM duaxe.race_answers old WHERE old.room_code=$1 AND old.player_id=a.player_id AND old.question_id=a.question_id)) expected_answers,
  (SELECT count(*) FROM receipts) receipts,
  (SELECT count(*) FROM incoming_receipts r WHERE NOT EXISTS(SELECT 1 FROM stored_receipts old WHERE old.role=r.role AND old.actor_id=r.actor_id AND old.command_id=r.command_id)) expected_receipts`,[
  s.code,JSON.stringify(s),JSON.stringify(record.report),Date.now(),s.sequence,s.ownerId??null,s.classId??null,s.status,s.startedAt??null,s.finishedAt??null,
 ]);
 const row=result.rows[0],previous=row.previous;
 if(!previous)return false;
 if(!previous.sequence_valid)throw new StaleCheckpointError();
 if(!previous.owner_valid)throw Error('Không được đổi chủ sở hữu phòng.');
 if(!previous.configurable&&!previous.set_matches)throw Error('Không được sửa bộ đề đã bắt đầu.');
 if(!previous.answers_valid)throw Error('Không được mất hoặc đổi đáp án đã lưu.');
 if(!previous.receipts_valid)throw Error('Receipt đã xử lý hoặc không khớp.');
 if(!previous.set_matches)return false;
 if(Number(row.saved)!==1||Number(row.updated)+Number(row.created)!==Number(row.expected_players)||Number(row.answers)!==Number(row.expected_answers)||Number(row.receipts)!==Number(row.expected_receipts))
  throw Error('Aggregate phòng không khớp; hủy transaction.');
 return true;
}
