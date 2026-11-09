/** Metadata only. Never acquires the writer lock, applies SQL, or reads student rows. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {postgresConfig} from '../../server/storage/postgres/config';
export async function migrationFiles(){
 return Promise.all(['001_storage.sql','002_cloud.sql','003_auth_migration.sql','004_teacher_signup.sql'].map(async(file,i)=>{const body=await readFile(new URL('../../server/storage/postgres/migrations/'+file,import.meta.url));return {version:i+1,file,sha256:createHash('sha256').update(body).digest('hex'),bytes:body.length};}));
}
export async function readMigrationMetadata(pool:pg.Pool){
 const files=await migrationFiles(),client=await pool.connect();try{
  await client.query('BEGIN READ ONLY;SET LOCAL statement_timeout=3000');
  const readonly=(await client.query("SELECT current_setting('transaction_read_only') value")).rows[0].value==='on';if(!readonly)throw Error('READ ONLY not enforced');
  const present=(await client.query("SELECT to_regclass('duaxe.schema_migrations') migrations,to_regclass('duaxe.teachers') teachers")).rows[0];
  const versions=present.migrations?(await client.query('SELECT version,checksum FROM duaxe.schema_migrations ORDER BY version')).rows.map(r=>({version:r.version,checksumMatches:files.find(f=>f.version===r.version)?.sha256===r.checksum})):[];
  const tables=(await client.query("SELECT c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='duaxe' AND c.relkind='r' ORDER BY c.relname")).rows;
  const indexes=(await client.query("SELECT indexname name,indexdef definition FROM pg_indexes WHERE schemaname='duaxe' ORDER BY indexname")).rows;
  const policies=(await client.query("SELECT tablename,policyname,roles,cmd FROM pg_policies WHERE schemaname='duaxe' ORDER BY tablename,policyname")).rows;
  const role=(await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  const collisionGroups=present.teachers?Number((await client.query('SELECT count(*) n FROM (SELECT 1 FROM duaxe.teachers GROUP BY lower(btrim(email)) HAVING count(*)>1) collisions')).rows[0].n):0;
  return {readOnly:readonly,versions,pending:files.filter(f=>!versions.some(v=>v.version===f.version)).map(f=>f.version),tables,indexes,policies,currentRole:{superuser:!!role.rolsuper,bypassRls:!!role.rolbypassrls},normalizedEmailCollisionGroups:collisionGroups,mutations:0};
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
}
async function main(){
 const files=await migrationFiles();if(!process.argv.includes('--connect')){console.log(JSON.stringify({mode:'offline-review',productionState:'NOT TESTED',files,approvalRequired:true,note:'Target4 applies all missing 001..004, not just004. Verify database metadata and approve the exact pending list first.',mutations:0},null,2));return;}
 if(process.env.CLOUD_READONLY_REVIEW!=='1')throw Error('Read-only review flag required');
 const url=new URL(process.env.DATABASE_URL??'');if(url.hostname!==process.env.CLOUD_EXPECTED_DB_HOST||decodeURIComponent(url.pathname.slice(1))!==process.env.CLOUD_EXPECTED_DATABASE)throw Error('Exact database target required');
 const pool=new pg.Pool(postgresConfig({...process.env,PG_SSL_MODE:'verify-full'}));pool.on('error',()=>{});try{console.log(JSON.stringify({mode:'production-readonly-review',files,observation:await readMigrationMetadata(pool)},null,2));}finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('BLOCKED: metadata review unconfirmed. Check exact target, TCP5432, credentials, TLS and catalog permissions; no SQL migration or student data read.');process.exitCode=1;});
