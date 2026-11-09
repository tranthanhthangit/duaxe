import pg from 'pg';
import {postgresConfig} from '../../server/storage/postgres/config';
import {migratePostgres} from '../../server/storage/postgres/migrate';
import {readSQLiteCopy,importBundle,rollbackBatch} from '../../server/storage/postgres/importer';
async function main(){
 if(process.env.PG_MIGRATION_TARGET!=='staging'||!process.env.PG_MIGRATION_DATABASE_NAME)throw Error('Chỉ chạy khi đã xác nhận staging và tên database đích.');
 const pool=new pg.Pool(postgresConfig());pool.on('error',()=>{});try{
  if((await pool.query('SELECT current_database() name')).rows[0].name!==process.env.PG_MIGRATION_DATABASE_NAME)throw Error('Database không khớp allowlist.');
  const [command,...args]=process.argv.slice(2),get=(flag:string)=>args[args.indexOf(flag)+1];
  if(command==='schema'){await migratePostgres(pool);console.log('PostgreSQL migration v1 đã áp dụng/đối chiếu.');return;}
  if(command==='rollback'){const result=await rollbackBatch(pool,get('--batch'),process.env.PG_MIGRATION_DATABASE_NAME!);console.log(JSON.stringify(result));return;}
  if(command!=='import'||!args.includes('--source')||!args.includes('--batch'))throw Error('Dùng schema | import --source COPY --source-is-copy --batch UUID [--apply] | rollback --batch UUID');
  const bundle=readSQLiteCopy(get('--source'),args.includes('--source-is-copy'));const result=await importBundle(pool,bundle,{apply:args.includes('--apply'),batchId:get('--batch'),expectedDatabase:process.env.PG_MIGRATION_DATABASE_NAME!});console.log(JSON.stringify(result));
 }finally{await pool.end();}
}
void main().catch(()=>{console.error('PostgreSQL migration thất bại; kiểm tra staging, quyền, nguồn và báo cáo đối chiếu. Không có secret được ghi log.');process.exitCode=1;});
