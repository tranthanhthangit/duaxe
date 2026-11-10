import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayDenialReason,gatewayGuard} from '../server/cloud/DeploymentGate';
test('gate diagnostics distinguish denial without revealing keys and preserve access checks',()=>{
 const gate={mode:'live' as const,key:'k'.repeat(64)};
 assert.equal(gatewayDenialReason({...gate,mode:'closed'},{'x-deployment-key':gate.key}),'MODE_CLOSED');
 assert.equal(gatewayDenialReason(gate,{}),'KEY_MISSING');
 for(const key of ['bad','z'.repeat(64)])assert.equal(gatewayDenialReason(gate,{'x-deployment-key':key}),'KEY_MISMATCH');
 assert.equal(gatewayDenialReason(gate,{'x-deployment-key':gate.key}),undefined);
 assert.equal(gatewayDenialReason(undefined,{}),undefined);
 let time=0;const logs:string[]=[];const guard=gatewayGuard(gate,x=>logs.push(x),()=>time);
 for(let i=0;i<100;i++)assert.equal(guard({'x-deployment-key':'secret'}),false);
 assert.deepEqual(logs,['[DEPLOYMENT_GATE_KEY_MISMATCH]']);
 time=30000;guard({'x-deployment-key':'secret'});assert.equal(logs.length,2);
 assert.equal(guard({'x-deployment-key':gate.key}),true);
 assert.equal(logs.join('').includes('secret'),false);
});
