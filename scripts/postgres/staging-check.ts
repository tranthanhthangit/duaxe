/** Read-only, explicitly selected staging connectivity check. Never migrates/seeds. */
import pg from 'pg';
import {postgresConfig} from '../../server/storage/postgres/config';

async function main(){
 const source=process.env.PG_STAGING_URL;
 if(!source){console.log(JSON.stringify({status:'skipped',reason:'PG_STAGING_URL is not configured; Supabase staging has not been tested.'}));return;}
 const url=new URL(source);
 if(process.env.PG_STAGING_CONFIRMED!=='1'||!process.env.PG_STAGING_EXPECTED_HOST||url.hostname!==process.env.PG_STAGING_EXPECTED_HOST)
  throw Error('Staging confirmation/host allowlist is required.');
 if(!['direct','session'].includes(process.env.PG_STAGING_CONNECTION_MODE??''))throw Error('Confirm direct/session connection mode first.');
 const pool=new pg.Pool(postgresConfig({...process.env,DATABASE_URL:source,PG_SSL_MODE:'verify-full'}));pool.on('error',()=>{});
 try{
  const client=await pool.connect();let failed=false;
  try{
   await client.query('BEGIN READ ONLY; SET LOCAL statement_timeout=3000');
   const first=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const row=(await client.query(`SELECT
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl,
    (SELECT max(version) FROM duaxe.schema_migrations) schema_version,
    rolsuper,rolbypassrls,pg_has_role(current_user,'duaxe_runtime','member') member
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
   const last=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   if(!row?.ssl||row.rolsuper||row.rolbypassrls||!row.member||Number(row.schema_version)!==1||first!==last)throw Error('Staging TLS/role/schema/transaction checks failed.');
   await client.query('ROLLBACK');
   console.log(JSON.stringify({status:'passed',tlsVerified:true,schemaVersion:1,runtimeRole:true,sameClientTransaction:true,connectionMode:process.env.PG_STAGING_CONNECTION_MODE,poolMax:pool.options.max,mutations:0,note:'Connectivity only; this does not establish multiplayer performance, session-pooler correctness, or classroom readiness.'}));
  }catch{failed=true;await client.query('ROLLBACK').catch(()=>{});throw Error('Staging check failed.');}
  finally{client.release(failed);}
 }finally{await pool.end();}
}
void main().catch(()=>{console.error('Staging check failed; verify the explicit target, TLS, role, schema, network access and timeouts. No database URL or credentials were logged.');process.exitCode=1;});
