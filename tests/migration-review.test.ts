import test from 'node:test';import assert from 'node:assert/strict';
import {pgFixture,postgresEnabled} from './helpers/postgres';
import {migratePostgres} from '../server/storage/postgres/migrate';
import {readMigrationMetadata,migrationFiles} from '../scripts/cloud/migration-review';
test('migration review uses READ ONLY, distinguishes pending003/004 and never applies DDL',{skip:!postgresEnabled},async()=>{
 const f=await pgFixture();try{
  await migratePostgres(f.pool,2);const files=await migrationFiles();assert.deepEqual(files.map(f=>f.version),[1,2,3,4]);assert.ok(files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));
  const first=await readMigrationMetadata(f.pool);assert.equal(first.readOnly,true);assert.deepEqual(first.pending,[3,4]);assert.ok(first.versions.every(v=>v.checksumMatches));assert.equal((await f.pool.query('SELECT max(version) n FROM duaxe.schema_migrations')).rows[0].n,2);
  await migratePostgres(f.pool,4);const after=await readMigrationMetadata(f.pool);assert.deepEqual(after.pending,[]);assert.ok(after.tables.some(t=>t.name==='teacher_profiles'&&t.rls&&t.force_rls));assert.equal(after.mutations,0);
 }finally{await f.close();}
});
