import { constants,openSync,closeSync,readFileSync,writeFileSync,renameSync,existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
/** Linux local filesystem. The persistent guard inode is NEVER removed or renamed.
 * flock is attached to the inherited open file description, held by this process's fd.
 * Kernel releases it after SIGKILL; metadata is diagnostic, not proof of ownership.
 */
export function acquireProcessLock(dbPath:string):()=>void {
 const metadata=dbPath+'.lock',guard=dbPath+'.guard';
 const fd=openSync(guard,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
 const result=spawnSync('flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd],timeout:5000});
 if(result.error||result.status!==0){closeSync(fd);throw new Error(result.status===1?'Database đang được tiến trình khác sử dụng.':'Cần Linux và util-linux flock để khóa database an toàn.');}
 try{
  if(existsSync(metadata)){
   const raw=readFileSync(metadata,'utf8').trim();let valid=false;try{valid=JSON.parse(raw)?.format===2;}catch{}
   if(!valid){const pid=/^[1-9][0-9]*$/.test(raw)?Number(raw):0;let alive=true;if(Number.isSafeInteger(pid)&&pid>0)try{process.kill(pid,0);}catch(e){alive=(e as NodeJS.ErrnoException).code!=='ESRCH';}
    throw new Error(alive?'Khóa phiên bản cũ: tiến trình còn sống hoặc không xác định; không được xóa khóa.':'Khóa phiên bản cũ có PID không tồn tại. Quản trị viên cần xác minh cùng máy/PID namespace trước khi lưu trữ lại file .lock; không xóa .guard, DB, WAL hoặc SHM.');
   }
  }
  const temporary=metadata+'.'+randomUUID()+'.tmp';writeFileSync(temporary,JSON.stringify({format:2,pid:process.pid,host:hostname(),startedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});renameSync(temporary,metadata);
 }catch(e){closeSync(fd);throw e;}
 let closed=false;return ()=>{if(!closed){closed=true;closeSync(fd);}};
}
