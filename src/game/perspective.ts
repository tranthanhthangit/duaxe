import type { CarState } from './config';
export const GRID_SPACING = 42;
export function gridPosition(index:number){return {lane:index%3,distance:-Math.floor(index/3)*GRID_SPACING};}
/** One projection for cars, lane lines and obstacles. Never changes world coordinates. */
export function projectRoad(distance:number,lane:number,range=430){
 const t=Math.max(0,Math.min(1,1-distance/range)),depth=t*t;
 return {x:450+(lane-1)*(34+depth*190),y:168+depth*372,scale:.22+depth*.88,visible:distance>=0&&distance<=range};
}
export function cameraTarget(cars:CarState[],focus:string){
 if(!cars.length)return {position:0,range:430};
 const min=Math.min(...cars.map(c=>c.distance)),max=Math.max(...cars.map(c=>c.distance));
 if(focus==='overview')return {position:min-35,range:Math.max(430,max-min+100)};
 const selected=cars.find(c=>c.id===focus);
 const leaders=[...cars].sort((a,b)=>b.distance-a.distance).slice(0,3);
 const center=selected?.distance??leaders.reduce((sum,c)=>sum+c.distance,0)/leaders.length;
 // Show the complete starting grid before following the lead group.
 return {position:Math.min(center-180,min<0?min-35:Infinity),range:430};
}
export interface LabelBox {x:number;y:number;width:number;height:number}
export function overlaps(a:LabelBox,b:LabelBox){return Math.abs(a.x-b.x)<(a.width+b.width)/2+3&&Math.abs(a.y-b.y)<(a.height+b.height)/2+3;}
/** Move only labels; hide labels that cannot fit. Cars always retain projected coordinates. */
export function labelPosition(x:number,y:number,width:number,height:number,occupied:LabelBox[],minY=175):LabelBox|null{
 for(const dy of [0,-26,-52,-78,-104])for(const dx of [0,-60,60,-120,120]){
  const box={x:Math.max(width/2+8,Math.min(892-width/2,x+dx)),y:y+dy,width,height};
  if(box.y-height/2<minY||box.y+height/2>580||occupied.some(other=>overlaps(box,other)))continue;
  return box;
 }return null;
}
