/** Never runs at startup. Offline plan by default; explicit target/approval for I/O. */
import pg from 'pg';
import {readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {postgresConfig} from '../../server/storage/postgres/config';
import {SupabaseAuthAdmin} from '../../server/cloud/AuthAdmin';
import {auditTeachers,migrateTeachers} from '../../server/cloud/TeacherMigration';
const args=process.argv.slice(2),phase=args[0]??'plan';
const get=(name:string)=>{const i=args.indexOf(name);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing flag');return args[i+1];};
async function privatePath(path:string,existing=true){
 if(!isAbsolute(path))throw Error('Private absolute path required');
 const canonical=existing?await realpath(path):resolve(await realpath(resolve(path,'..')),path.split('/').at(-1)!);
 const repo=await realpath(process.cwd());if(canonical===repo||canonical.startsWith(repo+'/'))throw Error('Private input/output must be outside repository');
 if(existing){const mode=(await stat(canonical)).mode;if(mode&0o077)throw Error('Manifest must be private (chmod600)');}
 return canonical;
}
async function main(){
 if(!['plan','audit','prepare','invite','finalize','rollback'].includes(phase))throw Error('Unknown phase');
 const apply=args.includes('--apply'),dryRun=args.includes('--dry-run');if(apply&&dryRun)throw Error('Choose apply or dry-run');
 if(phase==='plan'||!apply&&!dryRun){console.log(JSON.stringify({mode:'offline-plan',connections:0,mutations:0,phases:['audit','prepare: create unverified passwordless accounts','invite: one reviewed email attempt','finalize: only confirmed accounts -> existing teacherId','rollback: disable only batch-created mappings; delete nothing'],requirements:['backup/restore verified','writer stopped','reviewed private manifest','explicit production approval','schema003 applied separately'],passwordHashImport:false}));return;}
 if(process.env.CLOUD_TARGET!=='production'||process.env.CLOUD_OPERATION_APPROVED!=='1')throw Error('Explicit production approval required');
 const target=new URL(process.env.DATABASE_URL??'');if(target.hostname!==process.env.CLOUD_EXPECTED_DB_HOST||decodeURIComponent(target.pathname.slice(1))!==process.env.CLOUD_EXPECTED_DATABASE)throw Error('Exact database target required');
 const origin=new URL(process.env.SUPABASE_URL??'');if(origin.protocol!=='https:'||origin.origin!==process.env.SUPABASE_URL||origin.origin!==process.env.CLOUD_EXPECTED_SUPABASE_URL)throw Error('Exact Auth project origin required');
 const key=process.env.SUPABASE_AUTH_ADMIN_KEY;if(!key)throw Error('Separate operator Auth Admin key required');
 const pool=new pg.Pool(postgresConfig());pool.on('error',()=>{});
 try{
  if(phase==='audit'){
   if(apply)throw Error('Audit uses --dry-run only');const path=await privatePath(get('--report'),false),teachers=await auditTeachers(pool);
   await writeFile(path,JSON.stringify({containsPersonalData:true,emailOwnershipUnknown:true,teachers},null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({teachers:teachers.length,privateReportWritten:true,mutations:0}));return;
  }
  const manifest=JSON.parse(await readFile(await privatePath(get('--manifest')),'utf8'));
  const outcome=await migrateTeachers(pool,new SupabaseAuthAdmin(origin.origin,key),manifest,{batchId:get('--batch'),phase:phase as 'prepare'|'invite'|'finalize'|'rollback',apply,redirectUrl:phase==='invite'?process.env.CLOUD_AUTH_REDIRECT_URL:undefined});
  console.log(JSON.stringify(outcome));if(outcome.failed)process.exitCode=1;
 }finally{await pool.end();}
}
void main().catch(()=>{console.error('Auth migration not confirmed. Check reviewed target, backup, private manifest and durable journal. Reconcile remote create/invite/commit outcomes before retry; no credentials, email or hashes logged.');process.exitCode=1;});
