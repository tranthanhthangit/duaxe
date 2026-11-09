import type {Pool,PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';

export interface AuthUser {id:string;email?:string;email_confirmed_at?:string|null;banned_until?:string;deleted_at?:string;is_anonymous?:boolean;app_metadata?:Record<string,unknown>;user_metadata?:Record<string,unknown>}
export interface AuthAdmin {
 list():Promise<AuthUser[]>;
 get(id:string):Promise<AuthUser>;
 create(email:string,metadata:Record<string,string>):Promise<AuthUser>;
 invite(email:string,redirect:string):Promise<void>;
}
const entry=z.object({teacherId:z.string().uuid(),existingAuthUserId:z.string().uuid().optional(),ownershipVerified:z.literal(true).optional()}).strict();
export const migrationManifest=z.array(entry).min(1).max(1000).superRefine((rows,ctx)=>{
 if(new Set(rows.map(r=>r.teacherId)).size!==rows.length)ctx.addIssue({code:'custom',message:'Duplicate teacher'});
 const existing=rows.flatMap(r=>r.existingAuthUserId?[r.existingAuthUserId]:[]);if(new Set(existing).size!==existing.length)ctx.addIssue({code:'custom',message:'Duplicate Auth user'});
 for(const row of rows)if(row.existingAuthUserId&&!row.ownershipVerified)ctx.addIssue({code:'custom',message:'Existing account requires ownership review'});
});
export type TeacherManifest=z.infer<typeof migrationManifest>;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const normalize=(email:string)=>email.trim().toLowerCase();
const active=(user:AuthUser)=>!user.deleted_at&&user.is_anonymous!==true&&(!user.banned_until||Date.parse(user.banned_until)<=Date.now());
export async function auditTeachers(pool:Pool|PoolClient){
 // The encoded password never leaves SQL, even during audit/dry-run.
 return (await pool.query(`SELECT t.id,t.email,
 CASE WHEN t.password ~ '^[a-f0-9]{32}:[a-f0-9]{128}$' THEN 'legacy-scrypt' ELSE 'missing-or-unsupported' END password_kind,
 (SELECT count(*)::integer FROM duaxe.classes c WHERE c.owner_id=t.id) classes,
 (SELECT count(*)::integer FROM duaxe.students s WHERE s.owner_id=t.id) students,
 (SELECT count(*)::integer FROM duaxe.race_sessions r WHERE r.owner_id=t.id) sessions
 FROM duaxe.teachers t ORDER BY t.id`)).rows as {id:string;email:string;password_kind:string;classes:number;students:number;sessions:number}[];
}
async function transaction<T>(client:PoolClient,fn:()=>Promise<T>){
 await client.query('BEGIN; SET LOCAL synchronous_commit=on');
 try{const result=await fn();await client.query('COMMIT');return result;}catch{await client.query('ROLLBACK').catch(()=>{});throw Error('Transaction not confirmed; reconcile journal before retry.');}
}
/** Auth HTTP and SQL cannot be one transaction. Persist intent before creating an
 * unverified user; recover by immutable admin-only batch/teacher markers, not email. */
export async function migrateTeachers(pool:Pool,admin:AuthAdmin,input:unknown,options:{batchId:string;phase:'prepare'|'invite'|'finalize'|'rollback';apply?:boolean;redirectUrl?:string}){
 const manifest=migrationManifest.parse(input).sort((a,b)=>a.teacherId.localeCompare(b.teacherId));z.string().uuid().parse(options.batchId);
 const checksum=digest(JSON.stringify(manifest)),client=await pool.connect();
 let locked=false;
 const result={phase:options.phase,dryRun:!options.apply,selected:manifest.length,success:0,failed:0,skipped:0,created:0,linked:0,invitesRequested:0,authUsersDeleted:0,profilesDeleted:0};
 try{
  locked=!!(await client.query('SELECT pg_try_advisory_lock(924,901) allowed')).rows[0].allowed;if(!locked)throw Error('Stop runtime writer before account migration.');
  await client.query('SET synchronous_commit=on');
  const teachers=await auditTeachers(client),emails=new Set<string>();
  for(const teacher of teachers){const email=normalize(teacher.email);if(!z.email().max(150).safeParse(email).success||emails.has(email))throw Error('Missing, invalid or duplicate normalized email: manual review required.');emails.add(email);}
  const selected=manifest.map(item=>{const teacher=teachers.find(t=>t.id===item.teacherId);if(!teacher)throw Error('Unknown teacher');return {...item,email:normalize(teacher.email)};});
  const batch=(await client.query('SELECT * FROM duaxe.auth_migration_batches WHERE id=$1',[options.batchId])).rows[0];
  if(batch&&(batch.manifest_checksum!==checksum||batch.status==='rolled_back'&&options.phase!=='rollback'))throw Error('Batch conflicts with manifest/status');
  if(options.phase==='rollback'){
   if(!batch)throw Error('Unknown batch');if(!options.apply||batch.status==='rolled_back')return {...result,skipped:manifest.length};
   await transaction(client,async()=>{
    const items=(await client.query('SELECT * FROM duaxe.auth_migration_items WHERE batch_id=$1 FOR UPDATE',[options.batchId])).rows;
    for(const item of items)if(item.mapping_created){
     const changed=await client.query('UPDATE duaxe.teacher_auth_links SET enabled=false WHERE auth_user_id=$1 AND teacher_id=$2',[item.auth_user_id,item.teacher_id]);if(changed.rowCount!==1)throw Error('Mapping changed; manual rollback required');
    }
    await client.query("UPDATE duaxe.auth_migration_items SET state='rolled_back',updated_at=now() WHERE batch_id=$1",[options.batchId]);
    await client.query("UPDATE duaxe.auth_migration_batches SET status='rolled_back' WHERE id=$1",[options.batchId]);
   });return {...result,success:manifest.length};
  }
  if(options.phase==='prepare'){
   const users=await admin.list();
   const links=(await client.query('SELECT teacher_id,auth_user_id,enabled FROM duaxe.teacher_auth_links')).rows;
   const candidates=selected.map(item=>{
    const ours=users.filter(u=>u.app_metadata?.duaxe_batch===options.batchId&&u.app_metadata?.duaxe_teacher===item.teacherId);
    const sameEmail=users.filter(u=>u.email&&normalize(u.email)===item.email);
    const explicit=users.find(u=>u.id===item.existingAuthUserId);
    if(ours.length>1||sameEmail.length>1||item.existingAuthUserId&&!explicit)throw Error('Auth identity conflict');
    const user=explicit??ours[0];
    const mapped=links.find(l=>l.teacher_id===item.teacherId);if(mapped&&(!mapped.enabled||mapped.auth_user_id!==user?.id))throw Error('Disabled/conflicting teacher mapping; explicit review required');
    if(sameEmail.length&&sameEmail[0].id!==user?.id)throw Error('Existing email requires explicit verified Auth UUID; never auto-link');
    if(user&&(!active(user)||normalize(user.email??'')!==item.email||explicit&&!user.email_confirmed_at))throw Error('Inactive, unconfirmed or mismatched account');
    return {...item,user,owned:!explicit};
   });
   if(!options.apply)return {...result,success:manifest.length};
   await transaction(client,async()=>{
    await client.query("INSERT INTO duaxe.auth_migration_batches(id,manifest_checksum,status) VALUES($1,$2,'prepared') ON CONFLICT(id) DO NOTHING",[options.batchId,checksum]);
    for(const item of candidates)await client.query("INSERT INTO duaxe.auth_migration_items(batch_id,teacher_id,email_digest,state) VALUES($1,$2,$3,'planned') ON CONFLICT DO NOTHING",[options.batchId,item.teacherId,digest(item.email)]);
   });
   for(const item of candidates){
    try{
     const old=(await client.query('SELECT * FROM duaxe.auth_migration_items WHERE batch_id=$1 AND teacher_id=$2',[options.batchId,item.teacherId])).rows[0];
     if(old.email_digest!==digest(item.email))throw Error('Source email changed');
     let user=item.user;
     if(old.auth_user_id){if(user?.id!==old.auth_user_id)throw Error('Auth identity changed');result.skipped++;continue;}
     if(!user){user=await admin.create(item.email,{duaxe_batch:options.batchId,duaxe_teacher:item.teacherId});result.created++;}
     if(!z.string().uuid().safeParse(user.id).success||normalize(user.email??'')!==item.email||item.owned&&(user.app_metadata?.duaxe_batch!==options.batchId||user.app_metadata?.duaxe_teacher!==item.teacherId))throw Error('Created identity not verified');
     await client.query("UPDATE duaxe.auth_migration_items SET auth_user_id=$3,owned=$4,state='created',updated_at=now() WHERE batch_id=$1 AND teacher_id=$2",[options.batchId,item.teacherId,user.id,item.owned]);result.success++;
    }catch{result.failed++;} // Durable planned intent survives an ambiguous remote create.
   }return result;
  }
  if(!batch)throw Error('Prepare batch first');
  if(options.phase==='invite'){
   const redirect=new URL(options.redirectUrl??'');if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.search!=='?mode=teacher&auth=recovery&fresh=1'||redirect.hash||redirect.pathname!=='/')throw Error('Exact HTTPS teacher recovery redirect required');
  }
  for(const teacher of selected){
   try{
    const item=(await client.query('SELECT * FROM duaxe.auth_migration_items WHERE batch_id=$1 AND teacher_id=$2',[options.batchId,teacher.teacherId])).rows[0];
    if(!item?.auth_user_id||item.email_digest!==digest(teacher.email))throw Error('Prepare required or source changed');
    const user=await admin.get(item.auth_user_id);
    if(user.id!==item.auth_user_id||normalize(user.email??'')!==teacher.email||!active(user))throw Error('Auth account mismatch/disabled');
    if(options.phase==='invite'){
     if(!item.owned||user.email_confirmed_at||item.invite_requested_at){result.skipped++;continue;}
     if(options.apply){
      // At most one automatic attempt. SMTP/ACK ambiguity requires manual review,
      // never a blind resend on restart. The journal flag commits before HTTP.
      await client.query('UPDATE duaxe.auth_migration_items SET invite_requested_at=now(),updated_at=now() WHERE batch_id=$1 AND teacher_id=$2',[options.batchId,teacher.teacherId]);
      await admin.invite(teacher.email,options.redirectUrl!);result.invitesRequested++;
     }result.success++;continue;
    }
    if(!user.email_confirmed_at)throw Error('Email ownership not confirmed');
    if(options.apply)await transaction(client,async()=>{
     const links=(await client.query('SELECT * FROM duaxe.teacher_auth_links WHERE auth_user_id=$1 OR teacher_id=$2 FOR UPDATE',[user.id,teacher.teacherId])).rows;
     if(links.length&&!(links.length===1&&links[0].teacher_id===teacher.teacherId&&links[0].auth_user_id===user.id&&links[0].enabled))throw Error('Mapping conflict');
     let created=false;if(!links.length){await client.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[user.id,teacher.teacherId]);created=true;}
     await client.query("UPDATE duaxe.auth_migration_items SET mapping_created=mapping_created OR $3,state='linked',updated_at=now() WHERE batch_id=$1 AND teacher_id=$2",[options.batchId,teacher.teacherId,created]);
    });result.linked++;result.success++;
   }catch{result.failed++;}
  }return result;
 }finally{if(locked)await client.query('SELECT pg_advisory_unlock(924,901)').catch(()=>{});client.release();}
}
