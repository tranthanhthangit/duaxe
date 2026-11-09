import pg,{type PoolConfig} from 'pg';
import {randomUUID,scryptSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {postgresConfig} from '../../server/storage/postgres/config';
import {migratePostgres} from '../../server/storage/postgres/migrate';
import {PostgresStorage} from '../../server/storage/PostgresStorage';
export const postgresEnabled=!!process.env.PG_TEST_URL;
export async function pgFixture(overrides:PoolConfig={}){
 const source=process.env.PG_TEST_URL;if(!source)throw Error('Thiếu PG_TEST_URL thử nghiệm.');const url=new URL(source);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Harness này chỉ nhận PostgreSQL local trên loopback.');
 const admin=new pg.Pool(postgresConfig({...process.env,DATABASE_URL:source,PG_SSL_MODE:'disable'})),name='duaxe_'+randomUUID().replaceAll('-','');await admin.query(`CREATE DATABASE "${name}"`);url.pathname='/'+name;
 const config=postgresConfig({...process.env,DATABASE_URL:url.href,PG_SSL_MODE:'disable'}),pool=new pg.Pool(config),dir=await mkdtemp(join(tmpdir(),'duaxe-pg-'));
 let setupFailed=false;const setup=await admin.connect();try{await setup.query('SELECT pg_advisory_lock(924,899)');await migratePostgres(pool);}catch(e){setupFailed=true;await pool.end();await setup.query(`DROP DATABASE "${name}" WITH (FORCE)`);throw e;}finally{await setup.query('SELECT pg_advisory_unlock(924,899)').catch(()=>{});setup.release();if(setupFailed)await admin.end();}
 const role='rt_'+randomUUID().replaceAll('-',''),password=randomUUID();await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' IN ROLE duaxe_runtime`);const runtimeUrl=new URL(url);runtimeUrl.username=role;runtimeUrl.password=password;
 const runtimeConfig={...postgresConfig({...process.env,DATABASE_URL:runtimeUrl.href,PG_SSL_MODE:'disable'}),...overrides};let storage:PostgresStorage|undefined;
 return {pool,name,url:url.href,runtimeUrl:runtimeUrl.href,dir,config:runtimeConfig,
  connect:async()=>storage=await PostgresStorage.connect(runtimeConfig,join(dir,'avatars')),
  seedTeacher:async()=>{const id=randomUUID(),salt=randomUUID().replaceAll('-',''),password='synthetic-password-only',encoded=salt+':'+scryptSync(password,salt,64).toString('hex'),email=randomUUID()+'@example.test';await pool.query('INSERT INTO duaxe.teachers VALUES($1,$2,$3,now())',[id,email,encoded]);return {id,email,password};},
  close:async()=>{await storage?.close();await pool.end();for(let i=0;i<200;i++){if(Number((await admin.query('SELECT count(*) n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n)===0)break;await new Promise(r=>setTimeout(r,5));}await admin.query(`DROP DATABASE "${name}"`);await admin.query(`DROP ROLE ${role}`);await admin.end();await rm(dir,{recursive:true,force:true});},
 };
}
