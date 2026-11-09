import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../src/online/SnapshotBuffer';
import { projectRoad, gridPosition, cameraTarget, overlaps, labelPosition } from '../src/game/perspective';
import { Room } from '../server/Room';
import { defaultSet } from '../src/questions/model';
function setup(){const r=new Room('ABC234',defaultSet,'secret','teacher');for(let i=0;i<20;i++)r.join(`Bé ${i}`,i,'socket'+i);return r;}
test('bounded interpolation rejects duplicate/older frames, freezes on packet loss, snaps paused and reconnect',()=>{
 const room=setup(),buffer=new SnapshotBuffer();room.control('start');const a=room.frame().room;a.sequence=1;buffer.push(a,0);
 room.tick(.05);const b=room.frame().room;b.sequence=2;buffer.push(b,100);assert.equal(buffer.push(a,200),false);assert.equal(buffer.push(b,200),false);
 const middle=buffer.sample(200)[0].distance;assert.ok(middle>0&&middle<b.players[0].distance);assert.equal(buffer.sample(900)[0].distance,b.players[0].distance);
 const paused={...b,status:'paused' as const,sequence:3};buffer.push(paused,200);assert.equal(buffer.sample(200)[0].distance,b.players[0].distance);
 const restored={...b,sequence:4};restored.players=b.players.map(p=>({...p,distance:90}));buffer.push(restored,2000);assert.equal(buffer.sample(2000)[0].distance,90);
});
test('20 cars start in seven real rows on three lanes; projection keeps lane and scales with distance',()=>{
 const room=setup(),cars=room.frame().room.players,camera=cameraTarget(cars,'leaders');
 assert.equal(new Set(cars.map(c=>`${c.lane}:${c.distance}`)).size,20);
 for(const car of cars){assert.deepEqual({lane:car.lane,distance:car.distance},gridPosition(car.number-1));const p=projectRoad(car.distance-camera.position,car.lane);assert.ok(p.visible);assert.equal(Math.sign(p.x-450),Math.sign(car.lane-1));}
 const points=cars.map(c=>({...projectRoad(c.distance-camera.position,c.lane),lane:c.lane}));
 for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)if(points[i].lane===points[j].lane){const near=points[i].y>points[j].y?points[i]:points[j],far=near===points[i]?points[j]:points[i];assert.ok(near.y-70*near.scale*.55>far.y);}
 assert.ok(projectRoad(40,1).scale>projectRoad(200,1).scale);
 assert.equal(projectRoad(100,.5).x,(projectRoad(100,0).x+projectRoad(100,1).x)/2);
});
test('camera follows leader group independent of order; overview fits all world positions',()=>{
 const cars=setup().frame().room.players;assert.deepEqual(cameraTarget(cars,'leaders'),cameraTarget([...cars].reverse(),'leaders'));
 cars[0].distance=2500;const camera=cameraTarget(cars,'overview');assert.ok(cars.every(c=>projectRoad(c.distance-camera.position,c.lane,camera.range).visible));
});
test('dense labels are moved or hidden without moving any car',()=>{
 const boxes:import('../src/game/perspective').LabelBox[]=[];for(let i=0;i<20;i++){const box=labelPosition(450,360,130,25,boxes);if(box){assert.ok(boxes.every(old=>!overlaps(old,box)));boxes.push(box);}}
 assert.ok(boxes.length>0&&boxes.length<20);
});
test('a faster rear-row car physically overtakes a front-row car and server rank follows position',()=>{
 const room=setup(),players=[...room.players.values()],front=players[0],rear=players[3];
 assert.ok(rear.race.cars[0].distance<front.race.cars[0].distance);
 room.control('start');room.answer(rear.id,'sun','morning');
 for(let i=0;i<65;i++)room.tick(.05);
 assert.ok(rear.race.cars[0].distance>front.race.cars[0].distance);
 const ranked=room.frame().room.players;
 assert.ok(ranked.find(c=>c.id===rear.id)!.rank<ranked.find(c=>c.id===front.id)!.rank);
 const before=JSON.stringify(ranked);cameraTarget(ranked,'overview');ranked.forEach(c=>projectRoad(c.distance,c.lane));assert.equal(JSON.stringify(ranked),before);
});
