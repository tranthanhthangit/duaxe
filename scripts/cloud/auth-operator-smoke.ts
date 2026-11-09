/** Guarded CLI against an isolated local database + HTTPS emulator, never a cloud DB. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {pgFixture} from '../../tests/helpers/postgres';
import {mockSupabase} from '../../tests/helpers/supabase';
import {migratePostgres} from '../../server/storage/postgres/migrate';
const run=promisify(execFile);
if(!process.env.LOCAL_TEST_TLS_KEY||!process.env.LOCAL_TEST_TLS_CERT)throw Error('Local TLS fixture required');
const f=await pgFixture(),mock=await mockSupabase({key:await readFile(process.env.LOCAL_TEST_TLS_KEY),cert:await readFile(process.env.LOCAL_TEST_TLS_CERT)});
try{
 await migratePostgres(f.pool,3);const teacher=await f.seedTeacher(),manifest=join(f.dir,'auth-manifest.json'),batch=randomUUID(),privateReport=join(f.dir,'audit.json');await writeFile(manifest,JSON.stringify([{teacherId:teacher.id}]),{mode:0o600});
 const env={...process.env,DATABASE_URL:f.url,PG_SSL_MODE:'disable',CLOUD_TARGET:'production',CLOUD_OPERATION_APPROVED:'1',CLOUD_EXPECTED_DB_HOST:'127.0.0.1',CLOUD_EXPECTED_DATABASE:f.name,SUPABASE_URL:mock.origin,CLOUD_EXPECTED_SUPABASE_URL:mock.origin,SUPABASE_AUTH_ADMIN_KEY:mock.secret,CLOUD_AUTH_REDIRECT_URL:'https://school.pages.dev/?mode=teacher&auth=recovery&fresh=1'};
 let outputs='';
 const cli=async(args:string[],overrides:Record<string,string>={})=>{const r=await run(process.execPath,['--import','tsx','scripts/cloud/auth-migration.ts',...args],{env:{...env,...overrides},maxBuffer:1024*1024});outputs+=r.stdout+r.stderr;return JSON.parse(r.stdout.trim());};
 const args=['--batch',batch,'--manifest',manifest];
 assert.equal((await cli([])).connections,0);
 await assert.rejects(cli(['prepare',...args,'--apply'],{CLOUD_OPERATION_APPROVED:'0'}));
 await assert.rejects(cli(['prepare',...args,'--apply'],{CLOUD_EXPECTED_SUPABASE_URL:'https://wrong.invalid'}));assert.equal(mock.creates(),0);
 await cli(['audit','--dry-run','--report',privateReport]);assert.equal((await stat(privateReport)).mode&0o077,0);const report=await readFile(privateReport,'utf8');assert.ok(!report.includes((await f.pool.query('SELECT password FROM duaxe.teachers')).rows[0].password));
 assert.equal((await cli(['prepare',...args,'--dry-run'])).dryRun,true);assert.equal(mock.creates(),0);
 assert.equal((await cli(['prepare',...args,'--apply'])).created,1);assert.equal((await cli(['prepare',...args,'--apply'])).skipped,1);
 assert.equal((await cli(['invite',...args,'--apply'])).invitesRequested,1);assert.equal(mock.invitations.length,1);
 await assert.rejects(cli(['finalize',...args,'--apply']));assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links')).rows[0].n,'0');
 const uid=(await f.pool.query('SELECT auth_user_id FROM duaxe.auth_migration_items')).rows[0].auth_user_id;mock.adminUsers.get(uid)!.email_confirmed_at=new Date().toISOString();
 assert.equal((await cli(['finalize',...args,'--apply'])).linked,1);assert.equal((await f.pool.query('SELECT teacher_id FROM duaxe.teacher_auth_links')).rows[0].teacher_id,teacher.id);
 assert.equal((await cli(['rollback',...args,'--apply'])).authUsersDeleted,0);assert.equal((await f.pool.query('SELECT enabled FROM duaxe.teacher_auth_links')).rows[0].enabled,false);assert.equal(mock.adminUsers.size,1);assert.equal((await f.pool.query('SELECT id FROM duaxe.teachers')).rows[0].id,teacher.id);
 assert.equal((await cli(['rollback',...args,'--apply'])).skipped,1);
 assert.ok(!outputs.includes(mock.secret));assert.ok(!outputs.includes(teacher.email));assert.ok(!outputs.includes(teacher.password));
 await mkdir('benchmarks/auth-production',{recursive:true});await writeFile('benchmarks/auth-production/operator.json',JSON.stringify({environment:'Actual CLI + local PG17 + HTTPS Auth emulator; production flags point only at generated loopback fixture',offlineDefault:true,approvalAndProjectGuards:true,privateAuditWithoutHashes:true,dryRun:true,prepareRetry:true,invite:true,unconfirmedFinalizeDenied:true,confirmedMappingPreservesTeacherId:true,nondestructiveRollback:true,noSecretsOrEmailInOutput:true,hostedSupabaseTested:false},null,2)+'\n');console.log('PASS Auth operator CLI: target guards, dry-run, private audit, create/retry/invite/confirmed finalize/rollback; no hosted mutations.');
}finally{await f.close();await mock.close();}
