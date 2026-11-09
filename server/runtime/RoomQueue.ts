import { AsyncLocalStorage } from 'node:async_hooks';
interface Entry {tail:Promise<void>;pending:number}
/** One queue per room, not per socket. No database/distributed lock is implied. */
export class RoomQueue {
 private entries=new Map<string,Entry>();
 private context=new AsyncLocalStorage<ReadonlySet<string>>();
 private waits:number[]=[];
 private total=0;private highWater=0;private completed=0;private failed=0;private rejected=0;
 constructor(private readonly perRoomLimit=128,private readonly totalLimit=4096){}
 /** Reset inherited async context ONLY at an external transport/event entry point. */
 external<T>(event:()=>T):T{return this.context.exit(event);}
 pending(key:string){return this.entries.get(key)?.pending??0;}
 run<T>(key:string,operation:()=>Promise<T>|T):Promise<T>{
  const parents=this.context.getStore()??new Set<string>();
  if(parents.has(key)){this.rejected++;return Promise.reject(new Error('Không được gọi lồng cùng hàng đợi phòng.'));}
  if(this.pending(key)>=this.perRoomLimit||this.total>=this.totalLimit){this.rejected++;return Promise.reject(new Error('Phòng đang xử lý quá nhiều thao tác. Thử lại sau.'));}
  let entry=this.entries.get(key);if(!entry){entry={tail:Promise.resolve(),pending:0};this.entries.set(key,entry);}
  const current=entry,queuedAt=performance.now();current.pending++;this.total++;this.highWater=Math.max(this.highWater,current.pending);
  const task=current.tail.then(()=>this.context.run(new Set([...parents,key]),async()=>{
   this.waits.push(performance.now()-queuedAt);if(this.waits.length>2048)this.waits.shift();
   try{const value=await operation();this.completed++;return value;}catch(error){this.failed++;throw error;}
  }));
  const settled=task.finally(()=>{current.pending--;this.total--;if(!current.pending&&this.entries.get(key)===current)this.entries.delete(key);});
  current.tail=settled.then(()=>{},()=>{});return settled;
 }
 async drain(){while(this.entries.size)await Promise.all([...this.entries.values()].map(e=>e.tail));}
 metrics(){const a=[...this.waits].sort((a,b)=>a-b),p=(n:number)=>a.length?a[Math.min(a.length-1,Math.ceil(a.length*n)-1)]:0;return {activeRooms:this.entries.size,pending:this.total,maxDepth:this.highWater,completed:this.completed,failed:this.failed,rejected:this.rejected,waitMs:{samples:a.length,median:p(.5),p95:p(.95),p99:p(.99)}};}
}
