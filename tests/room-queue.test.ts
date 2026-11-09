import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomQueue} from '../server/runtime/RoomQueue';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};

test('room queue orders same-room operations while other rooms proceed, then releases references',async()=>{
 const q=new RoomQueue(),gate=deferred(),started=deferred(),order:string[]=[];
 const first=q.run('A',async()=>{order.push('a-start');started.resolve();await gate.promise;order.push('a-end');});await started.promise;
 const second=q.run('A',()=>{order.push('a-next');});await q.run('B',()=>order.push('b'));
 assert.deepEqual(order,['a-start','b']);assert.equal(q.pending('A'),2);gate.resolve();await Promise.all([first,second]);await q.drain();assert.deepEqual(order,['a-start','b','a-end','a-next']);assert.equal(q.metrics().activeRooms,0);assert.equal(q.metrics().pending,0);assert.equal(q.metrics().maxDepth,2);
});
test('failed queue operation does not poison its successor; nested/cyclic acquisition is rejected',async()=>{
 const q=new RoomQueue();await assert.rejects(q.run('A',()=>{throw Error('invalid operation');}));assert.equal(await q.run('A',()=>42),42);
 await assert.rejects(q.run('A',()=>q.run('A',()=>0)),/gọi lồng/);await assert.rejects(q.run('A',()=>q.run('B',()=>q.run('A',()=>0))),/gọi lồng/);await q.drain();assert.equal(q.metrics().activeRooms,0);assert.ok(q.metrics().failed>=1);
});
test('queue bounds waiting work and maintains a bounded wait sample buffer',async()=>{
 const q=new RoomQueue(2,3),gate=deferred(),started=deferred();const a=q.run('A',async()=>{started.resolve();await gate.promise;});await started.promise;const b=q.run('A',()=>0);await assert.rejects(q.run('A',()=>0),/quá nhiều/);const c=q.run('B',async()=>gate.promise);await assert.rejects(q.run('C',()=>0),/quá nhiều/);gate.resolve();await Promise.all([a,b,c]);await q.drain();assert.equal(q.metrics().rejected,2);assert.equal(q.metrics().activeRooms,0);
 for(let i=0;i<2050;i++)await q.run('short',()=>{});assert.equal(q.metrics().waitMs.samples,2048);assert.equal(q.metrics().activeRooms,0);
});

test('external transport event inherited from a running job can enqueue a follow-up without false reentrancy',async()=>{
 const q=new RoomQueue(),order:string[]=[];let event!:Promise<void>;
 await q.run('A',async()=>{order.push('job');event=q.external(()=>q.run('A',()=>{order.push('disconnect');}));});await event;assert.deepEqual(order,['job','disconnect']);assert.equal(q.metrics().rejected,0);assert.equal(q.metrics().activeRooms,0);
});
