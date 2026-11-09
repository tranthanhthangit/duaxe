import {readFileSync} from 'node:fs';
import type {PoolConfig} from 'pg';
export function postgresConfig(env:NodeJS.ProcessEnv=process.env):PoolConfig {
 const source=env.DATABASE_URL;if(!source)throw new Error('Thiếu DATABASE_URL cho PostgreSQL.');
 let url:URL;try{url=new URL(source);}catch{throw new Error('DATABASE_URL không hợp lệ.');}
 if(url.port==='6543')throw new Error('Writer lock cần direct/session connection; không dùng transaction pooler cổng 6543.');
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL phải dùng PostgreSQL.');
 const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname),mode=env.PG_SSL_MODE??(local?'disable':'verify-full');
 if(!['disable','verify-full'].includes(mode)||(!local&&mode==='disable'))throw new Error('PostgreSQL từ xa phải xác minh TLS.');
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])if(url.searchParams.has(key)){
  if(key!=='sslmode'||!['verify-full','require'].includes(url.searchParams.get(key)!))throw new Error('Dùng PG_SSL_MODE/PG_SSL_CA_FILE thay tham số TLS trong URL.');url.searchParams.delete(key);
 }
 const number=(key:string,fallback:number,max:number)=>{const n=Number(env[key]??fallback);if(!Number.isInteger(n)||n<1||n>max)throw new Error('Cấu hình PostgreSQL số không hợp lệ: '+key);return n;};
 return {connectionString:url.href,ssl:mode==='disable'?false:{rejectUnauthorized:true,...(env.PG_SSL_CA_FILE?{ca:readFileSync(env.PG_SSL_CA_FILE,'utf8')}:{})},max:number('PG_POOL_MAX',4,20),connectionTimeoutMillis:number('PG_CONNECT_TIMEOUT_MS',2000,30000),idleTimeoutMillis:30000,statement_timeout:number('PG_STATEMENT_TIMEOUT_MS',3000,60000),lock_timeout:number('PG_LOCK_TIMEOUT_MS',1000,30000),query_timeout:number('PG_QUERY_TIMEOUT_MS',5000,90000),idle_in_transaction_session_timeout:10000,application_name:'duaxe-9b1'};
}
