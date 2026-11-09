/** EXPLAIN ANALYZE on synthetic data; every measured mutation is rolled back. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pgFixture} from '../../tests/helpers/postgres';
import {Room} from '../../server/Room';
import {defaultSet} from '../../src/questions/model';
import {writeRoom} from '../../server/storage/postgres/room';

const fixture=await pgFixture(),storage=await fixture.connect(),room=new Room('ABC234',defaultSet,'synthetic-teacher','teacher');
for(let i=0;i<20;i++)room.join('Synthetic '+i,i,'test-'+i);
room.control('start');room.sequence=1;
await storage.rooms.save({checkpoint:room.checkpoint(),report:room.report()});
const player=[...room.players.keys()][0];room.answer(player,'sun','morning');
room.student(player).receipts=new Map([['synthetic-answer',{signature:'synthetic',data:room.student(player).quiz.results[0]}]]);room.sequence++;
const output=process.env.PG_PLAN_OUTPUT??'benchmarks/postgres-performance/query-plan.json',plans:unknown[]=[];
const captured=new Error('Plan captured; rollback');
try{
 for(let i=0;i<5;i++){
  await assert.rejects(storage.db.transaction(async sql=>writeRoom({
   ...sql,query:async(text,values)=>{
    if(!text.startsWith('/* room-write */'))return sql.query(text,values);
    const result=await sql.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+text,values);
    const plan=result.rows[0]['QUERY PLAN'][0],nodes:unknown[]=[];
    const walk=(node:Record<string,unknown>)=>{
     if(node['Node Type']==='ModifyTable'||node['Subplan Name'])nodes.push(Object.fromEntries(['Node Type','Operation','Relation Name','Subplan Name','Actual Total Time','Actual Rows','Actual Loops','Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks'].map(k=>[k,node[k]])));
     for(const child of (node.Plans??[]) as Record<string,unknown>[])walk(child);
    };walk(plan.Plan);
    plans.push({planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],jit:plan.JIT??null,triggers:plan.Triggers,nodes});
    throw captured;
   },
  },{checkpoint:room.checkpoint(),report:room.report()})),e=>e===captured);
 }
 assert.equal((await fixture.pool.query('SELECT count(*) n FROM duaxe.race_answers')).rows[0].n,'0');
 await mkdir(join(output,'..'),{recursive:true});await writeFile(output,JSON.stringify({environment:'Local PostgreSQL17 EXPLAIN ANALYZE; synthetic20 players; all5 mutations ROLLBACK; node times are cumulative, not additive',plans},null,2)+'\n');
 console.log('Query plans captured without committing measured answers.');
}finally{await fixture.close();}
