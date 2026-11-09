import type { RoomView, PlayerView } from '../../shared/protocol';
/** 150 ms presentation delay, bounded history, no extrapolation or client race decisions. */
export class SnapshotBuffer {
 private history:{room:RoomView;at:number}[]=[];
 push(room:RoomView,at:number){
  const last=this.history.at(-1);
  if(last&&last.room.code===room.code&&room.sequence<=last.room.sequence)return false;
  if(!last||last.room.code!==room.code||at-last.at>1000)this.history=[];
  this.history.push({room,at});if(this.history.length>24)this.history.shift();return true;
 }
 sample(now:number):PlayerView[]{
  if(!this.history.length)return [];
  const latest=this.history.at(-1)!;
  if(latest.room.status!=='running')return latest.room.players;
  const target=now-150;
  let a=this.history[0],b=a;
  for(const item of this.history){if(item.at<=target)a=item;if(item.at>=target){b=item;break;}b=item;}
  const fraction=b.at===a.at?1:Math.max(0,Math.min(1,(target-a.at)/(b.at-a.at)));
  const previous=new Map(a.room.players.map(p=>[p.id,p]));
  return b.room.players.map(p=>{const old=previous.get(p.id)??p;return {...p,distance:old.distance+(p.distance-old.distance)*fraction,lane:old.lane+(p.lane-old.lane)*fraction};});
 }
}
