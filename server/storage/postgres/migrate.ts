import type {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
/** Explicit administrative migration. Runtime never calls this. */
export async function migratePostgres(pool:Pool,targetVersion=1){
 if(![1,2,3,4].includes(targetVersion))throw Error('Unsupported schema target.');const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(924,900)');
  await client.query('CREATE SCHEMA IF NOT EXISTS duaxe; REVOKE ALL ON SCHEMA duaxe FROM PUBLIC; CREATE TABLE IF NOT EXISTS duaxe.schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(let version=1;version<=targetVersion;version++){
   const file=['001_storage.sql','002_cloud.sql','003_auth_migration.sql','004_teacher_signup.sql'][version-1],sql=await readFile(new URL('./migrations/'+file,import.meta.url),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
   const existing=await client.query('SELECT checksum FROM duaxe.schema_migrations WHERE version=$1',[version]);
   if(existing.rowCount){if(existing.rows[0].checksum!==hash)throw Error('Migration checksum không khớp.');}
   else{await client.query(sql);await client.query('INSERT INTO duaxe.schema_migrations(version,checksum) VALUES($1,$2)',[version,hash]);}
  }
  await client.query('COMMIT');
 }catch{await client.query('ROLLBACK').catch(()=>{});throw Error('Không xác nhận được PostgreSQL migration; đã yêu cầu rollback. Kiểm tra version/checksum nếu mất phản hồi COMMIT.');}finally{client.release();}
}
