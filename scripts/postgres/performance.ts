/** Comparable sequential load matrix. Credentials come only from the process environment. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cpus,totalmem} from 'node:os';

const phase=process.env.PG_BENCHMARK_PHASE??'after';
const driver=process.env.PG_BENCHMARK_DRIVER??'postgres';
const repeats=Number(process.env.PG_BENCHMARK_REPEATS??3);
if(!['before','after'].includes(phase)||!['postgres','sqlite'].includes(driver)||!Number.isInteger(repeats)||repeats<1||repeats>10)throw Error('Invalid benchmark configuration.');
if(driver==='postgres'){
 if(!process.env.PG_TEST_URL)throw Error('PG_TEST_URL is required; no fallback database is selected.');
 const url=new URL(process.env.PG_TEST_URL);
 if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('This benchmark accepts local test PostgreSQL only.');
}
const output=join('benchmarks','postgres-performance',driver,phase);
await mkdir(output,{recursive:true});
const execute=promisify(execFile),runs:unknown[]=[];
for(const clients of [1,5,10,15,20]){
 for(let repeat=1;repeat<=repeats;repeat++){
  const file=join(output,`${clients}-clients-${repeat}.json`);
  await execute(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/readiness-network.ts'],{
   env:{...process.env,BENCHMARK_DRIVER:driver,BENCHMARK_CLIENTS:String(clients),ASYNC_BENCHMARK_OUTPUT:file},
   maxBuffer:4*1024*1024,timeout:90000,
  });
  const run=JSON.parse(await readFile(file,'utf8'));
  runs.push({clients,repeat,file,answerRttMs:run.answerRttMs});
  console.log(`${phase} ${driver}: ${clients} clients, run ${repeat}/${repeats}, answer median ${run.answerRttMs.median.toFixed(2)} ms / P95 ${run.answerRttMs.p95.toFixed(2)} ms`);
 }
}
await writeFile(join(output,'matrix.json'),JSON.stringify({
 measuredAt:new Date().toISOString(),phase,driver,repeats,
 environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,logicalCpus:cpus().length,hostMemoryMiB:totalmem()/1048576},
 method:'Sequential runs; each uses 3 simultaneous question bursts, 10 simultaneous lane bursts, and transport reconnect. Same code and instrumentation for before/after; synthetic data only. No builds/tests run concurrently.',runs,
},null,2)+'\n');
