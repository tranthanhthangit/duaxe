import {Samples} from '../../runtime/Samples';
import pg,{type PoolClient,type PoolConfig,type QueryResult,type QueryResultRow} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
export class DatabaseError extends Error {constructor(public readonly kind:string,public readonly sqlState?:string){super('PostgreSQL không thể hoàn tất thao tác ('+kind+').');}}
const safe=(e:unknown,kind='query')=>e instanceof DatabaseError?e:new DatabaseError(kind,typeof (e as {code?:unknown})?.code==='string'?String((e as {code:string}).code):undefined);
export type SQL={lockedRoom?:string;observe?:(phase:string,ms:number)=>void;query:<T extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>Promise<QueryResult<T>>};
// Fixed operation labels only: SQL text/parameters are never exposed in telemetry.
const roomPhases=['acquireMs','beginMs','fenceMs','roomLockMs','previousReadMs','duplicateQueryMs','duplicateCheckMs','sessionWriteMs','questionWriteMs','playerWriteMs','answerInsertMs','receiptInsertMs','commitMs','otherMs','queryExecutionMs','totalMs','roundTrips','lockedReadMs','combinedWriteMs','fenceRoomLockMs'];
function queryPhase(sql:string){
 if(sql.startsWith('/* room-read */'))return 'lockedReadMs';if(sql.startsWith('/* room-write */'))return 'combinedWriteMs';
 if(sql.startsWith('BEGIN'))return 'beginMs';if(sql==='COMMIT')return 'commitMs';
 if(sql.includes('runtime_owner')&&sql.includes('pg_advisory_xact_lock'))return 'fenceRoomLockMs';
 if(sql.includes('runtime_owner')||sql.includes('pg_locks'))return 'fenceMs';
 if(sql.includes('pg_advisory_xact_lock'))return 'roomLockMs';
 if(sql.startsWith('SELECT sequence,checkpoint'))return 'previousReadMs';
 if(sql.startsWith('SELECT')&&(sql.includes('race_answers')||sql.includes('command_receipts')))return 'duplicateQueryMs';
 if(sql.startsWith('INSERT INTO duaxe.race_answers'))return 'answerInsertMs';
 if(sql.startsWith('INSERT INTO duaxe.command_receipts'))return 'receiptInsertMs';
 if(sql.startsWith('INSERT INTO duaxe.race_sessions'))return 'sessionWriteMs';
 if(sql.includes('duaxe.room_questions'))return 'questionWriteMs';
 if(sql.includes('duaxe.race_players'))return 'playerWriteMs';return 'otherMs';
}
/** Separate dedicated session owns the advisory lock; pooled transactions check its fence. */
export class PostgresDatabase implements SQL {
 readonly pool:pg.Pool;private writer:pg.Client;private epoch='';private pid=0;private healthy=false;private closed=false;private listeners=new Set<()=>void>();readonly owner=randomUUID();
 private queries=new Samples();private transactions=new Samples();private acquisitions=new Samples();private errors=0;private pendingPeak=0;private busyPeak=0;private totalPeak=0;private roomSamples=new Map<string,Samples>();private roomCount=0;
 constructor(config:PoolConfig){this.pool=new pg.Pool(config);this.writer=new pg.Client({...config,application_name:'duaxe-writer'});this.pool.on('connect',client=>client.on('error',()=>{this.errors++;}));this.pool.on('error',()=>{this.errors++;});this.writer.on('error',()=>this.lost());this.writer.on('end',()=>this.lost());}
 private lost(){if(!this.healthy||this.closed)return;this.healthy=false;for(const listener of this.listeners)listener();}
 onUnavailable(listener:()=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 assertWritable(){if(!this.healthy||this.closed)throw new DatabaseError('writer-unavailable');}
 async start(){try{
  const role=await this.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'duaxe_runtime','member') member FROM pg_roles WHERE rolname=current_user");if(role.rows[0]?.rolsuper||role.rows[0]?.rolbypassrls||!role.rows[0]?.member)throw new DatabaseError('runtime-role');
  const version=await this.query('SELECT max(version) version FROM duaxe.schema_migrations');if(![1,2,3,4].includes(Number(version.rows[0]?.version)))throw new DatabaseError('schema-version');
  await this.writer.connect();const result=await this.writer.query('SELECT pg_try_advisory_lock(924,901) locked,pg_backend_pid() pid');if(!result.rows[0].locked)throw new DatabaseError('writer-conflict');this.pid=result.rows[0].pid;
  const row=await this.writer.query('UPDATE duaxe.runtime_owner SET owner_id=$1,epoch=epoch+1 WHERE singleton RETURNING epoch',[this.owner]);this.epoch=String(row.rows[0].epoch);this.healthy=true;
 }catch(e){await this.close();throw safe(e,'startup');}}
 async query<T extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[]):Promise<QueryResult<T>>{
  const at=performance.now();try{return await this.pool.query<T>(text,values);}catch(e){this.errors++;throw safe(e);}finally{this.queries.add(performance.now()-at);this.pendingPeak=Math.max(this.pendingPeak,this.pool.waitingCount);}
 }
 private observePool(){this.pendingPeak=Math.max(this.pendingPeak,this.pool.waitingCount);this.totalPeak=Math.max(this.totalPeak,this.pool.totalCount);this.busyPeak=Math.max(this.busyPeak,this.pool.totalCount-this.pool.idleCount);}
 async transaction<T>(operation:(sql:SQL)=>Promise<T>,category:'other'|'room'='other',roomCode?:string):Promise<T>{
  this.assertWritable();const begin=performance.now(),wait=performance.now(),phases:Record<string,number>={};let roundTrips=0;let client:PoolClient;const observe=(name:string,ms:number)=>{phases[name]=(phases[name]??0)+ms;};
  try{const acquiring=this.pool.connect();this.observePool();client=await acquiring;this.observePool();}catch(e){throw safe(e,'pool-acquire');}this.acquisitions.add(performance.now()-wait);observe('acquireMs',performance.now()-wait);
  let committed=false,commitSent=false,destroy=false;
  const onClientError=()=>{destroy=true;this.errors++;};client.on('error',onClientError);
  const sql:SQL={observe,query:async<R extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[])=>{const at=performance.now();try{return await client.query<R>(text.startsWith('/* room-')?{name:'duaxe-'+createHash('sha256').update(text).digest('hex').slice(0,24),text,values}:{text,values});}catch(e){throw safe(e);}finally{const elapsed=performance.now()-at;this.queries.add(elapsed);observe(queryPhase(text),elapsed);observe('queryExecutionMs',elapsed);roundTrips++;this.observePool();}}};
  try{
   await sql.query(category==='room'?'BEGIN; SET LOCAL synchronous_commit=on; SET LOCAL plan_cache_mode=force_generic_plan':'BEGIN; SET LOCAL synchronous_commit=on');
   const fence=roomCode===undefined?await sql.query("SELECT owner_id,epoch,EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=924 AND objid=901 AND objsubid=2 AND pid=$1 AND granted) writer_locked FROM duaxe.runtime_owner WHERE singleton FOR SHARE",[this.pid]):await sql.query("SELECT owner_id,epoch,EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=924 AND objid=901 AND objsubid=2 AND pid=$1 AND granted) writer_locked,pg_advisory_xact_lock(hashtext($2),902) FROM duaxe.runtime_owner WHERE singleton FOR SHARE",[this.pid,roomCode]);
   this.assertWritable();if(fence.rows[0]?.owner_id!==this.owner||String(fence.rows[0]?.epoch)!==this.epoch||!fence.rows[0]?.writer_locked)throw new DatabaseError('writer-fenced');
   sql.lockedRoom=roomCode;
   const value=await operation(sql);this.assertWritable();commitSent=true;await sql.query('COMMIT');committed=true;this.assertWritable();return value;
  }catch(e){this.errors++;if(!committed){try{await client.query('ROLLBACK');}catch{destroy=true;}}if(commitSent){destroy=true;throw new DatabaseError('uncertain-commit');}throw e instanceof Error?e:new DatabaseError('transaction');}
  finally{if(destroy)client.once('end',()=>client.removeListener('error',onClientError));else client.removeListener('error',onClientError);client.release(destroy);this.transactions.add(performance.now()-begin);if(category==='room'){this.roomCount++;observe('totalMs',performance.now()-begin);observe('roundTrips',roundTrips);for(const name of roomPhases){let sample=this.roomSamples.get(name);if(!sample){sample=new Samples();this.roomSamples.set(name,sample);}sample.add(phases[name]??0);}}}
 }
 metrics(){return {queryMs:this.queries.summary(),transactionMs:this.transactions.summary(),poolWaitMs:this.acquisitions.summary(),pool:{total:this.pool.totalCount,idle:this.pool.idleCount,waiting:this.pool.waitingCount,pendingPeak:this.pendingPeak,max:this.pool.options.max,dedicatedWriterConnections:1,busyPeak:this.busyPeak,totalPeak:this.totalPeak},roomTransactions:{count:this.roomCount,phases:Object.fromEntries([...this.roomSamples].map(([name,sample])=>[name,sample.summary()]))},errors:this.errors,writerHealthy:this.healthy&&!this.closed};}
 async close(){if(this.closed)return;this.closed=true;this.healthy=false;await this.writer.end().catch(()=>{});await this.pool.end();this.listeners.clear();}
}
