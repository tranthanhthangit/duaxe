import sharp from 'sharp';
import {createReadStream} from 'node:fs';
import {isAbsolute} from 'node:path';
/** Explicit operator workflow. Default is a plan only; never runs at server boot. */
import pg from 'pg';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {postgresConfig} from '../../server/storage/postgres/config';
import {migratePostgres} from '../../server/storage/postgres/migrate';
import {readSQLiteCopy,importBundle,rollbackBatch} from '../../server/storage/postgres/importer';
import {SupabaseAvatarObjects,MissingAvatarError} from '../../server/cloud/AvatarObjects';
import {cloudConfig} from '../../server/cloud/config';
const uuid=(v:string)=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),command=args[0],apply=args.includes('--apply');
const get=(flag:string)=>{const i=args.indexOf(flag);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing flag');return args[i+1];};
async function main(){
 if(!['schema','import','rollback-import','link-teacher','copy-avatars','backup-avatars'].includes(command))throw Error('Unknown command');
 if(apply&&args.includes('--dry-run'))throw Error('Choose dry-run or apply');
 if(!apply&&!(command==='import'&&args.includes('--dry-run'))){console.log(JSON.stringify({mode:'plan',command,changes:command==='schema'?(args.includes('--self-signup')?'Add schema004 teacher profiles/email uniqueness;001-003 checksums preserved':args.includes('--auth-journal')?'Add schema003 session cutoffs/operator journal;001/002 checksums preserved':'Add schema002;001 checksum preserved'):command==='link-teacher'?'Verify Auth user and explicitly link existing teacherId':command==='copy-avatars'?'Copy verified backup objects privately; never delete source':command==='backup-avatars'?'Read private objects into a separate private backup with checksums; no cloud deletion':command==='import'?'Use existing importer and source copy; transaction/count/checksum verification':'Existing batch rollback; refuse when target changed',next:'Review target/backup/batch; explicit production approval required for --apply. No connection or mutation performed.'}));return;}
 if(process.env.CLOUD_TARGET!=='production'||process.env.CLOUD_OPERATION_APPROVED!=='1'||!process.env.CLOUD_EXPECTED_DB_HOST||!process.env.CLOUD_EXPECTED_DATABASE)throw Error('Explicit production target and approval required.');
 const url=new URL(process.env.DATABASE_URL??'');if(url.hostname!==process.env.CLOUD_EXPECTED_DB_HOST||decodeURIComponent(url.pathname.slice(1))!==process.env.CLOUD_EXPECTED_DATABASE)throw Error('Target mismatch');
 const pool=new pg.Pool(postgresConfig());pool.on('error',()=>{});
 try{
  // Import/link/object migration require the runtime writer to be stopped.
  const lock=await pool.connect();try{
   if(!(await lock.query('SELECT pg_try_advisory_lock(924,901) allowed')).rows[0].allowed)throw Error('Stop runtime writer first.');
   if(command==='schema'){await migratePostgres(pool,args.includes('--self-signup')?4:args.includes('--auth-journal')?3:2);console.log('Cloud schema applied/verified.');return;}
   if(command==='import'||command==='rollback-import'){
    // Existing importer acquires the same xact lock; release our check session before it.
    await lock.query('SELECT pg_advisory_unlock(924,901)');
    const batchId=get('--batch');if(!uuid(batchId))throw Error('Invalid batch');
    const result=command==='import'?await importBundle(pool,readSQLiteCopy(get('--source'),args.includes('--source-is-copy')),{apply,batchId,expectedDatabase:process.env.CLOUD_EXPECTED_DATABASE!}):await rollbackBatch(pool,batchId,process.env.CLOUD_EXPECTED_DATABASE!);
    console.log(JSON.stringify(result));return;
   }
   const cloud=cloudConfig(),objects=new SupabaseAvatarObjects(cloud.origin,cloud.bucket,cloud.storageKey);await objects.verifyPrivate();
   if(command==='backup-avatars'){
    const output=resolve(get('--output'));if(!isAbsolute(get('--output'))||output===process.cwd()||output.startsWith(process.cwd()+'/'))throw Error('Backup must be private and outside repository');
    const databaseBackup=resolve(get('--database-backup')),dbHash=createHash('sha256');for await(const bytes of createReadStream(databaseBackup))dbHash.update(bytes);
    await mkdir(output,{mode:0o700});const entries=[];const rows=(await pool.query('SELECT id,owner_id,storage_key,file_size FROM duaxe.avatars ORDER BY id')).rows;
    for(const row of rows){const bytes=await objects.read(row.owner_id,row.storage_key);if(bytes.length!==row.file_size)throw Error('Backup size mismatch');await mkdir(join(output,row.owner_id),{recursive:true,mode:0o700});const path=join(row.owner_id,row.storage_key);await writeFile(join(output,path),bytes,{mode:0o600,flag:'wx'});entries.push({avatarId:row.id,ownerId:row.owner_id,path,sha256:hash(bytes),size:bytes.length});await writeFile(join(output,'manifest.json'),JSON.stringify({complete:false,entries},null,2),{mode:0o600});}
    await writeFile(join(output,'manifest.json'),JSON.stringify({version:1,complete:true,databaseBackupSha256:dbHash.digest('hex'),databaseRestoreTested:false,bucket:cloud.bucket,entries},null,2),{mode:0o600});console.log(JSON.stringify({objectsBackedUp:entries.length,cloudMutations:0,requiresDatabaseRestoreTest:true}));return;
   }
   if(command==='link-teacher'){
    const teacherId=get('--teacher'),authId=get('--auth-user');if(!uuid(teacherId)||!uuid(authId))throw Error('Invalid mapping IDs');
    const response=await fetch(cloud.origin+'/auth/v1/admin/users/'+authId,{headers:{apikey:process.env.SUPABASE_AUTH_ADMIN_KEY??cloud.storageKey,Authorization:'Bearer '+(process.env.SUPABASE_AUTH_ADMIN_KEY??cloud.storageKey)},signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!response.ok)throw Error('Auth user check failed');const body=await response.json(),user=body.user??body;if(user.id!==authId||!user.email_confirmed_at||typeof user.email!=='string')throw Error('Confirmed Auth user required');
    await lock.query('BEGIN;SET LOCAL synchronous_commit=on');try{
     const teacher=(await lock.query('SELECT email FROM duaxe.teachers WHERE id=$1 FOR UPDATE',[teacherId])).rows[0];
     if(!teacher){if(!args.includes('--create-profile'))throw Error('Explicit profile creation required');await lock.query('INSERT INTO duaxe.teachers VALUES($1,$2,$3,now())',[teacherId,user.email.toLowerCase(),'!supabase-auth-only']);}
     else if(teacher.email.toLowerCase()!==user.email.toLowerCase())throw Error('Email mismatch; manual ownership review required');
     await lock.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2) ON CONFLICT(auth_user_id) DO NOTHING',[authId,teacherId]);
     const linked=(await lock.query('SELECT teacher_id,enabled FROM duaxe.teacher_auth_links WHERE auth_user_id=$1',[authId])).rows[0];if(linked?.teacher_id!==teacherId||!linked.enabled)throw Error('Mapping conflict');
     await lock.query('COMMIT');console.log('Auth mapping verified; IDs preserved.');
    }catch{await lock.query('ROLLBACK').catch(()=>{});throw Error('Mapping not confirmed; verify transaction outcome before retry.');}return;
   }
   const source=get('--source'),bundle=readSQLiteCopy(source,args.includes('--source-is-copy')),dir=await realpath(get('--avatars'));
   if(dir===await realpath(process.env.CLASSROOM_AVATAR_DIR??'/workspace/duaxe-data/avatars').catch(()=>resolve('/workspace/duaxe-data/avatars')))throw Error('Use avatar backup COPY, not source directory');
   const batch=get('--batch'),journal=resolve(get('--journal'));if(!journal.endsWith('.json')||journal.startsWith(dir+'/')||journal===resolve(source))throw Error('Use a separate private JSON journal');const previous=await readFile(journal,'utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return '';throw e;});if(previous){const p=JSON.parse(previous);if(p.batch!==batch||p.sourceChecksum!==bundle.sourceChecksum)throw Error('Existing journal belongs to another batch');}
   if(!uuid(batch))throw Error('Invalid batch');
   const entries=[];for(const row of bundle.rows.avatars){
    const owner=String(row.owner_id),key=String(row.storage_key),bytes=await readFile(join(dir,key)),checksum=hash(bytes);const image=await sharp(bytes,{limitInputPixels:16000000}).metadata();if(image.format!=='webp'||image.width!==128||image.height!==128||(image.pages??1)!==1)throw Error('Invalid backup avatar image');if(bytes.length!==Number(row.file_size))throw Error('Source avatar size mismatch');
    const metadata=(await pool.query('SELECT owner_id,storage_key,file_size FROM duaxe.avatars WHERE id=$1',[row.id])).rows[0];if(!metadata||metadata.owner_id!==owner||metadata.storage_key!==key||metadata.file_size!==bytes.length)throw Error('DB metadata mismatch');
    let created=false;try{if(hash(await objects.read(owner,key))!==checksum)throw Error('Target object differs; do not overwrite');}catch(error){if(!(error instanceof MissingAvatarError))throw error;await objects.write(owner,key,bytes);created=true;}
    if(hash(await objects.read(owner,key))!==checksum||hash(await readFile(join(dir,key)))!==checksum)throw Error('Object/source verification failed');entries.push({avatarId:row.id,owner,key,checksum,created});
    await mkdir(resolve(journal,'..'),{recursive:true,mode:0o700});await writeFile(journal,JSON.stringify({batch,sourceChecksum:bundle.sourceChecksum,complete:false,entries},null,2),{mode:0o600});
   }
   await writeFile(journal,JSON.stringify({batch,sourceChecksum:bundle.sourceChecksum,complete:true,entries},null,2),{mode:0o600});console.log(JSON.stringify({verified:entries.length,sourceChanged:false,deleted:0}));
  }finally{await lock.query('SELECT pg_advisory_unlock(924,901)').catch(()=>{});lock.release();}
 }finally{await pool.end();}
}
void main().catch(()=>{console.error('Operator action not confirmed. Check reviewed target, backup, permissions and batch/journal; reconcile uncertain commits before retry. No credentials or personal data logged.');process.exitCode=1;});
