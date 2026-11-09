/** Read-only checks. No schema changes, writer lock, account creation or uploads. */
import pg from 'pg';
import {assertTeacherSignupSettings} from '../../server/cloud/TeacherSignup';
import {cloudConfig} from '../../server/cloud/config';
import {SupabaseAvatarObjects} from '../../server/cloud/AvatarObjects';
import {postgresConfig} from '../../server/storage/postgres/config';
import {enrollmentVerifier} from '../../server/cloud/Turnstile';
async function main(){
 if(!process.argv.includes('--connect')){console.log(JSON.stringify({mode:'plan',mutations:0,required:['SUPABASE_URL','SUPABASE_STORAGE_KEY','DATABASE_URL runtime login','CLOUD_EXPECTED_DB_HOST','CLOUD_EXPECTED_DATABASE'],next:'Configure privately; --connect performs metadata/READ ONLY checks only.'}));return;}
 const c=cloudConfig();if(process.env.TEACHER_SELF_SIGNUP==='true'){enrollmentVerifier(process.env);await assertTeacherSignupSettings(c.origin,c.storageKey);}const objects=new SupabaseAvatarObjects(c.origin,c.bucket,c.storageKey);await objects.verifyPrivate();
 const response=await fetch(c.origin+'/auth/v1/.well-known/jwks.json',{signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw Error('Auth JWKS unavailable');const jwks=await response.json();if(!Array.isArray(jwks.keys)||!jwks.keys.some((k:{alg?:string})=>['ES256','RS256'].includes(k.alg??'')))throw Error('Asymmetric Auth signing keys required');
 const url=new URL(process.env.DATABASE_URL??'');if(url.hostname!==process.env.CLOUD_EXPECTED_DB_HOST||decodeURIComponent(url.pathname.slice(1))!==process.env.CLOUD_EXPECTED_DATABASE)throw Error('Confirm exact DB target first');
 const pool=new pg.Pool(postgresConfig({...process.env,PG_SSL_MODE:'verify-full'}));pool.on('error',()=>{});try{
  const client=await pool.connect();try{
   await client.query('BEGIN READ ONLY;SET LOCAL statement_timeout=3000');
   const row=(await client.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'duaxe_runtime','member') member,(SELECT max(version) FROM duaxe.schema_migrations) version,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl,pg_has_role('anon','duaxe_runtime','member') anon_backend,pg_has_role('authenticated','duaxe_runtime','member') browser_backend FROM pg_roles WHERE rolname=current_user")).rows[0];
   if(!row||row.rolsuper||row.rolbypassrls||!row.member||(![3,4].includes(row.version)||process.env.TEACHER_SELF_SIGNUP==='true'&&row.version!==4)||!row.ssl||row.anon_backend||row.browser_backend)throw Error('DB role/TLS/schema check failed');
   if(process.env.TEACHER_SELF_SIGNUP==='true')await client.query('SELECT 1 FROM duaxe.teacher_profiles LIMIT 0');await client.query('SELECT 1 FROM duaxe.teacher_auth_links LIMIT 0');await client.query('SELECT 1 FROM duaxe.teacher_auth_revocations LIMIT 0');await client.query('ROLLBACK');
   console.log(JSON.stringify({status:'passed',mutations:0,privateBucket:true,asymmetricJwks:true,runtimeRole:true,tlsVerified:true,schemaVersion:row.version,note:'Not a production gameplay/device acceptance test.'}));
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 }finally{await pool.end();}
}
void main().catch(()=>{console.error('Read-only preflight not confirmed. Check readiness, exact project/DB target, TLS, signing keys, private bucket, role/schema and network access. No credential values logged.');process.exitCode=1;});
