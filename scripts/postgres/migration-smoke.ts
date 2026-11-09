/** Exercise the operator CLI against synthetic SQLite and an isolated local PostgreSQL. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {pgFixture} from '../../tests/helpers/postgres';
import {ClassroomStore} from '../../server/classroom/Store';
import {SessionStore} from '../../server/sessions/SessionStore';
import {Room} from '../../server/Room';
import {defaultSet} from '../../src/questions/model';

const fixture=await pgFixture(),source=join(fixture.dir,'source.sqlite'),copy=join(fixture.dir,'copy.sqlite');
const store=new ClassroomStore(source,join(fixture.dir,'sqlite-avatars')),run=promisify(execFile);
const env={...process.env,DATABASE_URL:fixture.url,PG_SSL_MODE:'disable',PG_MIGRATION_TARGET:'staging',PG_MIGRATION_DATABASE_NAME:fixture.name,CLASSROOM_DB_PATH:source};
const cli=async(args:string[])=>{
 const result=await run(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/postgres/migrate.ts',...args],{env});
 return result.stdout.trim();
};
try{
 const owner=store.createTeacher('migration@example.test','synthetic-test-password');
 store.login('migration@example.test','synthetic-test-password');
 const cls=store.saveClass(owner,{name:'Lớp giả lập'}),student=store.saveStudent(owner,{classId:cls,fullName:'Bé thử',displayName:'Bé thử'});
 await store.upload(owner,student,await sharp({create:{width:128,height:128,channels:3,background:'pink'}}).png().toBuffer());
 const room=new Room('ABC234',defaultSet,'teacher-token-not-real','teacher');
 room.ownerId=owner;room.classId=cls;room.profiles=store.profiles(owner,cls,[student]);
 const player=room.claim(student,1,'student');room.control('start');room.answer(player.playerId,'sun','morning');
 new SessionStore(store).save(room);store.db.prepare('VACUUM INTO ?').run(copy);store.close();
 const hash=()=>createHash('sha256').update(readFileSync(copy)).digest('hex'),before=hash(),batch=randomUUID();
 await cli(['schema']);await cli(['schema']);
 const args=['import','--source',copy,'--source-is-copy','--batch',batch];
 const dryRun=JSON.parse(await cli(args));assert.equal(dryRun.dryRun,true);assert.equal((await fixture.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'0');
 const apply=JSON.parse(await cli([...args,'--apply']));assert.equal(apply.verified,true);
 const retry=JSON.parse(await cli([...args,'--apply']));assert.equal(retry.alreadyApplied,true);
 const rollback=JSON.parse(await cli(['rollback','--batch',batch]));assert.equal(rollback.rolledBack,true);
 assert.equal((await fixture.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'0');assert.equal(hash(),before);
 const output=process.env.PG_EVIDENCE_DIR??'benchmarks/postgres';mkdirSync(output,{recursive:true});
 writeFileSync(join(output,'migration-cli.json'),JSON.stringify({environment:'Local PostgreSQL17 + synthetic SQLite v2 copy only',schemaRerun:true,dryRun,apply,retry,rollback,sourceUnchanged:true},null,2));
 console.log('PASS operator CLI: schema checksum, dry-run rollback, apply, idempotent rerun, staging rollback, unchanged source copy.');
}finally{if(store.db.isOpen)store.close();await fixture.close();}
