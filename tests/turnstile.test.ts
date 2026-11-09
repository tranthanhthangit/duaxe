import test from 'node:test';import assert from 'node:assert/strict';
import {TurnstileVerifier,ProfileCaptchaError,enrollmentVerifier} from '../server/cloud/Turnstile';
const secret='synthetic-server-only-secret-not-real',hostname='school.pages.dev';
const valid=()=>({success:true,hostname,action:'teacher-profile',challenge_ts:new Date().toISOString()});
test('Turnstile validates server response and rejects missing/replayed token; never trusts client success',async()=>{
 let calls=0;const verify=new TurnstileVerifier(secret,hostname,async(input,init)=>{calls++;assert.equal(input,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(init?.redirect,'error');const body=JSON.parse(String(init?.body));assert.equal(body.secret,secret);assert.equal(typeof body.response,'string');return new Response(JSON.stringify(valid()));});
 await assert.rejects(verify.verify(),(e:unknown)=>e instanceof ProfileCaptchaError&&e.code==='PROFILE_CAPTCHA_REQUIRED');assert.equal(calls,0);
 await verify.verify('synthetic-valid-token');await assert.rejects(verify.verify('synthetic-valid-token'));assert.equal(calls,1);
 await assert.rejects(verify.verify('bad token'));assert.equal(calls,1);
});
test('Turnstile rejects wrong hostname/action, false success, expired/future time and provider duplicate',async()=>{
 for(const override of [{success:false},{success:'true'},{hostname:'foreign.pages.dev'},{action:'teacher-auth'},{challenge_ts:new Date(Date.now()-301000).toISOString()},{challenge_ts:new Date(Date.now()+60000).toISOString()},{challenge_ts:'invalid'},{success:false,'error-codes':['timeout-or-duplicate']}]){
  const verify=new TurnstileVerifier(secret,hostname,async()=>new Response(JSON.stringify({...valid(),...override})));await assert.rejects(verify.verify('fresh-token'),(e:unknown)=>e instanceof ProfileCaptchaError&&e.code==='PROFILE_CAPTCHA_INVALID');
 }
});
test('Turnstile fails closed on network/malformed/provider failures and rejects production test-key configuration',async()=>{
 for(const request of [async()=>{throw Error('offline');},async()=>new Response('bad json'),async()=>new Response('{}',{status:503})])await assert.rejects(new TurnstileVerifier(secret,hostname,request).verify('fresh-token'),(e:unknown)=>e instanceof ProfileCaptchaError&&e.code==='PROFILE_CAPTCHA_UNAVAILABLE');
 assert.throws(()=>new TurnstileVerifier('1x0000000000000000000000000000000AA',hostname));assert.throws(()=>new TurnstileVerifier('',hostname));assert.throws(()=>new TurnstileVerifier(secret,'*.pages.dev'));
 assert.throws(()=>enrollmentVerifier({TURNSTILE_SECRET_KEY:secret,TURNSTILE_EXPECTED_HOSTNAME:hostname,CORS_ORIGINS:'https://foreign.pages.dev',NODE_ENV:'test'}));
 assert.ok(enrollmentVerifier({TURNSTILE_SECRET_KEY:secret,TURNSTILE_EXPECTED_HOSTNAME:hostname,CORS_ORIGINS:'https://'+hostname}));
});
