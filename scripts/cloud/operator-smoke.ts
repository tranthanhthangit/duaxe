/** Guarded operator commands + actual dump/restore, exclusively in our local fixture. */
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {pgFixture} from '../../tests/helpers/postgres';
import {mockSupabase} from '../../tests/helpers/supabase';
import {ClassroomStore} from '../../server/classroom/Store';
import {PostgresStorage} from '../../server/storage/PostgresStorage';
import {SupabaseAvatarObjects} from '../../server/cloud/AvatarObjects';
import {SupabaseTeacherAuth} from '../../server/cloud/TeacherAuth';
const run=promisify(execFile),f=await pgFixture(),container=process.env.PG_TEST_DOCKER_CONTAINER;
if(container!=='duaxe-production-test')throw Error('This smoke only accepts the task-created local test container.');
const dockerEnv={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];const docker=['--host=unix:///var/run/docker.sock'];
const info=await run('docker',[...docker,'inspect','--format','{{index .Config.Labels "com.duaxe.task"}}',container],{env:dockerEnv});assert.equal(info.stdout.trim(),'production-local');
const mock=await mockSupabase({key:await readFile(process.env.LOCAL_TEST_TLS_KEY!),cert:await readFile(process.env.LOCAL_TEST_TLS_CERT!)}),source=new ClassroomStore(join(f.dir,'source.sqlite'),join(f.dir,'source-avatars'));
let restored:Awaited<ReturnType<typeof pgFixture>>|undefined,storage:PostgresStorage|undefined;
try{
 const owner=source.createTeacher('operator-synthetic@example.test','synthetic-test-password'),cls=source.saveClass(owner,{name:'Synthetic'}),student=source.saveStudent(owner,{classId:cls,fullName:'Synthetic',displayName:'Synthetic'});const avatar=await source.upload(owner,student,await sharp({create:{width:128,height:128,channels:3,background:'pink'}}).png().toBuffer());
 const copy=join(f.dir,'copy.sqlite'),images=join(f.dir,'backup-images');await mkdir(images);await copyFile(join(source.avatarDir,avatar+'.webp'),join(images,avatar+'.webp'));source.db.prepare('VACUUM INTO ?').run(copy);source.close();const before=createHash('sha256').update(await readFile(copy)).digest('hex'),uid=randomUUID();mock.adminUsers.set(uid,{id:uid,email:'operator-synthetic@example.test',email_confirmed_at:new Date().toISOString()});
 const env={...process.env,NODE_ENV:'test',DATABASE_URL:f.url,PG_SSL_MODE:'disable',CLOUD_TARGET:'production',CLOUD_OPERATION_APPROVED:'1',CLOUD_EXPECTED_DB_HOST:'127.0.0.1',CLOUD_EXPECTED_DATABASE:f.name,SUPABASE_URL:mock.origin,SUPABASE_STORAGE_KEY:mock.secret,SUPABASE_AVATAR_BUCKET:mock.bucket},batch=randomUUID();
 const cli=async(args:string[])=>run(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/cloud/operator.ts',...args],{env,maxBuffer:1024*1024});
 await cli(['schema','--apply']);const args=['import','--source',copy,'--source-is-copy','--batch',batch];const dry=JSON.parse((await cli([...args,'--dry-run'])).stdout);assert.equal(dry.dryRun,true);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'0');
 assert.equal(JSON.parse((await cli([...args,'--apply'])).stdout).verified,true);await cli(['copy-avatars','--source',copy,'--source-is-copy','--avatars',images,'--batch',batch,'--journal',join(f.dir,'copy-journal.json'),'--apply']);
 await cli(['link-teacher','--teacher',owner,'--auth-user',uid,'--apply']);assert.equal((await f.pool.query('SELECT teacher_id FROM duaxe.teacher_auth_links')).rows[0].teacher_id,owner);
 const dump=await run('docker',[...docker,'exec',container,'pg_dump','-U','postgres','-d',f.name,'-Fc','--schema=duaxe','--no-owner'],{env:dockerEnv,encoding:'buffer',maxBuffer:16*1024*1024}),dumpFile=join(f.dir,'database.dump');await writeFile(dumpFile,dump.stdout,{mode:0o600});
 const backup=join(f.dir,'cloud-backup');await cli(['backup-avatars','--output',backup,'--database-backup',dumpFile,'--apply']);const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));assert.equal(manifest.complete,true);assert.equal(manifest.entries.length,1);
 restored=await pgFixture();const child=spawn('docker',[...docker,'exec','-i',container,'pg_restore','-U','postgres','-d',restored.name,'--clean','--if-exists','--no-owner'],{env:dockerEnv,stdio:['pipe','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);const exit=new Promise<number|null>(r=>child.once('exit',r));child.stdin.end(dump.stdout);assert.equal(await exit,0,'Local restore failed');
 // Restore the external objects from backup into the local emulator only.
 mock.objects.clear();for(const entry of manifest.entries){const bytes=await readFile(join(backup,entry.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);mock.objects.set(mock.bucket+'/'+entry.path,bytes);}
 storage=await PostgresStorage.connect(restored.config,'',new SupabaseAvatarObjects(mock.origin,mock.bucket,mock.secret));assert.equal((await storage.classrooms.student(owner,student)).avatarId,avatar);assert.equal((await sharp(await storage.avatars.read(owner,avatar)).metadata()).width,128);assert.equal(await new SupabaseTeacherAuth(storage.db,mock.issuer).authenticate('Bearer '+await mock.token(uid)),owner);
 await assert.rejects(cli(['rollback-import','--batch',batch,'--apply']));assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'1');assert.equal(createHash('sha256').update(await readFile(copy)).digest('hex'),before);
 await mkdir('benchmarks/production-local',{recursive:true});await writeFile('benchmarks/production-local/operator.json',JSON.stringify({environment:'Local PG17/HTTPS emulator only; guarded production command code against isolated test DBs',schema2:true,dryRunRollback:true,importVerified:true,authIdMappingPreserved:true,avatarCopyVerified:true,backupObjects:1,actualPgDumpRestore:true,restoredAvatarAndAuth:true,rollbackRefusedAfterNewAuthLinks:true,sourceCopyUnchanged:true,realCloudTested:false},null,2)+'\n');console.log('PASS local operator: schema/dry-run/import/Auth link/avatar copy/private backup + actual pg_dump/restore; source preserved.');
}finally{if(source.db.isOpen)source.close();await storage?.close();await restored?.close();await f.close();await mock.close();}
