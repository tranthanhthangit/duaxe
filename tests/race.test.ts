import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceModel } from '../src/game/RaceModel';
import { raceConfig as c } from '../src/game/config';
const step=(race:RaceModel,seconds:number)=>{for(let i=0;i<seconds*20;i++)race.update(.05);};
test('five cars start automatically, pause freezes simulation, lanes stay within bounds',()=>{
 const r=new RaceModel();assert.equal(r.cars.length,5);step(r,1);assert.equal(r.cars[0].distance,0);
 r.command({type:'start'});step(r,1);assert.ok(r.cars.every(car=>car.distance>0));
 for(let i=0;i<5;i++)r.command({type:'lane',direction:-1});assert.equal(r.cars[0].lane,0);
 for(let i=0;i<5;i++)r.command({type:'lane',direction:1});assert.equal(r.cars[0].lane,2);
 r.command({type:'pause'});const before=r.snapshot();step(r,2);r.command({type:'boost'});assert.deepEqual(r.snapshot(),before);
});
test('correct answer boosts briefly and obstacle collision slows player',()=>{
 const r=new RaceModel();r.command({type:'start'});r.command({type:'boost'});step(r,1);assert.ok(r.cars[0].speed>c.baseSpeed);step(r,3);assert.equal(r.boost,0);
 const obstacle=r.obstacles[0];r.cars[0].lane=obstacle.lane;r.cars[0].distance=obstacle.distance-.2;r.update(.05);assert.equal(obstacle.hit,true);assert.ok(r.slow>0);r.update(.05);assert.equal(r.cars[0].speed,c.slowSpeed);step(r,2);assert.equal(r.slow,0);
});
test('finish and restart produce stable snapshots and reset the whole race',()=>{
 const r=new RaceModel();r.command({type:'start'});r.cars[0].distance=c.trackLength-.1;r.update(.05);assert.equal(r.status,'finished');assert.equal(r.snapshot().rank,1);assert.equal(r.cars[0].speed,0);
 const snapshot=r.snapshot();r.update(.05);assert.deepEqual(r.snapshot(),snapshot);r.command({type:'restart'});assert.equal(r.status,'ready');assert.equal(r.cars[0].distance,0);assert.equal(r.elapsed,0);assert.ok(r.obstacles.every(o=>!o.hit));
});
